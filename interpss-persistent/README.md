# InterPSS — persistent Cordis plugin for DeepSeek Harness

A persistent, installable dual-face Cordis plugin for the DeepSeek Harness web
GUI. It adds an **InterPSS** tab (next to Chat) for running power-system AC load
flow on IEEE CDF / PSS/E RAW cases, exploring the bus/branch/gen/load results,
and generating a **NERC TPL-001-5** contingency report — plus a **Diagram** tab
(0.6.8) that draws the selected case's draw.io one-line diagram full-size.

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
| `lib/client.js` | Client half: the InterPSS and Diagram tabs, registered in `conversation.view`; calls the Host via `/api` RPC. |
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
- **CA dialog** — the CA button opens a *Run Contingency Analysis* dialog that picks
  the contingency and monitored-branch inputs (all N-1 / every branch, or a `.json`
  from the case folder, with the entry count shown after the pick), sets the
  **Over Loading Threshold(%)** the screening reports against (default 90, 0.4.6+; written with the
  other four keys since 0.4.7),
  saves them as
  `config/ca_run.json` beside that case's `config/aclf_run.json`, and runs CA — the same file the
  CLI reads (OK = save + run, Cancel = write nothing).
- **NERC TPL-001-5 Report** button (enabled once a converged result's CSV files are present) with a rendered/source viewer.
- "Show log info" toggle for the raw run output (hidden for auto-loaded results).
- **Diagram tab** (0.6.8; the only preview surface since 0.6.9) — a second conversation view
  (Chat · InterPSS · **Diagram** · Trajectory) that draws the **selected case's**
  `diagram/*.drawio` full-size. It follows the InterPSS tab's *Simu Case* selection (and a case
  loaded from chat), offers a picker when the folder holds several files — reopening the one
  last viewed — and gives the diagram pan / zoom / fit, a Rendered / Source toggle and
  bus/branch tooltips, and (0.6.12; at the right end of the top row since 0.6.15) a
  draw.io button that opens the file in the **local draw.io
  desktop app** to edit it. It reuses `listDrawioFiles`, `readDrawio`, `checkResult` and
  `busConnections`, and the launcher is the one new endpoint (`openDrawio`, over the sandbox-aware
  `subprocess` service — no `node:child_process`, since the dynamic half has no imports). 0.6.9
  removed the **Diagram** button (and the modal it
  opened) from the InterPSS tab's action row: the tab is the preview now, so the two surfaces
  cannot drift apart.
- Remembers the last selected case across tab switches.
- **Chat tools** — `interpss_network_info` and `interpss_run_aclf` expose the selected case's network info and AC load flow to the chat agent (see *Chat tools*).
- **ACLF result explorer in chat** — the `interpss_run_aclf` card offers Bus / Branch / Gen / Load tables, paged through the same `readCsv` RPC as the tab, plus a **Report** button that generates the AC Loadflow report.
- **Network-info card in chat** — the `interpss_network_info` card shows the network summary directly, instead of behind the generic row's expand toggle.

## Host RPC methods

`isActivated`, `checkResult`, `checkResultFiles`, `listCases`, `readCsv`,
`busConnections`, `runAclf`, `runCa`, `runReport`, `getAclfOptions`,
`saveAclfOptions`, `listCaFiles`, `getCaOptions`, `saveCaOptions`, `loadCase`,
`summarizeResult`, `getNetworkInfo`, `getBridgeCase`, `listDrawioFiles`,
`readDrawio`, `openDrawio`.

## Chat tools

The Host half also registers model Tools, so the same capability is reachable
from the chat agent instead of only from the tab. Registration is global to the
host process (this row applies at the host level) and each call is gated on the
iPSS Agent workspace activation check.

