---
name: ipss-sim
description: Use when running InterPSS AC load flow, DC contingency analysis, or generating NERC TPL-001-5 reports from IEEE CDF or PSS/E RAW case files. Supports directory auto-discovery and explicit single-file workflows.
metadata:
  short-description: Run InterPSS simulations and reports
---

# InterPSS Simulation

Run power system simulations (AC load flow, contingency analysis) and generate NERC TPL-001-5 compliance reports via the InterPSS native Java CLI (`IpssCmd`) and its pure-Python report generators.

## Prerequisites

- Java JDK 21
- Maven (the repo includes the `mvnw` wrapper)
- `config/aclf_run.json` present for ACLF solver options (checked into the repo)
- All simulation commands run from `wspace/`

If the CLI JAR is missing, build it from the project root first.

macOS / Linux:

```bash
./mvnw -q clean package
```

Windows PowerShell:

```powershell
.\mvnw.cmd -q clean package
```

This produces the self-contained Uber JAR `target/ipss-agent-cmd-1.0.0-uber.jar`.

## Input Modes

The command supports two input modes:

## Quick Decision Guide

- **ACLF-only request** (base-case solve + loadflow report): run **Step 1** then **Step 3**
- **Full TPL workflow** (ACLF + CA + NERC report): run **Step 1**, **Step 2**, then **Step 4**
- **Contingency-only refresh** (ACLF already available): run **Step 2** then **Step 4**

### Single File Mode

Provide individual file paths for the case file, contingency JSON, and monitored branches JSON:

```
/ipss-sim <input_path> [<contingency_json> <monitored_branches_json>] in <format> "<NERC Report Name>"
```

- `input_path` — PSS/E RAW (.raw/.RAW) or IEEE CDF (.ieee) case file
- `contingency_json` — (optional) contingency definitions for CA
- `monitored_branches_json` — (optional) monitored branches for CA
- `format` — `psse` (.raw/.RAW) or `ieee` (.ieee), automatically inferred if not specified

### Directory Mode

Provide a directory path containing all input files. The tool auto-discovers files with the following naming conventions:

```
/ipss-sim <directory_path> "<NERC Report Name>"
```

- **Case file:** any `*.RAW` or `*.raw` (PSS/E) or `*.ieee` (IEEE CDF) file in the directory
- **Contingency JSON:** `*contingency`* or `*contingencies`* JSON file in the directory
- **Monitored branches JSON:** `*monitor`* JSON file in the directory

**Example:**

```
# Directory containing Texas2k_series24_case1_2016summerPeak_v36.RAW,
# 2k_contingencies_115kVAbove.json, and 2k_monitored_branches.json
/ipss-sim data/psse/Texas2K/
```

When a directory is provided, the format is auto-detected from the case file extension.

## Step 1: Run AC Load Flow (ACLF)

```
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf <format> <input_path>
```

**Formats:**

- `ieee` — IEEE Common Data Format (`.ieee`)
- `psse` — PSS/E RAW format (`.raw`, `.RAW`)

**Examples:**

```
# IEEE 118 bus
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee

# PSS/E Texas 2K bus
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

**Output:** CSV files written to `<input_parent>/result/`:

- `<case>_DF_bus.csv` — bus voltage magnitude/angle
- `<case>_DF_branch.csv` — branch power flows
- `<case>_DF_gen.csv` — generator outputs
- `<case>_DF_load.csv` — load data
- `<case>_network_info.txt` — AclfNetwork summary and loadflow run information (included in NERC report)

**ACLF solver settings:** `IpssCmd` resolves `aclf_run.json` with a two-tier lookup:

1. **Case-specific config** (preferred): `<input_parent>/config/aclf_run.json` — e.g. `data/psse/OpenEInterconnect/config/aclf_run.json`. Place a per-case config here when a particular model needs different NR settings (more iterations, tighter tolerance, etc.).
2. **Project default** (fallback): `config/aclf_run.json` at the repo root.

The resolved config is loaded via `AclfRunConfigRec.loadAclfRunConfig` and applied with `configAclfRun(algo, polarCoordinate, includeAdjustments, False)`. The CLI prints `Using config file: <path>` to stderr so you can verify which file was used. Edit either JSON to tune NR method, `maxIterations`, tolerance, limit controls, and related options.

## Step 2: Run Contingency Analysis (CA)

```
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca <format> <input_path> <contingency_json> <monitored_branches_json>
```

**Format:** Use `psse` (PSS/E RAW input).

**JSON files:**

- `<contingency_json>` — contingency definitions (outage scenarios)
- `<monitored_branches_json>` — branches to monitor post-contingency

**Example:**

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

**Output:** `<case>_DF_contingency.csv` written alongside the ACLF CSVs, containing post-contingency branch loading results.

## Step 3: Generate AC Load Flow (ACLF-Only) Report

Use this when the user asks for an ACLF report only (no contingency/TPL sections).

```
cd wspace
python3 ../src/report/generate_aclf_report.py "<display_name>" <result_dir> [csv_prefix]
```

**Parameters:**

- `display_name` — Human-readable system name for the report header (e.g., `"IEEE 118-Bus System"`)
- `result_dir` — Path **relative to `wspace/`** containing ACLF CSVs, e.g. `data/ieee/Ieee118Bus/result`
- `csv_prefix` — (optional but recommended when multiple cases share one `result_dir`) CSV stem such as `ieee14` or `ieee118`

**Examples:**

```
# Single-case result directory
python3 ../src/report/generate_aclf_report.py "Texas 2000-Bus System" data/psse/Texas2K/result

