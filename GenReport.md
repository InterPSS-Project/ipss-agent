# Simulation outputs and reports

After you run `IpssCmd` ACLF (and optionally CA) from `wspace/`, CSV and summary files land under `<input_parent>/result/` relative to `wspace/`. See [IpssCmd.md](IpssCmd.md) for build and run commands.

## Files produced by `IpssCmd`

| File | When | Content |
| ---- | ---- | ------- |
| `<Case>_DF_bus.csv` | ACLF | Bus voltages, types (PQ/PV/Swing) |
| `<Case>_DF_branch.csv` | ACLF | Branch flows, ratings, loading |
| `<Case>_DF_gen.csv` | ACLF | Generator output, Q limits |
| `<Case>_DF_load.csv` | ACLF | Load P and Q |
| `<Case>_network_info.txt` | ACLF | Network summary and loadflow convergence |
| `<Case>_DF_contingency.csv` | CA | Post-contingency monitored branch results |

Example: input `data/ieee/Ieee118Bus/ieee118.ieee` → `wspace/data/ieee/Ieee118Bus/result/ieee118_DF_bus.csv`, etc.

## Report artifacts

Agents and follow-on skills typically produce these Markdown or presentation outputs **from the CSVs** (no separate simulation CLI):

| Artifact | Typical producer | Scope |
| -------- | ---------------- | ----- |
| `AC_Loadflow_Report.md` | Agent / `ipss-sim` workflow | Base-case load flow summary |
| `NERC_TPL_001_5_Report.md` | Agent / `ipss-sim` workflow | NERC TPL-001-5 style steady-state narrative |
| `*_NERC_TPL_001_5_Interactive_Report.html` | [nerc-report-html](.agents/skills/nerc-report-html/SKILL.md) skill | Interactive dashboard from Markdown + CSVs |
| `*_NERC_TPL_001_5_Report_Slides.pptx` | [nerc-report-slides](.agents/skills/nerc-report-slides/SKILL.md) skill | Executive / planning slide deck |

### Thresholds

`config/gen_report.json` defines voltage bands, thermal loading limits, and related criteria. Reference this file when drafting compliance language so reports stay aligned with project defaults.

### Workflow

1. Run ACLF (and CA if needed) with `IpssCmd` — see [IpssCmd.md](IpssCmd.md).
2. Use agent skills (`/ipss-sim`, `/NERC Report HTML`, `/NERC Report Slides`) or natural-language prompts to analyze CSVs and author reports in the same `result/` directory.
3. Pass the `result/` folder path relative to `wspace/` (e.g. `data/ieee/Ieee118Bus/result`) when invoking report skills.
