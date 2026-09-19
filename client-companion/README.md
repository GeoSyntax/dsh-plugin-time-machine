# Time Machine DSH client companion

This optional Web client package contributes a session-header action to
`conversation.session.header.actions` and a message-level rewind action to
`conversation.chat.assistant-actions`. It consumes the dependency-free
`dsh-plugin-time-machine/client` contract.

The actions resolve finalized assistant messages to their checkpoint, load the
safety-aware timeline, show partial/unattributed/external effect warnings, ask
for confirmation, invoke preview-bound rewind, and open the
forked session returned by DSH. The service package deliberately does not
include React or DSH client UI dependencies.

## Development and packaging

From this directory:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm pack --dry-run
```

Install the published package alongside the core service and matching DSH Web
client packages. The companion is opt-in; it does not change the service
plugin's manifest or silently add UI dependencies to a headless profile.
