---
name: ipss-case-optadj
description: Use when asked to relieve basecase or N-1 branch thermal overloads on the current InterPSS simulation case (or a named IEEE CDF / PSS/E RAW / BPA Dat case) by redispatching generator active power — the generator optimization adjustment (OptAdj) — and to report the gen adjustments and the before/after branch loadings.
metadata:
  short-description: Redispatch generation to relieve overloads
---

# InterPSS Generator Redispatch (OptAdj)

Relieve **branch thermal overloads** on the current simulation case by moving control generators'
active power: a DC-sensitivity (SSA) scan collects the branches above a *scan* threshold, a linear
program redispatches the generators so the monitored loadings stay under a percent-of-rating
*OptAdj* threshold, and the same monitored set is re-checked. In DeepSeek Harness this is a single
tool call; other agents use [Fallbacks](#fallbacks).

The method, its prerequisites and the core regression anchors are documented in
[docs/gen_opt_adjustment.md](../../../docs/gen_opt_adjustment.md).

## Prerequisites — the tool refuses without both

| Requirement | Why | How to satisfy |
|---|---|---|
| A **P gen limit** on every active generator | The optimizer's constraint builder dereferences `getPGenLimit()` with no null check | Apply a `scripts/*.gvy` that sets `gen.pGenLimit` (the IEEE 39 fixture's `scripts/ieee39_limit_setup.gvy` is the pattern) |
| **Rating MVA 1** (`LimMvaA`) on every branch | The scan computes `abs(flow / getRatingMvaA()) * 100`, so an unrated branch reads as infinite loading | The same script sets `ratingMva1` (34 lines @ 600 MVA, 12 transformers @ 800 MVA on IEEE 39) |

Neither is guessed for you: a case that lacks them fails with the generator/branch names and the
count. Loading is measured against rating MVA 1 only — `ratingProvider` is a CA knob and does not
exist here.

## Preferred path (DeepSeek Harness)

### Step 0 — load the selected case

```
interpss_case_load({})
```

A no-op (`alreadyLoaded: true`) when the bridge already holds the case. Pass `case` to target a
different one.

### Step 1 — make the case adjustable (only if it is not already)

```
interpss_run_gvy({ script: 'ieee39_limit_setup.gvy', reload: true })
```

Check the script's return value for the gen and branch counts. Skip this step when the case file
itself carries the limits and ratings.

### Step 2 — basecase redispatch (pre-contingency loading)

```
interpss_case_optadj({ optAdjType: 'genAdjBaseCase' })
```

Defaults: scan 50 % of rating, enforce 100 %. Override with `scanLoadingThreshold` /
`optAdjLoadingThreshold` (both `0 < t <= 1000`).

### Step 3 — N-1 redispatch (post-contingency loading)

```
interpss_case_optadj({ optAdjType: 'genAdjCaN_1' })                    // all N-1 outages, scan 90 %
interpss_case_optadj({ optAdjType: 'genAdjCaN_1', contingencyFile: 'sub_115kV.json' })
```

`contingencyFile` is a file in the resolved case's folder or a `data/…` path, exactly like
`interpss_run_ca`'s argument. It is **only** meaningful for `genAdjCaN_1`; a basecase run rejects it.
The N-1 listed default is every branch not connected to the reference bus.

`reload: true` re-parses the case file first — see the mutation caveat below.

### Reading the result

