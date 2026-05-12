# Markdown report generation (InterPSS CSVs)

After you run `ipss_cmd.py aclf` (and optionally `ipss_cmd.py ca`), CSVs land under `<input_parent>/result/` relative to `wspace/`. Two Python generators turn those files into Markdown reports:

| Script | Report | Scope |
|--------|--------|--------|
| `generate_aclf_report.py` | `AC_Loadflow_Report.md` | Base-case AC load flow only (no contingency CSV, no NERC compliance narrative) |
| `generate_nerc_tpl_report.py` | `NERC_TPL_001_5_Report.md` | Steady-state assessment including optional N-1 contingency tables for NERC TPL-001-5 style wording |

Both run from `wspace/` with the venv activated and share resolution helpers and analysis logic via `ipss_report_common.py` (voltage bands, thermal loading, generator Q limits stay aligned). Thresholds for bands come from `config/gen_report.json`; the ACLF report labels them as planning-style guidance only.

---

## AC Load Flow report generation

`generate_aclf_report.py` reads the ACLF CSV outputs (and optional network summary text) and writes a neutral **AC Load Flow** Markdown report: network summary, convergence, voltage profile, branch loading, and generator reactive margins. It does **not** read `*_DF_contingency.csv` and does **not** assert NERC TPL-001-5 compliance. For that, use `generate_nerc_tpl_report.py` on the same result folder once contingency CSVs exist.

From `wspace/` with the venv activated:

```
cd wspace
source ../.venv/bin/activate
python generate_aclf_report.py <display_name> <result_dir> [csv_prefix]
```

`display_name` is the title in the report header. `result_dir` is the folder that contains the CSVs: a path **relative to `wspace/`** (the directory `ipss_cmd.py` writes to under `<input_parent>/result/`), or a legacy subdirectory under `wspace/result/`.

**Examples** (match [Setup.md](Setup.md)):

```
python ipss_cmd.py aclf ieee data/ieee/ieee118.ieee
python generate_aclf_report.py "IEEE 118-Bus Test Case" data/ieee/result

python ipss_cmd.py aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
python generate_aclf_report.py "Texas 2000-Bus System" data/psse/Texas2K/result
```

**Optional `csv_prefix`:** When several cases share one `result/` directory, pass the CSV stem explicitly (e.g. `ieee14` for `ieee14_DF_bus.csv`). If omitted, the first `*_DF_bus.csv` in lexicographic order is used.

### Required inputs in `result_dir`

| File | Content |
|---|---|
| `<Case>_DF_bus.csv` | Bus voltages, types (PQ/PV/Swing) |
| `<Case>_DF_branch.csv` | Branch flows, ratings, loading |
| `<Case>_DF_gen.csv` | Generator output, Q limits, setpoints |
| `<Case>_DF_load.csv` | Load P and Q |
| `<Case>_network_info.txt` | AclfNetwork summary and loadflow run information (optional; sections omitted if missing) |

### Output

The report is written next to the CSVs:

```
<resolved_result_dir>/AC_Loadflow_Report.md
```

---

## NERC TPL-001-5 report generation

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

### Input data in `result_dir`

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

### Output

The report is written next to the CSVs:

```
<resolved_result_dir>/NERC_TPL_001_5_Report.md
```
