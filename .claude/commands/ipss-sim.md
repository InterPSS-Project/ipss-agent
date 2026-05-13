Run power system simulations (AC load flow, contingency analysis) and generate NERC TPL-001-5 compliance reports for the provided input files.

Invoke the `ipss-sim` skill to run the three-step workflow using the provided input files and format. The skill contains the full step-by-step instructions, prerequisites, examples, and troubleshooting guidance.

## Input Modes

### Single File Mode

**Arguments:** `<input_path> [<contingency_json> <monitored_branches_json>] in <format> "<NERC Report Name>"`

- `input_path` — PSS/E RAW (.raw/.RAW) or IEEE CDF (.ieee) case file
- `contingency_json` — (optional) contingency definitions for CA
- `monitored_branches_json` — (optional) monitored branches for CA
- `format` — `psse` (.raw/.RAW) or `ieee` (.ieee), automatically inferred if not specified
- `"<NERC Report Name>"` — (optional) display name for the report header (e.g., `"Texas 2000-Bus System"`); defaults to a descriptive name derived from the case

### Directory Mode

**Arguments:** `<directory_path> "<NERC Report Name>"`

- `directory_path` — path to directory containing the case file, contingency JSON, and monitored branches JSON (auto-discovered by naming convention)
- `"<NERC Report Name>"` — (optional) display name for the report header
