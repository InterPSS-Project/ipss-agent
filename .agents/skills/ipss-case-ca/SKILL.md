---
name: ipss-case-ca
description: Use when asked to run a DC contingency analysis (CA / N-1 screening) for the current InterPSS simulation case, or for a named IEEE CDF / PSS/E RAW case, and to report the overload summary or the contingency result CSV the NERC report needs.
metadata:
  short-description: Run DC contingency analysis
---

# InterPSS DC Contingency Analysis

Screen the **current simulation case** — the case selected in the InterPSS tab — with a DC
contingency analysis and report what overloaded. In DeepSeek Harness this is a single tool call; other
agents use [Fallbacks](#fallbacks).

The tool **bypasses the Contingency Analysis dialog**: nothing is prompted for, and the inputs come
from the resolution order below. It writes the contingency CSV that the NERC TPL-001-5 report and the
ACLF card's **Report** button consume — run it before generating either.

## Preferred path (DeepSeek Harness)

### Step 0 — load the selected case

```
interpss_case_load()
```

A no-op reporting `alreadyLoaded: true` when the bridge already holds the case, so it is safe to call
unconditionally (see `$ipss-case-load`). The runner solves its own **DC** load flow, so an ACLF run is
not a prerequisite — the case only has to be loaded.

### Step 1 — run the analysis

```
interpss_run_ca()
```

Do not ask which case to run: with no `case` argument the tool resolves the case selected in the
InterPSS tab. Pass `case` only to target a different case.

### Where the inputs come from

Nothing is prompted for. Each of the two inputs is resolved independently:

1. the `contingencyFile` / `monitorFile` argument, when supplied;
2. the case folder's `config/ca_run.json` (written by the tab's CA dialog, when it exists);
3. the case-folder discovery heuristic — the first `*contingenc*.json` and the first `*monitor*.json`
   in that folder (alphabetical);
4. the Java defaults — **N-1 outages for every branch not connected to the reference bus**, and
   **every branch monitored**, at a 90 % overload threshold.

| Argument form | Example |
|---|---|
| File name in the resolved case's folder | `2k_contingencies_115kVAbove.json` |
| Workspace-relative path | `data/psse/Texas2K/2k_monitored_branches.json` |
| The same, written as the session shows it | `wspace/data/psse/Texas2K/2k_monitored_branches.json` |
| Absolute path containing `/wspace/data/` | `/…/ipss-agent/wspace/data/psse/Texas2K/x.json` |

Anything else — a non-`.json` file, a `..` segment, a path outside `wspace/` — is rejected before the
bridge is called; a file that does not exist is rejected too, naming the argument.

### Reading the result

