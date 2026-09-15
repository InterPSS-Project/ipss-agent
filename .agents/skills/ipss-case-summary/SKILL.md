---
name: ipss-case-summary
description: Use when asked for a summary report of the current InterPSS simulation case — convergence, generation/load balance, voltage profile, branch loading and largest flows — or for a ranked top-N view (lowest/highest voltage buses, largest generation, load or branch flows) of the case held in the embedded bridge.
metadata:
  short-description: Summarize the current case
---

# InterPSS Case Summary

Produce a summary report for the case held in the embedded bridge, using the `interpss_case_summary`
tool (plugin 0.3.7+) — plus the case's result CSVs for the two things the tool does not provide:
the voltage distribution and rating-based branch loading.

## Preferred path (DeepSeek Harness)

### Step 0 — load, and solve if the report needs solved values

```
interpss_case_load()
```

It makes the load explicit and is a no-op when the bridge already holds the case. The summary reads
the **in-memory model**, so it works on a loaded base case — but a base case reports base-case
values. For a report about the solved case, run `interpss_run_aclf` first (see `$ipss-case-aclf`).

### Step 1 — case-wide totals

```
interpss_case_summary()
```

`scope` defaults to `net`: convergence, bus and branch counts, generation, load, and the raw max
mismatch. It returns no rows.

### Step 2 — the rankings

| Want | Call |
| --- | --- |
| Lowest-voltage buses | `interpss_case_summary({ scope: 'bus', numRec: 10 })` |
| Highest-voltage buses | `interpss_case_summary({ scope: 'bus', sortRule: 'Highest Bus Voltage', numRec: 10 })` |
| Largest generation | `interpss_case_summary({ scope: 'gen', numRec: 10 })` |
| Largest loads | `interpss_case_summary({ scope: 'load', numRec: 10 })` |
| Largest branch flows (magnitude) | `interpss_case_summary({ scope: 'branch', numRec: 10 })` |

`numRec` defaults to 10 and is capped at 100. Rows are `{ id, name, bus?, value, unit, mvar? }` with
`unit` in `pu` (bus), `MW` (gen/load) or `MVA` (branch). Every scope reports `converged`, but the
other case-wide totals (counts, generation, load, mismatch) come with `scope: 'net'` only — so a
tool renders **no card at all** (0.3.12; ranked scopes since 0.3.11) — you still receive the totals
or the `rows`, and the report you write is the only place the numbers appear, so never answer by
pointing at a card. An unknown `scope` is rejected — the
underlying RPC would silently fall back to `net`, which truncates every section in model order.

### Step 3 — what the tool cannot give, read from the CSVs

After an ACLF run, `wspace/<case dir>/result/` holds both of these:

1. **Rating-based loading** — `<stem>_DF_branch.csv`, column `Loading%`, over the governing
   (lowest) `LimMvaA` rating. This is the reliability-relevant metric; the tool ranks branches by
   *flow magnitude* instead, so it cannot answer "most loaded".
2. **Voltage distribution** — `<stem>_DF_bus.csv`, column `VoltMag`: the mean, and the counts
   outside a band (for example `< 0.95`, `> 1.05`). The tool returns ranked rows, not a distribution.

Two parsing facts, both verified against these files:

- Neither CSV has quoted fields, so splitting on `,` is safe — the plugin's own explorer does the same.
- In the branch CSV, `Flow@FromSide` and the `P`/`Q` columns are **per-unit on a 100 MVA base**:
  MVA = value × 100. Reading them as MVA makes a 221 MVA line look like it carries 2.2 MVA at
  "100 %" loading.

### Step 4 — report layout

Keep it short, in this order:

- **Status line** — case, `converged: true/false`, bus and branch counts.
- **Balance** — generation, load, and the implied loss (`gen − load`, as MW and as % of load).
- **Voltage profile** — min–max and mean, the out-of-band counts, then a compact five-row
  lowest/highest table.
- **Branch loading** — max loading, the counts at/above 100 / 90 / 80 %, and the top rows with
  rating, flow and loading.
- **Notes** — the caveats below, plus the staleness warning.

### Interpreting the numbers

| Observation | Meaning |
| --- | --- |
| Tool mismatch ≠ the `Max Mismatch` in `_network_info.txt` | Should not happen: both now read the same post-solve residual (`net.maxMismatch(NR)`). If they differ, the tool is reading a different cached model than the last run — re-run `interpss_case_load` / `interpss_run_aclf` and compare again. |
| The highest-flow branch is not the highest-loaded branch | Different metrics. Flow magnitude ignores ratings; use `Loading%` for loadability. |
| A `sortRule` value is ignored | Only the `bus` scope reads it, and only the substring `High` selects highest-first; anything else is lowest-first. `gen`/`load`/`branch` are always largest-first. |
| Values look like a base case after a solve | The tool reports the cached model. Another case's `interpss_case_load` replaces it, so re-run `interpss_run_aclf` before summarizing again. |

## Fallbacks

Use these when the tool is unavailable — a plugin older than 0.3.7, Codex, or the Claude Code CLI.
Read the result CSVs directly; the same columns cover every section:

| Section | Source |
| --- | --- |
| Balance and convergence | `…_network_info.txt` — `Total Generation`, `Total Load`, `Loadflow converged`, `Max Mismatch` |
| Voltage profile | `…_DF_bus.csv` — `VoltMag` |
| Branch loading | `…_DF_branch.csv` — `Loading%`, `LimMvaA`, `Flow@FromSide × 100` |
| Generation / load | `…_DF_gen.csv` / `…_DF_load.csv` |

`$ipss-case-aclf` (or `IpssCmd aclf`) produces those files when they are missing. State clearly that
CSV-derived values describe the last run rather than the live model.

## Caveats

- The summary is only as fresh as the model: a report produced after `interpss_case_load` but before
  `interpss_run_aclf` describes a base case, not a solved one.
- An ACLF run overwrites `*_DF_*.csv` and `*_network_info.txt`, so any `NERC_TPL_001_5_Report.md`
  or HTML dashboard in that folder becomes stale — say so and offer to regenerate it.
- Report the case the tool resolved (`case` in its result); never present a different case as current.
- This is the short engineering summary. For a compliance artifact use `$ipss-sim` with
  `$nerc-report-html` / `$nerc-report-slides`, which build the NERC TPL-001-5 deliverables.