| Field | Meaning |
|---|---|
| `optAdjType` | The mode actually run |
| `scanLoadingThreshold` / `optAdjLoadingThreshold` | The thresholds actually applied (the mode's default when unset) |
| `contingencies` | Outages applied (0 in basecase mode, 45 on IEEE 39) |
| `scanned` | Candidate entries the scan collected above the scan threshold |
| `overLimitBefore` / `overLimitAfter` | Entries at or above the OptAdj threshold, before and after the redispatch |
| `controlGens` / `gensAdjusted` | Generators the optimizer considered / moved by a material `adjP` |
| `genFile` / `branchFile` | The two result CSVs under `wspace/<case dir>/result/` |
| `optAdjSummary` | The runner's raw `OptAdjSummary` text, for cross-checking |

| CSV | Columns |
|---|---|
| `<stem>_DF_optadj_gen.csv` | `genName, genP, adjP, limitMax, limitMin` — one row per reported generator, largest `adjP` first, in **MW** (a `[0, 7] pu` limit shows as `700`) |
| `<stem>_DF_optadj_branch.csv` | `branchId, outageBranchId, limitMW, baseFlowMW, loadingBeforePct, shiftedFlowMWAfter, loadingAfterPct` — one row per scanned entry, before and after; `outageBranchId` empty in basecase mode |

The settled card shows the summary plus an **Explore results** row with a **Gen adjustments** and a
**Branch loading** table, paged through the same endpoint the tab uses and opened worst
`loadingAfterPct` first. Point the user at it instead of pasting rows.

Measurements on the IEEE 39 fixture (this workspace): basecase 50 %/100 % → 20 candidates, 2 → 2
entries at or above 100 %, peak 103.4 % → 100.0 %, 3 of 10 control generators adjusted; N-1
90 %/100 % → 45 contingencies, 7 → 4 entries, peak 138.8 % → 125.3 %, 6 of 10 adjusted.

### Replying after a run

The card **is** the report — mode, thresholds, before/after counts, gens adjusted and the file
paths. Reply with at most a one-line confirmation, and add prose only when it matters:

- `overLimitAfter` is still **greater than zero** — say how many remain and name the worst
  `loadingAfterPct` row; the LP is boxed in by the generators' P limits;
- the case was **refused** for a missing limit/rating — name the script step that fixes it;
- a **next step** is needed — `$ipss-case-aclf` to confirm the redispatched operating point in AC,
  or `$ipss-case-ca` to re-screen it, or the NERC report.

### Choosing the right tool

| Want | Use |
|---|---|
| Redispatch generation to relieve basecase or N-1 overloads | `interpss_case_optadj` |
| DC contingency screening (what is overloaded, no adjustment) | `interpss_run_ca` (`$ipss-case-ca`) |
| Solve the case in AC and write the DF CSVs | `interpss_run_aclf` (`$ipss-case-aclf`) |
| Set the limits/ratings the redispatch needs | `interpss_run_gvy` (`$ipss-case-script`) |
| Summarize the case | `interpss_case_summary` |

Typical order: `$ipss-case-load` → `$ipss-case-script` (limits/ratings, scenario edits) →
`$ipss-case-ca` (see what overloads) → **`$ipss-case-optadj`** → `$ipss-case-aclf` (confirm in AC) →
the NERC report.

## Caveats

- **The run mutates the held model's generator P** (the DCLF model is redispatched). A later
  `interpss_run_aclf`, `interpss_run_ca` or report sees the adjusted dispatch, and a second OptAdj
  call continues from it. Use `reload: true` — or reload the case in the tab — to start from the
  case file again.
- **OptAdj is a DCLF/LODF redispatch, not an AC OPF.** Confirm a stressed operating point with
  `interpss_run_aclf` before acting on it.
- The post-opt re-check tracks **only the entries the scan found**; it does not discover new
  overloads on other branches. Run `$ipss-case-ca` afterwards for a fresh screening.
- An **empty scan** (nothing above the scan threshold) writes both CSVs header-only, reports
  `gensAdjusted: 0`, and does not call the optimizer — that is a result, not an error.
- The outcome is bounded by the case's own generator P limits; a case that cannot move enough MW
  will still show residual overloads.
- Large cases take minutes: the SSA scan and the LODF constraints scale with contingencies ×
  branches. `threads` in `optAdjConfig` (`0` = one worker per processor) is the only knob.

## Fallbacks

Use these when `interpss_case_optadj` is unavailable — Codex, the Claude Code CLI, or a DSH
workspace where the tool reports `InterPSS is not available in this workspace`.

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar optadj ieee <input_path> [<cont_file>]
```

The CLI reads the same case-folder `config/opt_adj_run.json` (and takes at most one positional file,
the N-1 contingency JSON: a monitor file is rejected), writing the same two CSVs under
`<input_parent>/result/`. It is its own JVM, so the case is parsed again and nothing stays loaded.

The samples `org.interpss.sample.optadj.IEEE39_OptBasecase_SsaResult_Sparse_Sample` and
`IEEE39_OptN1Scan_SsaResult_Sparse_Sample` run the same flow from an IDE run configuration.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `… generator(s) have no P gen limit: …` | The case has no `pGenLimit`s; apply the case's limit script first (`interpss_run_gvy`) |
| `… branch(es) have no rating MVA 1 (LimMvaA): …` | The case carries no branch ratings; apply the ratings script first |
| `a basecase OptAdj run has no contingencies` | Drop `contingencyFile`, or switch `optAdjType` to `genAdjCaN_1` |
| `unsupported optAdjType …` | Use `genAdjBaseCase` or `genAdjCaN_1` |
| `scanLoadingThreshold must be a loading percentage between 0 and 1000` | The threshold is out of range or not a number; pass a percentage such as `90` |
| Both CSVs are header-only | Nothing was above the scan threshold — normal for an unloaded case; lower `scanLoadingThreshold` if you expected candidates |
| `overLimitAfter` equals `overLimitBefore` | The generators' P limits left no room; check `gensAdjusted` and the `adjP` column |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |

## Related

- `$ipss-case-ca` — what is overloaded in the first place, and the fresh screening afterwards
- `$ipss-case-aclf` — confirm the redispatched dispatch in AC
- `$ipss-case-script` — set the gen P limits and branch ratings the run needs
- [docs/gen_opt_adjustment.md](../../../docs/gen_opt_adjustment.md) — the method, the samples and the anchors
- [docs/interpss-tools.md](../../../docs/interpss-tools.md) — the `interpss_case_optadj` tool contract
