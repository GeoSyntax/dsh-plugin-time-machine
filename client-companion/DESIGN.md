# Native client companion design

`client-companion` is an optional DSH Web client package. It is deliberately
separate from the service package so the core plugin remains usable in CLI,
headless, and non-React profiles.

## Runtime boundary

The package registers one `conversation.session.header.actions` slot. It reads
the UI-neutral `TimeMachineClient.timeline()` projection, previews a selected
checkpoint, shows the returned diff/conflict/omitted-path counts, and only then
submits the one-shot restore plan. Confirmation also includes external-effect
and read-only abandoned-branch reflection warnings. A successful rewind opens the forked DSH
session through `uiWorkspace.openSession()`.

The package does not restore files directly, bypass the restore-plan fence, or
assume a `default` session. The service remains the authority for locking,
drift checks, rescue compensation, and session creation.

## Compatibility boundary

DSH client UI packages are peer dependencies constrained to the tested DSH
0.1.x line (`>=0.1.6-alpha.1 <0.2.0`); Cordis is constrained to 4.x. The source
is typechecked against the local DSH alpha package declarations, and CI runs a
slot matrix for `0.1.6-alpha.1` and `0.1.6-alpha.2`. A future DSH 0.2 release
must widen the range only after a new matrix result. The companion is therefore
opt-in and cannot silently change the main service's dependency graph.
