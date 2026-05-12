---
name: ipss-sim
description: Use when running InterPSS AC load flow, DC contingency analysis, or generating NERC TPL-001-5 reports from IEEE CDF or PSS/E RAW case files. Supports directory auto-discovery and explicit single-file workflows.
metadata:
  short-description: Run InterPSS simulations and reports
---

# InterPSS Simulation

Run power system simulations (AC load flow, contingency analysis) and generate NERC TPL-001-5 compliance reports via the InterPSS Python runtime.

## Prerequisites

- Python 3.10+, Java JDK 21
- Virtual environment at project root `.venv` with `jpype1` and `numpy` installed
- Runtime JAR dependencies copied with `./mvnw -q dependency:copy-dependencies` on macOS/Linux or `.\mvnw.cmd -q dependency:copy-dependencies` on Windows
- `config/config.json` configured with JVM path, JAR classpath, and log config
- `config/aclf_run.json` present for ACLF solver options (checked into the repo)
- All commands run from `wspace/` with venv activated

If dependencies are missing, run this from the project root first.

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install jpype1 numpy
./mvnw -q dependency:copy-dependencies
```

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install jpype1 numpy
.\mvnw.cmd -q dependency:copy-dependencies
```

## Input Modes

The command supports two input modes:

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
source ../.venv/bin/activate
python ipss_cmd.py aclf <format> <input_path>
```

**Formats:**

- `ieee` — IEEE Common Data Format (`.ieee`)
- `psse` — PSS/E RAW format (`.raw`, `.RAW`)

**Examples:**

```
# IEEE 118 bus
python ipss_cmd.py aclf ieee data/ieee/ieee118.ieee

# PSS/E Texas 2K bus
python ipss_cmd.py aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
```

**Output:** CSV files written to `<input_parent>/result/`:

- `<case>_DF_bus.csv` — bus voltage magnitude/angle
- `<case>_DF_branch.csv` — branch power flows
- `<case>_DF_gen.csv` — generator outputs
- `<case>_DF_load.csv` — load data
- `<case>_network_info.txt` — AclfNetwork summary and loadflow run information (included in NERC report)

**ACLF solver settings:** `wspace/ipss_cmd.py` resolves `aclf_run.json` with a two-tier lookup:

1. **Case-specific config** (preferred): `<input_parent>/config/aclf_run.json` — e.g. `data/psse/OpenEInterconnect/config/aclf_run.json`. Place a per-case config here when a particular model needs different NR settings (more iterations, tighter tolerance, etc.).
2. **Project default** (fallback): `config/aclf_run.json` at the repo root.

The resolved config is loaded via `AclfRunConfigRec.loadAclfRunConfig` and applied with `configAclfRun(algo, polarCoordinate, includeAdjustments, False)`. The script prints `Using config file: <path>` to stderr so you can verify which file was used. Edit either JSON to tune NR method, `maxIterations`, tolerance, limit controls, and related options without changing Python code.

## Step 2: Run Contingency Analysis (CA)

```
cd wspace
source ../.venv/bin/activate
python ipss_cmd.py ca <format> <input_path> <contingency_json> <monitored_branches_json>
```

**Format:** Use `psse` (PSS/E RAW input).

**JSON files:**

- `<contingency_json>` — contingency definitions (outage scenarios)
- `<monitored_branches_json>` — branches to monitor post-contingency

**Example:**

```
python ipss_cmd.py ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

**Output:** `<case>_DF_contingency.csv` written alongside the ACLF CSVs, containing post-contingency branch loading results.

## Step 3: Generate NERC TPL-001-5 Report

```
cd wspace
source ../.venv/bin/activate
python generate_nerc_tpl_report.py "<display_name>" <result_dir>
```

**Parameters:**

- `display_name` — Human-readable system name for the report header (e.g., `"Texas 2000Bus System"`)
- `result_dir` — Path **relative to `wspace/`** to the folder that contains the ACLF/CA CSVs (same folder `ipss_cmd.py` writes to), e.g. `data/ieee/result` or `data/psse/Texas2K/result`. A subdirectory name under `wspace/result/` still works for older layouts.

**CSV requirements in that folder:**

- `<prefix>_DF_bus.csv`
- `<prefix>_DF_branch.csv`
- `<prefix>_DF_gen.csv`
- `<prefix>_DF_load.csv`
- `<prefix>_DF_contingency.csv` (optional, for P1–P7 assessment)
- `<prefix>_network_info.txt` (optional, used for AclfNetwork summary section in report)

**Examples:**

```
python generate_nerc_tpl_report.py "IEEE 118-Bus Test Case" data/ieee/result
python generate_nerc_tpl_report.py "Texas 2K-Bus System" data/psse/Texas2K/result
```

Single-argument **aliases** (`ieee118`, `texas2k`, plus short forms via `KNOWN_CASE_ALIASES` in the script) still work when results are under `wspace/result/` — see [Setup.md](../../../Setup.md).

**Output:** `NERC_TPL_001_5_Report.md` written **next to the CSVs** (e.g. `wspace/data/psse/Texas2K/result/`).

## Result Directory Convention

The `ipss_cmd.py` script writes ACLF results based on the input file's parent directory:

- `data/ieee/ieee118.ieee` → `wspace/data/ieee/result/`
- `data/psse/Texas2K/ieee9_v36.raw` → `wspace/data/psse/Texas2K/result/`

CA results are written to the same directory.

Pass that same `.../result` path as `result_dir` to `generate_nerc_tpl_report.py` (see Step 3). Optional: keep copies or symlinks under `wspace/result/` only if you rely on single-argument alias discovery.

## Troubleshooting

- **NR load flow does not converge**: Raise `maxIterations` (and adjust `tolerance` if needed) in `config/aclf_run.json`; large systems often need 100+ iterations
- **No module named 'jpype'**: Run `pip install jpype1 numpy` in the venv
- **Bad interpreter / no such file**: Recreate venv with `python3 -m venv .venv` then reinstall dependencies
- **Results not found by report generator**: Pass the correct `result_dir` relative to `wspace/` (e.g. `data/psse/Texas2K/result`), or symlink the case under `wspace/result/` for alias-only usage
- **OutOfMemoryError / JVM heap exhaustion for large cases (>50K buses)**: Increase the JVM max heap size in `config/config.json` via `jvm_options`. Add or update the field:
  ```json
  "jvm_options": ["-Xmx4g"]
  ```
  Example above sets a **4 GB** max heap; scale up (e.g. `-Xmx8g`) for very large cases. Options are passed to `jpype.startJVM()` in `src/config.py` and can be combined (e.g. `["-Xmx8g", "-Xms2g"]`). See [Setup.md](../../../Setup.md) for JVM path and classpath.
