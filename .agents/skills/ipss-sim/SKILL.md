---
name: ipss-sim
description: Use when running InterPSS AC load flow, DC contingency analysis, or generating NERC TPL-001-5 reports from IEEE CDF or PSS/E RAW case files. Supports directory auto-discovery and explicit single-file workflows.
metadata:
  short-description: Run InterPSS simulations and reports
---

# InterPSS Simulation

Run AC load flow (ACLF), DC contingency analysis (CA), and Markdown reports through the native Java CLI (`IpssCmd`). All simulation commands run from `wspace/`.

## Prerequisites

- Java JDK 21
- Maven (`mvnw` wrapper included)
- `config/aclf_run.json` at repo root (ACLF solver defaults)
- Built uber JAR: `target/ipss-agent-cmd-1.0.0-uber.jar`

Build the CLI once from the project root:

```bash
./mvnw -q clean package          # macOS / Linux
.\mvnw.cmd -q clean package      # Windows
```

Produces `target/ipss-agent-cmd-1.0.0-uber.jar`.

Run tests (optional):

```bash
./mvnw test
open target/site/jacoco/index.html
```

See [Setup.md](../../../Setup.md) for full environment details.

## Quick Decision Guide

| User request | Run |
|---|---|
| ACLF only (base-case + loadflow report) | **Step 1** → **Step 3** |
| Full NERC TPL workflow | **Step 1** → **Step 2** → **Step 4** |
| Refresh CA / TPL (ACLF CSVs already exist) | **Step 2** → **Step 4** |

## Invocation Syntax

Agents invoke this skill as `/ipss-sim` (Claude) or `$ipss-sim` (Codex). Paths below are relative to `wspace/` unless noted.

### Directory mode (preferred)

Auto-discovers case + companion JSON files in one folder:

```
/ipss-sim <directory_path> "<Report Name>"
```

- **Case file:** `*.RAW`, `*.raw`, or `*.ieee`
- **Contingency JSON:** filename contains `contingency` or `contingencies`
- **Monitored branches JSON:** filename contains `monitor`

Example:

```
/ipss-sim data/psse/Texas2K/ "Texas 2K-Bus System"
```

Format is inferred from the case file extension.

### Single-file mode

```
/ipss-sim <input_path> [<contingency_json> <monitored_branches_json>] [in <format>] "<Report Name>"
```

- `input_path` — IEEE CDF (`.ieee`) or PSS/E RAW (`.raw`/`.RAW`)
- `contingency_json`, `monitored_branches_json` — optional; required for CA
- `format` — `ieee` or `psse` (inferred from extension when omitted)

### ACLF-only shortcut

When the user says "Aclf only" or wants no contingency/TPL sections:

```
/ipss-sim Aclf only <directory_or_case> "<Loadflow Report Name>"
```

Run **Step 1** then **Step 3** only.

## Step 1: AC Load Flow (ACLF)

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf <format> <input_path>
```

Formats: `ieee` (`.ieee`) | `psse` (`.raw`/`.RAW`)

Examples:

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

**Output** in `<input_parent>/result/`:

| File | Content |
|---|---|
| `<case>_DF_bus.csv` | Bus voltage magnitude/angle |
| `<case>_DF_branch.csv` | Branch flows |
| `<case>_DF_gen.csv` | Generator output |
| `<case>_DF_load.csv` | Load data |
| `<case>_network_info.txt` | Network summary + convergence info |

**ACLF config lookup** (printed as `Using config file: …`):

1. Case-specific: `<input_parent>/config/aclf_run.json` (preferred)
2. Project default: `config/aclf_run.json`

Tune NR method, `maxIterations`, tolerance, and limit controls in either JSON.

## Step 2: Contingency Analysis (CA)

Requires contingency and monitored-branch JSON paths (explicit or auto-discovered):

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca <format> <input_path> <contingency_json> <monitored_branches_json>
```

Example:

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

**Output:** `<case>_DF_contingency.csv` in the same `result/` folder.

## Step 3: ACLF Report (no TPL)

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report aclf "<display_name>" <result_dir> [csv_prefix]
```

- `result_dir` — path relative to `wspace/` (e.g. `data/ieee/Ieee14Bus/result`)
- `csv_prefix` — optional stem when multiple cases share one `result/` dir (e.g. `ieee14`)

**Output:** `AC_Loadflow_Report.md` next to the CSVs.

## Step 4: NERC TPL-001-5 Report

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "<display_name>" <result_dir>
```

Required CSVs in `result_dir`: `<prefix>_DF_{bus,branch,gen,load}.csv`. Optional: `<prefix>_DF_contingency.csv`, `<prefix>_network_info.txt`.

**Output:** `NERC_TPL_001_5_Report.md` next to the CSVs.

Legacy Python generators remain in `src/report/` if needed.

Follow-on artifacts: use `$nerc-report-html` or `$nerc-report-slides` skills for interactive HTML or slide decks.

## Result Directory Convention

Input parent determines output location:

- `data/ieee/Ieee118Bus/ieee118.ieee` → `wspace/data/ieee/Ieee118Bus/result/`
- `data/psse/Texas2K/case.RAW` → `wspace/data/psse/Texas2K/result/`

Pass the same `…/result` path to report generators in Steps 3–4.

## Troubleshooting

| Issue | Fix |
|---|---|
| NR does not converge | Raise `maxIterations` / adjust `tolerance` in `aclf_run.json` |
| Missing uber JAR | Run `./mvnw -q clean package` |
| Report generator can't find CSVs | Pass correct `result_dir` relative to `wspace/` |
| OutOfMemoryError on large cases | Add heap flag: `java -Xmx4g -jar ../target/ipss-agent-cmd-1.0.0-uber.jar …` |
