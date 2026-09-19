# Community publication package

This file is the source of truth for submitting Time Machine to the DSH
community. It deliberately describes the project as an unofficial plugin;
publication in a community directory is not a DSH security review or an
official endorsement.

## Current publication state

| Item | Status | Evidence or next action |
| --- | --- | --- |
| Public source repository | Ready | <https://github.com/GeoSyntax/dsh-plugin-time-machine> |
| `dsh.bundle.patch` declaration | Ready | `package.json` and `cordis.patch.yml` |
| `dsh-plugin` topic | Ready | Repository topic is already set |
| DSH bundle smoke | Verified | `.github/workflows/ci.yml`, `pnpm smoke:dsh` |
| Cross-platform release gate | Verified | Node 22/24 on Ubuntu, macOS and Windows |
| npm package | Not published | Publish `dsh-plugin-time-machine@0.2.0` only after the release checklist |
| GitHub Release | Not created | Merge the release commit, then create `v0.2.0` |
| Community discussion | Not submitted | Use the template below after the default branch is current |

## Official DSH discussion

Use the **Show Your Plugins!** category:

<https://github.com/deepseek-ai/deepseek-harness/discussions/categories/show-your-plugins>

Suggested title:

```text
DSH | Time Machine | Safe workspace rewind, DAG forks, and failure reflection
```

Copy and adapt this body. Replace the screenshot placeholders with a real
dashboard screenshot and a `/tm-tree` or `/tm-preview` terminal capture. The
repository also contains a rendered transcript preview at
[`docs/assets/dag-demo.svg`](assets/dag-demo.svg) that matches the verified
local live demo; use it only as supporting material, not as a substitute for
a fresh screenshot from the target DSH profile. Do not publish placeholders.

```markdown
> Unofficial community plugin; not affiliated with or endorsed by DeepSeek.

Project: https://github.com/GeoSyntax/dsh-plugin-time-machine

Time Machine adds coordinated session/workspace checkpoints to DeepSeek
Harness. It provides preview-first rewind, orphan-file cleanup, DAG forks,
failure reflection, restore journals, and optional external-effect gates
without rewriting DSH's append-only session log.

### Screenshots

<!-- Attach a real Web Dashboard timeline/diff screenshot here. -->
<!-- Attach a real `/tm-tree` or `/tm-preview <checkpoint>` capture here. -->

### DSH integration

The package exports a Cordis plugin and declares `dsh.bundle.patch` through
`cordis.patch.yml`. It is currently tested for DSH `>=0.1.5-rc.2 <0.2.0` on
the `web` profile. The optional `client-companion/` package adds Web header
and assistant-message action slots for DSH Web client `0.1.6-alpha.1` and
`0.1.6-alpha.2`.

### Install

```bash
dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

Enable `time-machine` in the profile's `cordis.patch.yml`, restart DSH, then
use `/tm-list`, `/tm-preview <checkpoint>`, `/tm-rewind <checkpoint>`, or
`/tm-fork <checkpoint> <branch>`.

### Safety boundaries

The default safe mode refuses to overwrite unverified user/staged/ignored
drift. External databases, network requests, processes, and cloud resources
are not magically rolled back; strict mode can block a restore until a
registered compensation adapter resolves those effects. A DSH host that does
not expose a workspace-fork API is handled fail-closed rather than emulated.

### Verification

The repository's CI runs the release gate, DSH bundle smoke, companion slot
smoke, dependency audit, and Node 22/24 tests on Ubuntu, macOS, and Windows.
See the workflow runs and the test plan in the repository for exact commands.
```

The DSH category guidelines require a real integration, a project URL, a
short introduction, screenshots/GIF/video, and an explicit unofficial label.
Community votes do not constitute official review:

<https://github.com/deepseek-ai/deepseek-harness/discussions/2004>

## Directory submission

After merging to `main`, submit one package to the community directory using
the repository root URL. Recommended values are:

```text
Package URL: https://github.com/GeoSyntax/dsh-plugin-time-machine
Category: Sessions & History
One-line description: Unofficial DSH checkpoints, safe rewind, DAG forks, and failure reflection for the web profile.
Install command: dsh plugin --profile web add github:GeoSyntax/dsh-plugin-time-machine
```

The directory checks that the URL is public, points to a directory on the
default branch, contains `package.json` and `dsh.bundle.patch`, and has one
factual description plus one install command. Submission is a community
listing, not a runtime or security audit:

<https://github.com/alexchenzl/dsh-plugin-directory/blob/master/CONTRIBUTING.md>

## Release hand-off checklist

- [ ] Merge the release-ready PR into `main`.
- [ ] Change the matching `CHANGELOG.md` section from `Unreleased` to `0.2.0`.
- [ ] Run `pnpm test:release` from a clean checkout.
- [ ] Run the declared DSH bundle smoke and record the DSH/OS matrix.
- [ ] Build and attach the `dsh-plugin-time-machine-0.2.0.tgz` checksum.
- [ ] Create GitHub tag/release `v0.2.0`.
- [ ] Configure npm provenance/trusted publishing before running the release workflow.
- [ ] Verify a fresh registry install in a temporary DSH profile.
- [ ] Attach real screenshots/GIFs to the community discussion.
- [ ] Submit the official discussion and the community-directory entry.

Do not describe the npm package as available until a registry install from an
empty profile has succeeded. Do not describe the companion as required for
the core plugin; it is an optional package with a separate release track.
