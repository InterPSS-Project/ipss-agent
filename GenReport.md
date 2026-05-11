# NERC TPL-001-5 Report Generation

## Overview

`generate_nerc_tpl_report.py` reads CSV output from InterPSS load flow and contingency analysis, then produces a NERC TPL-001-5 steady-state compliance report in Markdown format.

From `wspace/` with the venv activated:

```
cd wspace
source ../.venv/bin/activate
python generate_nerc_tpl_report.py <display_name> <result_dir>
```

`display_name` is the title for the report header. `result_dir` is the folder that contains the CSVs: a path **relative to `wspace/`** (the same directory `ipss_cmd.py` writes to under `<input_parent>/result/`), or a legacy subdirectory name under `wspace/result/`.

**Examples** (match [Setup.md](Setup.md)):

```
python generate_nerc_tpl_report.py "IEEE 118-Bus Test Case" data/ieee/result
python generate_nerc_tpl_report.py "Texas 2K-Bus System" data/psse/Texas2K/result
```

**Legacy single-argument aliases** (when results live under `wspace/result/` and were auto-discovered): you can pass only the alias, e.g. `texas2k` or `ieee118`. Short aliases `ieee` → `ieee118` and `texas` → `texas2k` are defined in `KNOWN_CASE_ALIASES` at the top of `generate_nerc_tpl_report.py`.

## Input Data in ResultDir

The script reads four mandatory CSVs, one optional CSV, and one optional text file from that directory:

| File | Content |
|---|---|
| `<Case>_DF_bus.csv` | Bus voltage profiles, types (PQ/PV/Swing) |
| `<Case>_DF_branch.csv` | Branch flows, ratings, loading percentages |
| `<Case>_DF_gen.csv` | Generator output, Q limits, voltage setpoints |
| `<Case>_DF_load.csv` | Load demand (P and Q) |
| `<Case>_network_info.txt` | AclfNetwork summary and loadflow run information (optional, included as summary section) |
| `<Case>_DF_contingency.csv` | N-1 contingency results (optional) |

The `_network_info.txt` file is parsed and rendered as an **AclfNetwork Summary** table in the report, showing bus/branch counts, total generation/load, control device counts, loadflow convergence status, and max mismatch. If absent, the section is simply omitted.

## Output

The report is written next to the CSVs:

```
<resolved_result_dir>/NERC_TPL_001_5_Report.md
```