| Field | Meaning |
|---|---|
| `contingencies` | Contingency cases applied (the N-1 set, or the entries in the contingency file) |
| `monitoredBranches` | Branches whose post-contingency loading was checked |
| `overloads` | Overloading rows written to the CSV — one per (monitored branch, contingency) pair above the threshold |
| `threshold` | Overload threshold in percent (90 unless the runner's config changes) |
| `contingencyCsv` | `<stem>_DF_contingency.csv` under `wspace/<case dir>/result/` |
| `contingencyFile` / `monitoredBranchFile` | The inputs actually used; absent means the Java defaults (`all N-1 outages` / `all branches monitored`) |
| `caSummary` | The runner's raw `ContAnalysisSummary` text, in case a number needs checking |

The CSV is the detailed result. Columns:

```
BranchID, BranchName, BranchCode, IsXfmr, ContingencyName, OutageBranchId, OutageBranchName,
BasecaseFlowMW, PostFlowMW, LineRatingMW, LoadingPercent
```

One row per overloading pair: which monitored branch, which contingency (the outage), its base-case
and post-contingency MW flow, the rating and the resulting `LoadingPercent`. Read it for ranking the
worst outages — the summary only counts them. `$nerc-report-html` / `$nerc-report-slides` turn the
same file into the compliance artifacts.

### Result explorer on the card

With plugin 0.4.2+ the settled card shows an **Explore result** row with a **Contingency** button,
paging the contingency CSV (100 rows per page, the next page auto-loads on scroll) through the same
endpoint the tab's Contingency tab uses — and the tab's own table sorts the same way (0.4.4+). The table opens sorted by `LoadingPercent`, worst first
(0.4.3+), and every header is clickable to sort by that column — the whole file is sorted before a
page is sliced, so the order survives scrolling. Point the user at it instead of pasting CSV rows — and use it
yourself to rank the worst outages when a decision follows.

### Replying after a run

The card **is** the report: case and `source`, threshold, contingency/monitored/overload counts, the
inputs used and the CSV path. Do not restate it. Reply with at most a one-line confirmation.

Add prose only when the caller needs something the card cannot carry:

- `overloads` is **greater than zero** — say how many, and name the worst contingency from the CSV if
  a decision follows;
- the **inputs are not what was expected** — discovery picked a file in the case folder, or an
  argument named a different one;
- a **next step** must be chosen — generating the NERC report or the HTML dashboard the CSV now
  feeds, or solving AC (`$ipss-case-aclf`) so the ACLF-side summaries are current too.

### Choosing the right tool

| Want | Use |
|---|---|
| DC contingency screening and its result CSV | `interpss_run_ca` |
| Solve the case (AC load flow) and write the DF CSVs | `interpss_run_aclf` |
| Show the loaded case's network info | `interpss_network_info` |
| Summarize the case | `interpss_case_summary` |
| Apply a scenario edit first | `interpss_run_gvy` (`$ipss-case-script`) |

Typical order for a study: `$ipss-case-load` → `$ipss-case-script` (optional scenario edits) →
`$ipss-case-aclf` → `$ipss-case-ca` → the NERC report.

## Caveats

- **DC only.** The screening uses a DC load flow with losses and a 90 % threshold; it neither proves
  nor replaces an AC assessment. A branch that passes DC screening can still violate in AC.
- **Base-case flows come from the runner**, not from a previous ACLF: the summary is independent of
  whether `interpss_run_aclf` has run, and it does not change the model's solved state.
- The run **overwrites** `<stem>_DF_contingency.csv`; an existing NERC report built from the older
  file becomes stale, exactly as with an ACLF overwrite of the DF CSVs.
- Large cases take minutes: Texas 2K (3220 branches, ~3200 N-1 outages) is a parallel DC run, a 78 k-bus
  case is much longer.
- A contingency set that names branches missing from the case is reported by the runner's own error;
  fix the JSON rather than retrying unchanged.

## Fallbacks

Use these when `interpss_run_ca` is unavailable — Codex, the Claude Code CLI, or a DSH workspace where
the tool reports `InterPSS is not available in this workspace`.

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse <input_path> [<cont_file> <monitor_file>]
```

The CLI takes the same two optional JSON paths (positional: contingency then monitored branches) and
writes the same `<stem>_DF_contingency.csv` under `<input_parent>/result/`. It is its own JVM: the case
is parsed again, and nothing stays loaded for the next command. Give it a larger `-Xmx` for very large
cases (the bridge uses `-Xmx8g`).

If a previous run exists, reading `wspace/<case dir>/result/<stem>_DF_contingency.csv` is enough to
report overloads — state that those values come from the last run, not from a live model.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid case path` / `unrecognized JSON file selector` | Use a case `data/…` path (or preset label) and a JSON name in the case folder or a `data/…json` path |
| `contingencyFile not found` / `monitorFile not found` | The argument is wrong or the file is not under `wspace/`; omit the argument to fall back to `config/ca_run.json`, discovery and the Java defaults |
| `no simulation case is selected` | Select a case in the InterPSS tab, or pass `case` explicitly |
| No overloads reported | Expected on a lightly loaded case: the default threshold is 90 % of rating; check `threshold` and the monitored set in the result |
| The CSV looks empty | Nothing crossed the threshold — the file has a header and no rows |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| Very large case is slow or runs out of memory | The bridge JVM runs with `-Xmx8g`; see `Setup.md` for heap guidance |

## Related

- `$ipss-case-aclf` — AC load flow; run it before CA when the DF CSVs must be current too
- `$ipss-case-load` — load (or switch) the case CA screens
- `$ipss-case-script` — apply a scenario edit before screening
- `$nerc-report-html`, `$nerc-report-slides` — turn the contingency CSV into compliance artifacts
- [docs/interpss-tools.md](../../../docs/interpss-tools.md) — the `interpss_run_ca` tool contract
