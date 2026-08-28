# Markdown report generation (InterPSS CSVs)

After you run the Java CLI (`java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf`, and optionally `... ca`) from `wspace/`, CSVs land under `<input_parent>/result/` relative to `wspace/`. The **Java `report` subcommand** (primary) or legacy Python scripts turn those files into Markdown reports:

| Generator | Report | Scope |
|--------|--------|--------|
| `java -jar ... report aclf ...` | `AC_Loadflow_Report.md` | Base-case AC load flow only (no contingency CSV, no NERC compliance narrative) |
| `java -jar ... report nerc ...` | `NERC_TPL_001_5_Report.md` | Steady-state assessment including optional N-1 contingency tables for NERC TPL-001-5 style wording |
| `src/report/generate_aclf_report.py` *(legacy)* | `AC_Loadflow_Report.md` | Same as Java ACLF report |
| `src/report/generate_nerc_tpl_report.py` *(legacy)* | `NERC_TPL_001_5_Report.md` | Same as Java NERC report |

Both Java and Python paths share thresholds from `config/gen_report.json` (voltage bands, thermal loading, generator Q limits). The ACLF report labels them as planning-style guidance only.

---

## AC Load Flow report generation

From the project root or `wspace/`:

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report aclf "<display_name>" <result_dir> [csv_prefix]
```

**Examples**:

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report aclf "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result

java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf psse data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report aclf "Texas 2000-Bus System" data/psse/Texas2K/result
```

Legacy Python (still supported):

```
cd wspace
python3 ../src/report/generate_aclf_report.py <display_name> <result_dir> [csv_prefix]
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

From the project root or `wspace/`:

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "<display_name>" <result_dir>
```

**Examples**:

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "Texas 2K-Bus System" data/psse/Texas2K/result
```

Legacy Python:

```
cd wspace
python3 ../src/report/generate_nerc_tpl_report.py <display_name> <result_dir>
```

**Legacy single-argument aliases** (when results live under `wspace/result/` and were auto-discovered): you can pass only the alias, e.g. `texas2k` or `ieee118`. Short aliases `ieee` → `ieee118` and `texas` → `texas2k` are defined in `KNOWN_CASE_ALIASES` at the top of `src/report/generate_nerc_tpl_report.py`.

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