| Tool | Purpose |
| --- | --- |
| `interpss_case_load` | Load the selected simulation case into the embedded bridge. No-op (`alreadyLoaded: true`) when the bridge already holds it; call it before the other tools. Result tables in the **InterPSS tab** sort by any column (0.4.4+), with the Contingency table opening worst-loading-first. A load also moves the session's current case, the tab's Simu Case picker and its `✓ Loaded: N buses, M branches` indicator mirror it (0.3.19/0.3.22), and its card prints the same line (0.3.21). |
| `interpss_network_info` | Show the InterPSS network information (active buses and branches, total generation and load, load-flow convergence, max mismatch) of a simulation case. |
| `interpss_run_aclf` | Run an AC load flow (ACLF) on a simulation case and report convergence plus the resulting network information. |
| `interpss_case_summary` | Summarize the bridge-held case: net totals (convergence, counts, generation, load, max mismatch), or a top-N ranking by `bus` / `gen` / `load` / `branch`. |
| `interpss_run_ca` | Run a DC contingency analysis (N-1 screening) on the held case without the CA dialog: inputs come from `contingencyFile`/`monitorFile`, else the case-folder `config/ca_run.json`, else case-folder discovery, else the Java N-1 defaults; `overloadThreshold` (0.4.6+) sets the over loading threshold the run reports against (argument → `ca_run.json` → 90). Writes `<stem>_DF_contingency.csv`, browsable from the card's **Explore result → Contingency** row (0.4.2+), which opens sorted by `LoadingPercent` with clickable headers (0.4.3+). |
| `interpss_run_gvy` | Apply Groovy to the bridge-held case (binding `aclfnet`), reporting the script's return value and a before/after model digest. `script` takes a `.gvy` file from the case folder's `scripts/` directory, the source itself (0.4.9+), or an array of those applied in order (0.4.11+ — stops at the first failure, `steps` reports each one). Whitespace or statement punctuation marks source, a single bare word is a file name. |

The first three tools resolve the target case through one shared helper, in this order:

1. the optional `case` argument — a workspace-relative `data/…` path (its
   `wspace/data/…` spelling is accepted too since 0.3.18), an
   absolute path containing `/wspace/data/`, or a preset label (`IEEE 118-bus`,
   `IEEE 14-bus`, `Texas 2K-bus`);
2. the case currently selected in the InterPSS tab — the tab reports every
   selection change (preset, custom path, file picker, remount) through the
   `checkResult` RPC, which the Host records per session;
3. the case the embedded bridge already holds.

The result names the case and which of those sources produced it.

`interpss_case_load` is the explicit load step and the recommended first call when
the selected case has not been loaded yet. It goes through the same
`javaBridge.caseInfo` path, so it reuses a case the bridge already holds — reporting
`alreadyLoaded: true` without re-parsing — and otherwise loads it and reports the
active bus/branch counts. It deliberately does not return the network-info text;
that is `interpss_network_info`'s job. Nothing enforces the order: the other tools
still load on demand.

`interpss_network_info` loads the case into the embedded bridge as part of the
call. A case the bridge already holds is reused instead of reloaded, so a
converged AC load flow is preserved rather than replaced by base-case values.

`interpss_case_summary` reads the cached model — the case only has to be loaded, not solved — and
returns the case-wide totals with `scope: net`, or a bounded ranked row list (`numRec`, default 10,
capped at 100) for the other scopes. Only `converged` is reported by every scope — the remaining
totals stay on the `net` call so a ranked card does not repeat them. It is a port of `IpssAgentBridge.summarize()`, with two tool-level changes: the
Java result container *always* carries every section in full (only the requested one is ranked),
so the Host slices it instead of forwarding it; and an unknown `scope` is rejected where the RPC
would silently fall back to `net`. Branch ranking is by flow magnitude, not rating loading.

`interpss_run_gvy` edits the held model through InterPSS's Groovy script adapter
(`org.interpss.agent.script.gvy.AclfNetDshGvyScriptProcessor`, bindings `aclfnet` + `senAlgo`). The script
file is resolved inside the **case folder's `scripts/` directory** (a bare file
name, or a `data/…/scripts/x.gvy` path); the Host and the Java bridge both refuse
anything else. Scripts mutate the model in place with no rollback, so `reload: true`
re-parses the case first, and solving stays a separate `interpss_run_aclf` call.
The tool reports the script's scalar return value, captured `println` output, and
`loadMw` / `generationMw` before and after, so a mutation-only script still shows
what it changed. Groovy 4.0.x is a Maven dependency merged into the uber JAR.

