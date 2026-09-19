# Time Machine DSH client companion

This optional Web client package contributes a session-header action to
`conversation.session.header.actions` and consumes the dependency-free
`dsh-plugin-time-machine/client` contract.

The action loads the safety-aware timeline, shows partial/unattributed/external
effect warnings, asks for confirmation, invokes relative undo, and opens the
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
