# Release V0.3.16

**Date:** 2026-09-18

This release focuses on chat/agent case tools, richer ACLF UI and reporting, contingency-analysis configuration UX, and ACLF result settling after adjustments.

## Highlights

- Chat tools for network info, ACLF run, case load, and case summary
- Case-scoped agent skills: `ipss-case-aclf`, `ipss-case-info`, `ipss-case-summary`
- ACLF result explorer with paged Bus / Branch / Gen / Load tables and a **Report** button
- Contingency Analysis dialog with optional JSON paths and `ca_run.json` resolution
- ACLF solution settling so reported mismatch matches a re-solved network

## Chat tools & agent skills

- Added chat tools:
  - `interpss_network_info`
  - `interpss_run_aclf`
  - `interpss_case_load`
  - `interpss_case_summary`
- Added case-scoped skills and Claude commands:
  - `ipss-case-aclf`
  - `ipss-case-info`
  - `ipss-case-summary`

- Refreshed `README.md`, `IpssCmd.md`, and `docs/interpss-tools.md`
- Removed older plugin user guide Markdown/PDF in favor of the new tools docs

## UI / plugin

- ACLF result explorer: paged access to Bus, Branch, Gen, and Load tables
- **Report** button to generate the AC Loadflow Markdown report from the run’s CSVs
- Contingency Analysis dialog improvements:
  - Contingency and monitored-branch JSON paths are optional
  - Clear resolution order, including `ca_run.json`
  - File selection, validation, and error handling for missing or invalid inputs

## Stats

- **10 commits** since `Release-V0.2.3`
- **44 files** changed, **+4835** / **−548** lines

