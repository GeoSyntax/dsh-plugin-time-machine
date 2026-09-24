# DSH Time Machine

**Return a DSH conversation and its workspace to a checkpoint, then explore another branch.**

An unofficial DeepSeek Harness community plugin that saves file and session boundaries, previews restores, and keeps the history of each attempt.

[简体中文](README.md) · [Feature comparison](docs/COMPARISON.md) · [Test plan](docs/TEST_PLAN.md) · [Report an issue](https://github.com/GeoSyntax/dsh-plugin-time-machine/issues)

## Preview

![Running Web dashboard with successful, failed, rescue, and forked checkpoints on the left and checkpoint details on the right](docs/assets/dashboard-real.png)

This is a screenshot of the running Web dashboard. **The auth, Redis, and JWT content was created as sample data for the demo.** It shows a failed checkpoint, a pre-restore rescue point, and a successful `experiment/jwt` branch. The interface defaults to Chinese and can switch to English.

## Install

Install [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and pnpm first. You need Node.js `^22.19.0 || >=24.0.0`. The current package supports DSH `>=0.1.5-rc.2 <0.2.0` with the `web` profile.

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

DSH adds the plugin's `cordis.patch.yml` as a profile Bundle during installation. Restart DSH after adding or updating the plugin; you do not need to copy a configuration block into the profile. This package is available from GitHub and has not been published to npm. See the [DSH Bundle installation guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

## Quickstart

Start DSH from the project directory that the Agent will edit:

```bash
dsh web
```

Complete one conversation turn that changes a file. The plugin creates checkpoints at turn boundaries by default. Then run these commands in the conversation:

```text
/tm-list
/tm-tree
```

`/tm-list` shows checkpoint IDs and `/tm-tree` shows the branch history. Open `http://127.0.0.1:3088` in another tab to inspect the dashboard and preview file changes before restoring or forking. DSH Web itself defaults to `http://127.0.0.1:3080`.

## What you can do

- **Restore the workspace:** Preview affected paths, conflicts, and external effects before restoring. A full restore removes ordinary files created later; ignored files remain protected by default.
- **Preserve attempts:** Store checkpoints in a persistent DAG so failures and alternate branches remain available.
- **Align the conversation:** Ask DSH to fork at the selected message boundary while restoring files. The original session remains available.
- **Carry failure evidence:** Use a failed tool summary to guide the Agent in the new branch.
- **Use a non-Git directory:** Fall back to manifest and content-hash snapshots when the workspace is not a Git repository.

See the [feature comparison](docs/COMPARISON.md) for detailed behavior and alternatives.

## Limits

- Default `safe` mode refuses to overwrite unverified user edits, staged changes, or protected ignored files. Inspect the preview before a restore.
- Forks in the current DSH host share one workspace. They do not create an isolated worktree or container.
- Restoring files does not reverse database transactions, network calls, or cloud changes. Strict gates and compensation adapters require project configuration.
- Full workspace restore and selective file restore are separate operations.

For additional safety policies, optional encryption, and configuration, see [DESIGN.md](DESIGN.md).

## Verification

The repository [CI](https://github.com/GeoSyntax/dsh-plugin-time-machine/actions/workflows/ci.yml) covers Node.js 22/24 on Windows, macOS, and Ubuntu, DSH Bundle loading, client companion checks, dependency auditing, and automated tests. The [test plan](docs/TEST_PLAN.md) also describes local DSH source-host and Web checks. The screenshot demonstrates the UI and sample timeline; it does not prove that external side effects are reversible.

## License

MIT
