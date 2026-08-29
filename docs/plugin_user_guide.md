# InterPSS DSH Plugin User Guide

## Overview

The InterPSS DSH Plugin adds an **InterPSS** tab to the DeepSeek Harness web GUI. Use it to:

- Load IEEE CDF (`.ieee`) or PSS/E RAW (`.raw` / `.RAW`) cases
- Run AC load flow (ACLF) and DC contingency analysis (CA)
- Explore bus / branch / gen / load / contingency result CSVs
- Inspect bus connection relationships (diagram and tables)
- Generate an **AC Loadflow Report** or a **NERC TPL-001-5** report

![InterPSS DSH Plugin](../image/ipss-dsh-plugin.png)

For natural-language runs in the Chat tab (`/ipss-sim` and related skills), see the [repository README](../README.md). This guide covers the InterPSS tab UI only.

### Prerequisites

- DeepSeek Harness with the InterPSS plugin installed — see [InstallDSHPlugin.md](../InstallDSHPlugin.md)
- An **iPSS Agent** workspace with:
  - **Java JDK 21** on `PATH`
  - Built CLI: `target/ipss-agent-cmd-1.0.0-uber.jar` (`./mvnw -q clean package`; see [Setup.md](../Setup.md))
  - Case files under `wspace/data/**`
  - ACLF options file: `config/aclf_run.json`



### Activation gate

The InterPSS tab only enables its tools when the workspace `README.md` first `#` heading is exactly `iPSS Agent`. Otherwise the tab shows:

> InterPSS is not available in this workspace. Please install iPSS Agent from GitHub first

---



## Open the InterPSS tab

1. After installing or updating the plugin, restart `dsh web` and hard-reload the browser page.
2. In the conversation view, open the **InterPSS** tab (next to Chat).
3. The last **Simu Case** selection is remembered when you switch away and back.

---



## Load a simulation case

InterPSS DSH Plugin uses an In-Memory Computing (IMC) approach. When a simulation case is loaded, the loaded InterPSS simulation model will stay in memory, available for the simulation runs until another simulation case is loaded or the DSH runtime is shutdown. Therefore, ACLF and CA buttons stay disabled until a case is loaded into the simulation model.

1. Choose a case from **Simu Case**:
  - **IEEE 118-bus** — `data/ieee/Ieee118Bus/ieee118.ieee`
  - **IEEE 14-bus** — `data/ieee/Ieee14Bus/ieee14.ieee`
  - **Texas 2K-bus** — PSS/E RAW under `data/psse/Texas2K/`
  - **Select…** — custom case
2. For a custom case:
  - Set format to **IEEE CDF** or **PSS/E RAW**.
  - Enter a path relative to the workspace (for example `data/ieee/Ieee118Bus/ieee118.ieee`), or click the search icon to open the case picker.
  - The picker lists matching files under `wspace/data`, filtered by the selected format.
3. Click **Load**.
  - Success: `✓ Loaded: N buses, M branches`, plus a **Network info** panel.
  - Failure: `⚠` with an error message.



### Prior results on case change

When you select a case that already has a converged result (`*_network_info.txt` and result CSVs under the case’s `result/` folder), the tab can show that prior ACLF output without re-running. Use **ACLF** again when you want a fresh solve.

---



## Perform AC Load Flow Analysis

1. Load a case (see above).
2. Optionally open **AC Loadflow options** (gear next to **ACLF**) and save settings.
3. Click **ACLF**.

On success:

- `✓ Load flow converged`
- Result directory and file list
- **Explore result files** buttons: Bus, Branch, Gen, Load
- **Show log info** / **Hide log info** for stdout/stderr (not shown for auto-loaded prior results)

On failure, the tab shows `✗ Load flow failed` with error and log output.

### Result files

Results are written under `wspace/<case-parent>/result/`:


| File                      | Contents                              |
| ------------------------- | ------------------------------------- |
| `<stem>_DF_bus.csv`       | Bus voltages and related quantities   |
| `<stem>_DF_branch.csv`    | Branch flows / loadings               |
| `<stem>_DF_gen.csv`       | Generator results                     |
| `<stem>_DF_load.csv`      | Load results                          |
| `<stem>_network_info.txt` | Network summary used for auto-display |


`<stem>` is derived from the case file name (without extension).

---



## AC Loadflow Options

Click the gear button next to **ACLF** (enabled after **Load**). The dialog title is **Run AC Loadflow**. Changes apply to later ACLF runs after you click **Save** (writes `config/aclf_run.json`).

Three tabs:

### Main

- **Loadflow Method** — NR, PQ, or GS
- **Coordinate** — Polar or XY
- **Tolerance** and unit (PU / MVA)
- **Max Iterations** and **Non-Divergent**
- **Low Load Volt Adjust**, with **ConstP Vmin** / **ConstI Vmin** when enabled
- Helpers: **Apply PV Gen QLimit In Init**, **Turn Off Island Bus**, **Auto Set Zero-Z Branch**, **Auto Turn Line to Xformer**
- **Include Adjustments/Controls** — master switch for limit / voltage / power adjustment checkboxes on this tab; also enables the **Adj/Ctrl Setting** tab

