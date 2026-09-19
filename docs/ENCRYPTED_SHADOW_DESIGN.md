# Encrypted shadow object store design

This is a design boundary, not an implemented capability. Until its
acceptance checks pass, `shadowStoreEncryption` must remain `false`.

## Why Git objects cannot simply be encrypted

Git reads loose objects and pack files directly. Encrypting bytes in
`git-shadow/objects` would make `cat-file`, `read-tree`, `rev-list`, and
restore unusable. A safe implementation must separate an encrypted at-rest
archive from a temporary Git-readable runtime object directory.

## Proposed layout

```text
storageDir/
  git-shadow-encrypted/
    manifest.v1.json
    segments/segment-000001.tmobj
    journal.json
  git-shadow-runtime/objects/
```

Each segment contains length-delimited records encrypted with AES-256-GCM,
using a fresh nonce and associated data containing the format version, object
id, and record type. Object content, pack indexes, and ref metadata are
encrypted. The key comes from an operator-selected environment variable or
key-provider callback and is never written to the DAG, manifest, logs, refs,
or error messages.

## Runtime lifecycle

1. Acquire the workspace lock.
2. Resolve and verify the key before any workspace mutation.
3. Materialize a fresh runtime object directory and validate every decrypted
   object hash before exposing it to Git.
4. Run ordinary Git plumbing against the runtime directory.
5. Append encrypted records and atomically advance the manifest.
6. Remove the runtime directory on shutdown or explicit compaction. A crash
   leaves a journal that can resume an atomic segment commit or remove only
   an unreferenced temporary segment.

The runtime directory is disposable and is not a claim against a compromised
process, OS administrator, swap capture, or memory inspection.

## Migration and failure semantics

- `shadowStoreEncryptionKeyEnv` is opt-in; plaintext shadow storage remains
  the compatibility mode until migration is explicit.
- `/tm-shadow-encrypt-migrate` must create and verify the encrypted archive,
  fsync the manifest and journal, then remove plaintext only after a restart
  and restore check succeeds.
- Wrong/missing keys, corrupt tags, truncated segments, and object hash
  mismatches fail closed and preserve the original archive.
- Prune/quota accounting includes encrypted segments, manifests, journals,
  and temporary runtime bytes.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Fresh encrypted checkpoint | Restart with the key and restore every checkpoint |
| Wrong or missing key | `SHADOW_KEY_INVALID`; no workspace/ref/object deletion |
| Corrupt segment/tag | `SHADOW_ARCHIVE_CORRUPT`; archive remains recoverable |
| Crash during append | Journal replay completes or removes only temporary files |
| Explicit migration | Restart, restore, prune and quota accounting pass |
| Key rotation | New archive is verified before old archive removal |
| Plaintext audit | No object content, key material, or decrypted pack remains durable |
| Git compatibility | Existing safe/merge/force restore tests remain green |

The design covers only plugin-owned shadow objects; it does not encrypt a
user's ordinary `.git/objects`.