# Shared result directory (explicit prefix avoids picking another case)
python3 ../src/report/generate_aclf_report.py "IEEE 14-Bus System" data/ieee/Ieee14Bus/result ieee14
```

**Output:** `AC_Loadflow_Report.md` written next to the CSVs in the result directory.

## Step 4: Generate NERC TPL-001-5 Report

```
cd wspace
python3 ../src/report/generate_nerc_tpl_report.py "<display_name>" <result_dir>
```

**Parameters:**

- `display_name` — Human-readable system name for the report header (e.g., `"Texas 2000-Bus System"`)
- `result_dir` — Path **relative to `wspace/`** to the folder that contains the ACLF/CA CSVs (same folder the ACLF/CA CLI writes to), e.g. `data/ieee/Ieee118Bus/result` or `data/psse/Texas2K/result`. A subdirectory name under `wspace/result/` still works for older layouts.

**CSV requirements in that folder:**

- `<prefix>_DF_bus.csv`
- `<prefix>_DF_branch.csv`
- `<prefix>_DF_gen.csv`
- `<prefix>_DF_load.csv`
- `<prefix>_DF_contingency.csv` (optional, for P1–P7 assessment)
- `<prefix>_network_info.txt` (optional, used for AclfNetwork summary section in report)

**Examples:**

```
python3 ../src/report/generate_nerc_tpl_report.py "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
python3 ../src/report/generate_nerc_tpl_report.py "Texas 2K-Bus System" data/psse/Texas2K/result
```

Single-argument **aliases** (`ieee118`, `texas2k`, plus short forms via `KNOWN_CASE_ALIASES` in `src/report/generate_nerc_tpl_report.py`) still work when results are under `wspace/result/` — see [Setup.md](../../../Setup.md).

**Output:** `NERC_TPL_001_5_Report.md` written **next to the CSVs** (e.g. `wspace/data/psse/Texas2K/result/`).

## Result Directory Convention

The `IpssCmd` CLI writes ACLF results based on the input file's parent directory:

- `data/ieee/Ieee118Bus/ieee118.ieee` → `wspace/data/ieee/Ieee118Bus/result/`
- `data/psse/Texas2K/ieee9_v36.raw` → `wspace/data/psse/Texas2K/result/`

CA results are written to the same directory.

Pass that same `.../result` path as `result_dir` to `../src/report/generate_aclf_report.py` (Step 3) or `../src/report/generate_nerc_tpl_report.py` (Step 4). Optional: keep copies or symlinks under `wspace/result/` only if you rely on single-argument alias discovery.

## Troubleshooting

- **NR load flow does not converge**: Raise `maxIterations` (and adjust `tolerance` if needed) in `config/aclf_run.json`; large systems often need 100+ iterations
- **`Could not find or load main class` / missing `ipss-agent-cmd-1.0.0-uber.jar`**: Build the CLI first with `./mvnw -q clean package` (or `.\mvnw.cmd -q clean package` on Windows)
- **Results not found by report generator**: Pass the correct `result_dir` relative to `wspace/` (e.g. `data/psse/Texas2K/result`), or symlink the case under `wspace/result/` for alias-only usage
- **OutOfMemoryError / JVM heap exhaustion for large cases (>50K buses)**: Raise the JVM max heap with the `-Xmx` flag directly on the `java` command:
  ```bash
  java -Xmx4g -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf psse data/psse/Texas2K/...
  ```
  Scale up (e.g. `-Xmx8g`) for very large cases.
