## What changed

Describe the user-visible behavior and why this belongs in the plugin.

## Safety and compatibility

- [ ] I considered staged changes, post-checkpoint hand edits, untracked/ignored files, symlinks, and failure compensation where relevant.
- [ ] Destructive behavior is explicit and defaults to off.
- [ ] Storage-format or DSH compatibility impact is documented.
- [ ] I did not include secrets, private Session data, or generated runtime state.

## Verification

- [ ] `pnpm check`
- [ ] `pnpm audit --prod --audit-level=high`
- [ ] `dist/` is rebuilt and committed when runtime sources changed.
- [ ] New or changed behavior has a regression test.
