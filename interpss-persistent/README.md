# InterPSS — persistent Cordis plugin for DeepSeek Harness

A persistent, installable dual-face Cordis plugin for the DeepSeek Harness web
GUI. It adds an **InterPSS** tab (next to Chat) for running power-system AC load
flow on IEEE CDF / PSS/E RAW cases, exploring the bus/branch/gen/load results,
and generating a **NERC TPL-001-5** contingency report.

Unlike a dynamic per-session injection, this is a real persistent composition
row: a Host half plus a browser Client half, mounted through the profile's
`cordis.patch.yml` (via the bundle's own `dsh.bundle.patch`), so it survives
restarts.

## Layout

| File | Role |
| --- | --- |
| `package.json` | Package manifest + `dsh.bundle` (patch) + `dsh.client` declaration (`platform: web`). |
| `cordis.patch.yml` | Bundle patch: inserts the `interpss` composition row. |
| `lib/index.js` | Host half: provides the `interpss` service and exports its methods through the Typert Remote gateway (`interpss/<method>`). |
| `lib/client.js` | Client half: the InterPSS tab, registered in `conversation.view`; calls the Host via `/api` RPC. |
| `LICENSE` | Distribution license (WattByte Nexus LLC, non-commercial). |

The Host↔Client boundary uses the Typert Remote **SRC mode** — plain-JSON
parameters and results, no build-time Typert compiler required.

## Features

- AC load flow runner (`ACLF` button) for IEEE CDF (`.ieee`) and PSS/E RAW (`.raw`/`.RAW`) cases.
- Case selection: presets (IEEE 118 / IEEE 14 / Texas 2K) plus a custom path with a filtered file picker.
- **Auto-display** of an existing converged result on case selection (and on first open), read from `*_network_info.txt`.
- Bus / Branch / Gen / Load CSV explorer with infinite scroll and sticky headers.
- Selectable bus IDs with a branch-connection popup: **Diagram** (double-click a node to select it), **Branch**, **Gen**, and **Load** tabs.
- AC Loadflow Options dialog (4 tabs — Main / NR Config / Adj-Ctrl Setting / PSS/E Setting), backed by `config/aclf_run.json`.
- **NERC TPL-001-5 Report** button (enabled once a converged result's CSV files are present) with a rendered/source viewer.
- "Show log info" toggle for the raw run output (hidden for auto-loaded results).
- Remembers the last selected case across tab switches.

## Host RPC methods

`isActivated`, `checkResult`, `checkResultFiles`, `listCases`, `readCsv`,
`busConnections`, `runAclf`, `runReport`, `getAclfOptions`, `saveAclfOptions`.

## Prerequisites

The tab activates only inside an **iPSS Agent** workspace (see *Activation
gate* below). That workspace must contain the runtime the Host half shells out
to:

- `.venv/bin/python` (a Python virtualenv with InterPSS bindings)
- `src/ipss_cmd.py` and `src/report/generate_nerc_tpl_report.py`
- `wspace/data/**` case files
- `config/aclf_run.json`

## Install

See `INSTALL.md` at the root of the `ipss-dsh.zip` distribution. Two methods:

1. **Automatic (`dsh plugin`)** — from the unzipped directory or the npm
   tarball:

   ```sh
   dsh plugin --profile web add /path/to/dsh-interpss
   # or
   dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-<version>.tgz
   ```

   This pnpm-installs the package into the profile and reconciles it into
   `dsh.profile.bundles`; the bundle's `cordis.patch.yml` inserts the
   `interpss` row automatically. No manual patch editing needed.

2. **Manual copy** — copy the package under the profile and add the row by
   hand:

   ```sh
   mkdir -p "$DSH_HOME/profiles/web/node_modules/@deepseek-ai"
   cp -R dsh-interpss "$DSH_HOME/profiles/web/node_modules/@deepseek-ai/"
   ```

   Then append to `$DSH_HOME/profiles/web/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: interpss
         name: '@deepseek-ai/dsh-interpss'
   ```

In both cases, restart the web server (`dsh web`), then hard-reload the page.

## Activation gate

The tab only shows the tool when the workspace `README.md`'s first `# H1` is
exactly `iPSS Agent`; otherwise it prints "InterPSS is not available in this
workspace. Please install iPSS Agent from GitHub first".

## Packaging

To rebuild the distributable artifacts:

```sh
cd interpss-persistent
npm pack                                   # -> deepseek-ai-dsh-interpss-<version>.tgz
cd ..
zip -r ipss-dsh.zip INSTALL.md dsh-interpss   # from the source tree
```
