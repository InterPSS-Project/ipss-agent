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
- Selectable bus IDs with a branch-connection popup: **Diagram** (bus info tooltips on hover, transformer styling, double-click a node to navigate), **Branch**, **Gen**, and **Load** tabs.
- AC Loadflow Options dialog (3 tabs — Main / NR Config / Adj-Ctrl Setting), backed by `config/aclf_run.json`.
- **NERC TPL-001-5 Report** button (enabled once a converged result's CSV files are present) with a rendered/source viewer.
- "Show log info" toggle for the raw run output (hidden for auto-loaded results).
- Remembers the last selected case across tab switches.
- **Chat tools** — `interpss_network_info` and `interpss_run_aclf` expose the selected case's network info and AC load flow to the chat agent (see *Chat tools*).
- **ACLF result explorer in chat** — the `interpss_run_aclf` card offers Bus / Branch / Gen / Load tables, paged through the same `readCsv` RPC as the tab, plus a **Report** button that generates the AC Loadflow report.

## Host RPC methods

`isActivated`, `checkResult`, `checkResultFiles`, `listCases`, `readCsv`,
`busConnections`, `runAclf`, `runReport`, `getAclfOptions`, `saveAclfOptions`.

## Chat tools

The Host half also registers model Tools, so the same capability is reachable
from the chat agent instead of only from the tab. Registration is global to the
host process (this row applies at the host level) and each call is gated on the
iPSS Agent workspace activation check.

| Tool | Purpose |
| --- | --- |
| `interpss_network_info` | Show the InterPSS network information (active buses and branches, total generation and load, load-flow convergence, max mismatch) of a simulation case. |
| `interpss_run_aclf` | Run an AC load flow (ACLF) on a simulation case and report convergence plus the resulting network information. |

Both tools resolve the target case through one shared helper, in this order:

1. the optional `case` argument — a workspace-relative `data/…` path, an
   absolute path containing `/wspace/data/`, or a preset label (`IEEE 118-bus`,
   `IEEE 14-bus`, `Texas 2K-bus`);
2. the case currently selected in the InterPSS tab — the tab reports every
   selection change (preset, custom path, file picker, remount) through the
   `checkResult` RPC, which the Host records per session;
3. the case the embedded bridge already holds.

The result names the case and which of those sources produced it.

`interpss_network_info` loads the case into the embedded bridge as part of the
call. A case the bridge already holds is reused instead of reloaded, so a
converged AC load flow is preserved rather than replaced by base-case values.

`interpss_run_aclf` solves the case and writes
`<stem>_DF_{bus,branch,gen,load}.csv` plus `<stem>_network_info.txt` under
`wspace/<case dir>/result/`, so the report tools can consume them. Solver options
come from the case-folder `aclf_run.json` when present, otherwise
`config/aclf_run.json` — the same two-tier rule as `ProjectPaths`. A run that
does not converge is still a successful call (`converged: false`); large cases
can take minutes.

### Result explorer on the ACLF card

`runAclfTool` projects a small `presentationMeta` (`case`, `source`, `resultDir`,
`converged`, `files`) that the harness persists to the tool card's `block.meta`.
The Client half registers `tool.call.toolview` under the `interpss_run_aclf` key
and renders Bus / Branch / Gen / Load tables from that metadata, fetching rows in
100-row pages through the existing `interpss/readCsv` RPC — the same endpoint the
tab's explorer uses, so both stay consistent. The card declines to the generic
tool row when it is still running, errored, or carries no usable metadata (a
replayed log from an older version), instead of rendering an empty explorer.

A **Report** button sits next to those scopes. It generates the AC Loadflow
Markdown report from the run's CSVs and opens the file in the harness file
surface. It passes `reportType: 'aclf'` explicitly, so a case that also has a
`*_DF_contingency.csv` still gets the load-flow report rather than the NERC one;
the tab's own Report button keeps its contingency-based auto-selection.

Adding a tool needs no new Typert endpoint: host-side definitions live in
`lib/index.js` (`networkInfoTool`, `runAclfTool`) and are registered together at
the end of `apply()`. A tool that wants a custom card adds one
`tool.call.toolview` registration in `lib/client.js`, keyed by its wire name.

## Prerequisites

The tab activates only inside an **iPSS Agent** workspace (see *Activation
gate* below). That workspace must contain the runtime the Host half calls:

- **Java JDK 21** on `PATH`
- `target/ipss-agent-cmd-1.0.0-uber.jar` built from the project root (`./mvnw -q clean package`; see [Setup.md](../Setup.md))
- `wspace/data/**` case files
- `config/aclf_run.json`

The Host prefers in-process calls via `java-bridge` and the uber JAR. If the
bridge is unavailable, it falls back to shelling out with a classpath of
`target/classes`, `lib/ipss_runnable.jar`, and `lib/deps/*`.

## Install

See `InstallDSHPlugin.md` in the repository root. Two methods:

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

The distributable is the npm tarball; no zip is produced:

```sh
cd interpss-persistent
npm pack    # -> deepseek-ai-dsh-interpss-<version>.tgz
```
