# Encrypted shadow object store design

The encrypted shadow archive is implemented behind `shadowStoreEncryptionKeyEnv`.
Git still receives a disposable plaintext runtime directory, while durable
objects are authenticated AES-256-GCM payloads. The remaining journal and
quota items below are explicit hardening work; capability reporting must only
claim the archive behavior covered by tests.

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
    payload/<uuid>.bin
  git-shadow/objects/       # disposable Git runtime directory
```

Each payload file is encrypted with AES-256-GCM using a fresh nonce; the
manifest stores only relative object paths, ciphertext payload names, hashes,
sizes, and nonces. Object content and pack indexes are encrypted. The key
comes from an operator-selected environment variable and is never written to
the DAG, manifest, logs, refs, or error messages.

## Runtime lifecycle

1. Acquire the workspace lock.
2. Resolve and verify the key before any workspace mutation.
3. Materialize a fresh runtime object directory and validate every decrypted
   object hash before exposing it to Git.
4. Run ordinary Git plumbing against the runtime directory.
5. Encrypt all runtime files and atomically advance the manifest.
6. Remove the runtime directory after the operation. A crash or forced
   process termination can still leave a short-lived plaintext runtime;
   durable journal replay is future hardening and is not claimed by the
   current capability.

The runtime directory is disposable and is not a claim against a compromised
process, OS administrator, swap capture, or memory inspection.

## Migration and failure semantics

- `shadowStoreEncryptionKeyEnv` is opt-in; plaintext shadow storage remains
  the compatibility mode until migration is explicit.
- `/tm-shadow-migrate` must create and verify the encrypted archive, then
  remove plaintext only after the encrypted manifest has been written.
- Wrong/missing keys, corrupt authentication tags, truncated payloads, and
  object hash mismatches fail closed and preserve the original archive.
- Storage accounting includes encrypted payloads, the manifest, and temporary
  runtime bytes; quota-aware archive compaction remains future hardening.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Fresh encrypted checkpoint | Restart with the key and restore every checkpoint |
| Wrong or missing key | `SHADOW_KEY_INVALID`; no workspace/ref/object deletion |
| Corrupt segment/tag | `SHADOW_ARCHIVE_CORRUPT`; archive remains recoverable |
| Crash during append | Temporary archive staging is removed; a durable journal for resumable append remains future hardening |
| Explicit migration | Restart, restore, prune and quota accounting pass |
| Key rotation | New archive is verified before old archive removal |
| Plaintext audit | Normal operation removes the runtime directory after each Git operation; crash/OS-abort windows remain a documented limitation |
| Git compatibility | Existing safe/merge/force restore tests remain green |

The design covers only plugin-owned shadow objects; it does not encrypt a
user's ordinary `.git/objects`.
