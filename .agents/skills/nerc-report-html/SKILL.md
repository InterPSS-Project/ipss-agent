---
name: nerc-report-html
description: Generate reusable interactive HTML dashboards from InterPSS NERC TPL-001-5 Markdown reports and companion DF CSV files. Use when asked to create, regenerate, or reuse HTML/Plotly reports for NERC_TPL_001_5_Report.md study outputs, including voltage, thermal, generator Q-limit, and contingency visualization with filters and load-more tables.
---

# NERC Report HTML

Generate a standalone interactive HTML dashboard from an InterPSS `NERC_TPL_001_5_Report.md` and the companion `*_DF_bus.csv`, `*_DF_branch.csv`, `*_DF_gen.csv`, `*_DF_load.csv`, and optional `*_DF_contingency.csv` files.

Use the bundled Python script for consistency instead of rewriting the dashboard by hand.

## Inputs

Accept either:

- a path to `NERC_TPL_001_5_Report.md`
- a result directory containing `NERC_TPL_001_5_Report.md`

The script auto-detects companion CSV files in the same directory by suffix, so the case prefix can vary.

## Quick Start

```bash
python3 /Users/ipssdev/.codex/skills/nerc-report-html/scripts/generate_nerc_html.py <report-or-result-dir>
```

Optional:

```bash
python3 /Users/ipssdev/.codex/skills/nerc-report-html/scripts/generate_nerc_html.py <report-or-result-dir> --out <dashboard.html>
```

By default the output is saved beside the report as:

```text
<case_slug>_NERC_TPL_001_5_Interactive_Report.html
```

## Dashboard Features

The generated HTML embeds compact CSV-derived data and loads Plotly from CDN for charts. It includes:

- executive KPI scorecards
- voltage band chart, area exposure chart, and bus voltage scatter
- low-voltage bus filter table with load-more pagination
- branch loading histogram, top branch plot, and high-loading branch table
- generator Q-limit scatter/pie and Q-limit table
- P1 contingency histogram, top overload plot, and contingency table when contingency CSV exists
- filters for area, voltage threshold, branch loading threshold, contingency loading threshold, and text search

If the user needs fully offline plotting, modify the generated HTML to use a local Plotly bundle; the embedded data and tables still load without network.

## Workflow

1. Run the bundled script on the requested report or result directory.
2. Read the script output summary and verify the HTML path.
3. For a first-time case or after changing the script, inspect the generated HTML with a browser if practical.
4. Report the output path, included data domains, and any missing optional CSVs.

## Notes

- CSV `GenP`, `LoadP`, and related power values are reported in per-unit on a 100 MVA base in these InterPSS outputs. The script multiplies headline generation/load metrics by 100 for MW display.
- The Markdown report remains the source of the compliance verdict. CSV-derived row counts may differ from Markdown summary counts when the report applies additional filtering or grouping; the generated page states this.
- Missing optional files are tolerated. For example, if no contingency CSV exists, the P1 section shows a no-data message and the P0/Q sections still work.