`interpss_run_aclf` solves the case and writes
`<stem>_DF_{bus,branch,gen,load}.csv` plus `<stem>_network_info.txt` under
`wspace/<case dir>/result/`, so the report tools can consume them. Solver options
come from the case-folder `config/aclf_run.json` when present, otherwise
`config/aclf_run.json` — the same two-tier rule as `ProjectPaths`. A run that
does not converge is still a successful call (`converged: false`); large cases
can take minutes.

### Result explorer on the ACLF card

`runAclfTool` projects a small `presentationMeta` (`case`, `source`, `resultDir`,
`converged`, `files`) that the harness persists to the tool card's `block.meta`.
The Client half registers `tool.call.toolview` under the `interpss_run_aclf` key
and renders Bus / Branch / Gen / Load tables from that metadata, fetching rows in
100-row pages through the existing `interpss/readCsv` RPC — the same endpoint the
tab's explorer uses, so both stay consistent. The next page is appended
automatically when the table is scrolled to the bottom (the same 40 px threshold
the tab uses), with no explicit *Load more* control. The card declines to the generic
tool row when it is still running, errored, or carries no usable metadata (a
replayed log from an older version), instead of rendering an empty explorer.

A **Report** button sits next to those scopes. It generates the AC Loadflow
Markdown report from the run's CSVs and opens the file in the harness file
surface. It passes `reportType: 'aclf'` explicitly, so a case that also has a
`*_DF_contingency.csv` still gets the load-flow report rather than the NERC one;
the tab's own Report button keeps its contingency-based auto-selection.

Adding a tool needs no new Typert endpoint: host-side definitions live in
`lib/index.js` (`caseLoadTool`, `networkInfoTool`, `runAclfTool`, `caseSummaryTool`)
and are registered together at the end of `apply()`. A tool that wants a custom card adds
one `tool.call.toolview` registration in `lib/client.js`, keyed by its wire name.

### Short-result cards

`interpss_case_load`, `interpss_network_info` and `interpss_case_summary` share one
card implementation: `toolTextCard(label)` in `lib/client.js` returns a hook-free
component that renders the settled result text directly. The shipped generic tool row hides a tool's
output behind an expand toggle, which left both summaries invisible in the
conversation. Every card renders in every state (running, error, replayed log)
because a registered key *replaces* the generic row rather than falling back to it.

Their `presentationMeta` carries `{ ok, case, source, … }` for the title line —
`lfConverged` for the info tool, `alreadyLoaded` / `format` for the load tool.

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

See `InstallDSHPlugin.md` in the repository root. Three methods:

1. **DSH Desktop (plugin manager)** — the app owns the `desktop` profile and the
   `dsh` CLI refuses it (`profile "desktop" is managed exclusively by the
   Electron application`), so install the bundle through the app's plugin
   manager and reopen the app:

   ```text
   install the bundle at /path/to/deepseek-ai-dsh-interpss-<version>.tgz
   ```

2. **Automatic (`dsh plugin`, web profile)** — from the unzipped directory or the npm
   tarball:

   ```sh
   dsh plugin --profile web add /path/to/dsh-interpss
   # or
   dsh plugin --profile web add /path/to/deepseek-ai-dsh-interpss-<version>.tgz
   ```

   This pnpm-installs the package into the profile and reconciles it into
   `dsh.profile.bundles`; the bundle's `cordis.patch.yml` inserts the
   `interpss` row automatically. No manual patch editing needed.

3. **Manual copy** — copy the package under the profile and add the row by
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

For the web profile, restart the web server (`dsh web`), then hard-reload the page; for
DSH Desktop, quit and reopen the app.

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
