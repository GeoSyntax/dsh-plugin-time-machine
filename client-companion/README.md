# Time Machine DSH client companion

This optional Web client package contributes a session-header action to
`conversation.session.header.actions` and a message-level rewind action to
`conversation.chat.assistant-actions`. It consumes the dependency-free
`dsh-plugin-time-machine/client` contract.

The actions resolve finalized assistant messages to their checkpoint, load the
safety-aware timeline, show partial/unattributed/external effect and abandoned-
branch reflection warnings, ask for confirmation, invoke preview-bound rewind, and open the
forked session returned by DSH. The service package deliberately does not
include React or DSH client UI dependencies.

## Development and packaging

From this directory:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test:package
pnpm pack --dry-run
```

`test:package` verifies the consumer-facing `main`, `types`, and `exports` entries
point at files included in the built package. This catches publish metadata errors
that a source-only typecheck cannot detect.

Install the published package alongside the core service and matching DSH Web
client packages. Supported peer range is DSH client `>=0.1.6-alpha.1 <0.2.0`
and Cordis `>=4.0.0 <5.0.0`; the repository CI checks client `0.1.6-alpha.1`
and `0.1.6-alpha.2`. The companion is opt-in; it does not change the service
plugin's manifest or silently add UI dependencies to a headless profile.
