---
name: ipss-sim
description: Use when running InterPSS AC load flow, DC contingency analysis, or generating NERC TPL-001-5 reports from IEEE CDF or PSS/E RAW case files. Supports directory auto-discovery and explicit single-file workflows.
metadata:
  short-description: Run InterPSS simulations and reports
---

# InterPSS Simulation

Run power system simulations (AC load flow, contingency analysis) and generate NERC TPL-001-5 compliance reports via the native Java `IpssCmd` CLI.

## Prerequisites

- Java JDK 21
- `./mvnw package` completed at project root (produces `target/ipss-agent-cmd-1.0.0-shaded.jar`)
- `./mvnw -q dependency:copy-dependencies` if `lib/deps/` is incomplete
- `config/aclf_run.json` present for ACLF solver options
- All simulation commands run from `wspace/`

If the shaded JAR is missing, from the project root:

```bash
./mvnw -q dependency:copy-dependencies
./mvnw package
```

Windows PowerShell:

```powershell
.\mvnw.cmd -q dependency:copy-dependencies
.\mvnw.cmd package
```

Define a shell alias or variable for the JAR (examples below use the full path).

## Input Modes

## Quick Decision Guide

- **ACLF-only request** (base-case solve + loadflow report): run **Step 1** then **Step 3**
- **Full TPL workflow** (ACLF + CA + NERC report): run **Step 1**, **Step 2**, then **Step 4**
- **Contingency-only refresh** (ACLF already available): run **Step 2** then **Step 4**

### Single File Mode

```
/ipss-sim <input_path> [<contingency_json> <monitored_branches_json>] in <format> "<NERC Report Name>"
```

- `input_path` — PSS/E RAW (`.raw`/`.RAW`) or IEEE CDF (`.ieee`) case file
- `contingency_json` — (optional) contingency definitions for CA
- `monitored_branches_json` — (optional) monitored branches for CA
- `format` — `psse` or `ieee`, inferred from extension when omitted

### Directory Mode

```
/ipss-sim <directory_path> "<NERC Report Name>"
```

- **Case file:** `*.RAW`, `*.raw`, or `*.ieee` in the directory
- **Contingency JSON:** `*contingency*` / `*contingencies*` JSON
- **Monitored branches JSON:** `*monitor*` JSON

## Step 1: Run AC Load Flow (ACLF)

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf <format> <input_path>
```

**Formats:** `ieee` (`.ieee`), `psse` (`.raw`, `.RAW`)

**Examples:**

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

**Output** under `<input_parent>/result/`:

- `<case>_DF_bus.csv`, `<case>_DF_branch.csv`, `<case>_DF_gen.csv`, `<case>_DF_load.csv`
- `<case>_network_info.txt`

**ACLF solver settings:** `IpssCmd` resolves `aclf_run.json` with a two-tier lookup:

1. `<input_parent>/config/aclf_run.json` (case-specific)
2. `config/aclf_run.json` at repo root (default)

Stdout shows `Using config file: <path>`. Edit either JSON for NR/tolerance/limit controls.

## Step 2: Run Contingency Analysis (CA)

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ca <format> <input_path> <contingency_json> <monitored_branches_json>
```

**Example:**

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

**Output:** `<case>_DF_contingency.csv` alongside ACLF CSVs.

## Step 3: Generate AC Load Flow (ACLF-Only) Report

When the user wants a loadflow-focused Markdown report (no full TPL narrative), author `AC_Loadflow_Report.md` in the result directory by analyzing the ACLF CSVs and `*_network_info.txt`. Use thresholds from `config/gen_report.json`. See [GenReport.md](../../../GenReport.md).

**Result directory:** path relative to `wspace/`, e.g. `data/ieee/Ieee14Bus/result`.

## Step 4: Generate NERC TPL-001-5 Report

Author `NERC_TPL_001_5_Report.md` in the same `result/` folder using ACLF CSVs, optional `<prefix>_DF_contingency.csv`, and `*_network_info.txt`. For interactive HTML or slides afterward, use the `nerc-report-html` or `nerc-report-slides` skills.

**CSV requirements in `result_dir`:**

- `<prefix>_DF_bus.csv`, `<prefix>_DF_branch.csv`, `<prefix>_DF_gen.csv`, `<prefix>_DF_load.csv`
- `<prefix>_DF_contingency.csv` (optional)
- `<prefix>_network_info.txt` (optional)

## Result Directory Convention

`IpssCmd` writes results next to the case file:

- `data/ieee/Ieee118Bus/ieee118.ieee` → `wspace/data/ieee/Ieee118Bus/result/`
- `data/psse/Texas2K/...RAW` → `wspace/data/psse/Texas2K/result/`

Use that `.../result` path for report skills and analysis prompts.

## Troubleshooting

- **Shaded JAR missing:** Run `./mvnw package` from project root.
- **NR does not converge:** Increase `maxIterations` in the resolved `aclf_run.json`.
- **OutOfMemoryError:** Relaunch with `java -Xmx8g -jar ...` (scale heap as needed).
- **Results not found:** Pass `result_dir` relative to `wspace/` (e.g. `data/psse/Texas2K/result`).

See [Setup.md](../../../Setup.md) and [IpssCmd.md](../../../IpssCmd.md).