When Include Adjustments is on, you can toggle:

- Limit control (PV/PQ bus limits, backoff check)
- Voltage adjustment (remote Q, xfr tap, switched shunt, SVC, HVDC tap, discrete adjust)
- Power adjustment (PS-xfr P control)



### NR Config

- **Optimize Algorithm**
- **Variable Update Limit**, delta voltage angle/magnitude limits
- **Stop No Solution Found**, **Min Scale Factor**



### Adj/Ctrl Setting

Available only when **Include Adjustments/Controls** is checked. Groups:

- **Limit Ctrl** — start point, error factor, apply type
- **Voltage Adj** — start point, tolerance (PU), apply type, dQ/dV threshold
- **Power Adj** — start point, error factor, apply type
- **Acceleration Factors** — PV/PQ limit, remote Q, SVC, xfr tap, PS-xfr

Use **Close** to dismiss without saving, or **Save** to persist options.

---



## Explore Results

After a successful ACLF (or when prior results are shown), use **Explore result files**.

Tables support sticky headers and infinite scroll (`Showing N of M rows` until all rows are loaded).

### Bus Results

1. Click **Bus** to open the bus CSV table.
2. Click a row to select a bus (shown as **Selected bus: …**).
3. Right-click a bus row → **Connection info** to open the connection popup.
4. In Gen or Load tables, double-click a bus ID cell to select that bus.



### Branch / Gen / Load Results

Click **Branch**, **Gen**, or **Load** to view the corresponding CSV. Numeric columns are formatted for readability where applicable.

### Contingency Results

The **Contingency** explorer button appears after a successful **CA** run in the current session (see below). It opens the contingency result CSV.

### Bus connection relationships

From the bus table context menu (**Connection info**), or by navigating from Gen/Load bus IDs:

1. A popup titled `<busId> — branch connections` opens.
2. Switch views:
  - **Diagram** — connected buses and branches; hover for tooltips; transformers styled distinctly; double-click a node to select or navigate to that bus
  - **Branch** — connection table
  - **Gen** / **Load** — equipment at the selected bus (or a short empty-state message)
3. A count label shows connections, generators, or loads for the active view.

---



## Perform Contingency Analysis

1. Place companion JSON files in the **same directory** as the case file:
  - A file whose name contains `contingenc` (contingency list)
  - A file whose name contains `monitor` (monitored branches)
2. **Load** the case.
3. Click **CA** (title: “Run DC contingency analysis”).

On success:

- `✓ Contingency analysis complete`
- Contingency result file name (typically `<stem>_DF_contingency.csv`)
- A **Contingency** button to open that CSV in the explorer

If the companion JSONs are missing, the host returns an error such as:

> Contingency analysis requires contingency and monitored-branches JSON files in case-dir.

CA requires a loaded case. You can run CA after Load even if you have not clicked **ACLF** in this session; contingency CSV exploration for the new CA run appears once CA succeeds.

---



## Generate Reports

1. Ensure result CSVs exist (run **ACLF**, and **CA** if you need a NERC-style report).
2. Click **Report** when it is enabled (the tab checks that result files are available).

Report type is chosen automatically:


| Condition                                 | Report                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| Contingency CSV present in the result dir | **NERC TPL-001-5 Report** → `NERC_TPL_001_5_Report.md` |
| Otherwise                                 | **AC Loadflow Report** → `AC_Loadflow_Report.md`       |


In the report dialog:

- Wait for **Generating report…** if needed
- Toggle **Rendered** (formatted Markdown) or **Source** (raw Markdown)
- Close with ✕

---



## Tips and troubleshooting


| Symptom                                        | What to check                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| “InterPSS is not available in this workspace…” | Workspace `README.md` first H1 must be exactly `iPSS Agent`.                                                        |
| **ACLF** / **CA** greyed out                   | Click **Load** successfully first.                                                                                  |
| Case picker empty                              | No matching `.ieee` or `.raw`/`.RAW` under `wspace/data` for the selected format.                                   |
| CA fails with JSON message                     | Add contingency and monitored-branch JSON files in the case directory (name must contain `contingenc` / `monitor`). |
| **Report** greyed out                          | No converged result CSVs yet — run ACLF (and CA for NERC).                                                          |
| Gear disabled                                  | Load a case first.                                                                                                  |
| Adj/Ctrl Setting tab disabled                  | Enable **Include Adjustments/Controls** on the Main options tab.                                                    |




### Related (outside this tab)

- Chat / `/ipss-sim` skill — [README](../README.md)
- Interactive HTML dashboards and NERC slide decks — see the README Reference table (nerc-report-html / nerc-report-slides skills)
- Install or update the plugin — [InstallDSHPlugin.md](../InstallDSHPlugin.md)

