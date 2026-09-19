# Native client companion design

`client-companion` is an optional DSH Web client package. It is deliberately
separate from the service package so the core plugin remains usable in CLI,
headless, and non-React profiles.

## Runtime boundary

The package registers one `conversation.session.header.actions` slot. It reads
the UI-neutral `TimeMachineClient.timeline()` projection, previews a selected
checkpoint, shows the returned diff/conflict/omitted-path counts, and only then
submits the one-shot restore plan. A successful rewind opens the forked DSH
session through `uiWorkspace.openSession()`.

The package does not restore files directly, bypass the restore-plan fence, or
assume a `default` session. The service remains the authority for locking,
drift checks, rescue compensation, and session creation.

## Compatibility boundary

DSH client UI packages are peer dependencies. The source is typechecked against
the local DSH alpha package declarations, while publish/build verification and
a cross-version slot matrix remain release prerequisites. The companion is
therefore opt-in and cannot silently change the main service's dependency graph.
