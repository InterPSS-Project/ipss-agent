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

## Tool call at a glance

```
interpss_case_optadj({ case?, optAdjType?, scanLoadingThreshold?, optAdjLoadingThreshold?,
                       contingencyFile?, optAdjConfig?, reload? })
```

| Argument | Default | Meaning |
|---|---|---|
| `case` | tab selection | The case to run, resolved like every other tool (`data/…`, `wspace/data/…`, an absolute path under `/wspace/data/`, or a preset label) |
| `optAdjType` | `genAdjBaseCase` | `genAdjBaseCase` relieves pre-contingency (basecase) loading; `genAdjCA_N-1` relieves post-contingency loading for single branch outages |
| `scanLoadingThreshold` | `50` / `90` | Candidate-collection percentage (`0 < t <= 1000`): 50 in the basecase mode, 90 in the N-1 mode, when unset |
| `optAdjLoadingThreshold` | `100` | The percentage the LP enforces (`0 < t <= 1000`) |
| `contingencyFile` | all N-1 outages | `genAdjCA_N-1` only: the contingency JSON, addressed exactly like the CA tool's argument; the basecase mode **rejects** it |
| `optAdjConfig` | — | The same keys as one partial object; an unknown key is rejected with the list of known ones. The scalar arguments win per key |
| `reload` | `false` | Re-parse the case file before running |

Resolution is most-specific-first: `optAdjConfig` → the scalar arguments → the case folder's
`config/opt_adj_run.json` → the built-in defaults. There is no filename discovery (unlike CA): only
the N-1 mode reads a contingency file, and it must be named.

The config has **seven** keys: the five above plus `contingencyMode` (`all` \| `custom`) and two with
no scalar argument — `sparseSenMatrix` (boolean, `true` = sparse sensitivities, the default; `false`
selects the dense path) and `threads` (`0` = one SSA worker per available processor).

**The N-1 mode token changed in 0.7.8.** The Java record renamed `genAdjCaN_1` to `genAdjCA_N-1`, and
the bridge now accepts the canonical token only. The Host maps the retired spelling onto it, so
`optAdjType: 'genAdjCaN_1'` inside `optAdjConfig` — or in a `config/opt_adj_run.json` written against
the older docs — still runs and still writes the `_DF_optadj_N1_` pair; the tool's own `optAdjType`
argument takes the canonical token, and a bad token now reports
`expected genAdjBaseCase|genAdjCA_N-1`.

The call returns the mode, both resolved thresholds, `contingencies`, `scanned`,
`overLimitBefore` / `overLimitAfter`, `controlGens`, `gensAdjusted`, the two result file names and
the runner's raw `OptAdjSummary` — field by field below under [Reading the result](#reading-the-result).

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
interpss_case_optadj({ optAdjType: 'genAdjCA_N-1' })                    // all N-1 outages, scan 90 %
interpss_case_optadj({ optAdjType: 'genAdjCA_N-1', contingencyFile: 'sub_115kV.json' })
```

`contingencyFile` is a file in the resolved case's folder or a `data/…` path, exactly like
`interpss_run_ca`'s argument. It is **only** meaningful for `genAdjCA_N-1`; a basecase run rejects it.
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
| `<stem>_DF_optadj_gen.csv` (basecase) / `<stem>_DF_optadj_N1_gen.csv` (`genAdjCA_N-1`) | `genName, genP, adjP, limitMax, limitMin` — one row per reported generator, largest `adjP` first, in **MW** (a `[0, 7] pu` limit shows as `700`) |
| `<stem>_DF_optadj_branch.csv` (basecase) / `<stem>_DF_optadj_N1_branch.csv` (`genAdjCA_N-1`) | `branchId, outageBranchId, limitMW, baseFlowMW, loadingBeforePct, shiftedFlowMWAfter, loadingAfterPct` — one row per scanned entry, before and after; `outageBranchId` empty in basecase mode. The runner writes `shiftedFlowMWAfter` as `0.0` on every row, so read `loadingAfterPct` (or derive `loadingAfterPct × limitMW / 100`) rather than that column |

The N-1 pair carries the `N1` infix since 0.7.5 (the mode picks the name, so a basecase run and an
N-1 run of the same case do not overwrite each other); the values in this skill's examples below are
from the basecase pair.

The settled card shows the summary plus an **Explore results** row with a **Gen adjustments** and a
**Branch loading** table, paged through the same endpoint the tab uses and opened worst
`loadingAfterPct` first. Point the user at it instead of pasting rows.

Measurements on the IEEE 39 fixture (this workspace): basecase 50 %/100 % → 20 candidates, 2 → 2
entries at or above 100 %, peak 103.4 % → 100.0 %, 3 of 10 control generators adjusted; N-1
90 %/100 % → 45 contingencies, 7 → 4 entries, peak 138.8 % → 125.3 %, 6 of 10 adjusted.

### Listing the branches after the run

When the ask is the **branch loading after the adjustment** — not just the summary — read
`<stem>_DF_optadj_branch.csv`. The card's **Branch loading** table opens on the same data and sorts
the same way; list the rows yourself only when the caller wants them in the reply.

Show one row per entry, worst `loadingAfterPct` first:

| Column | Show as | Note |
|---|---|---|
| `branchId` | branch | The monitored branch |
| `outageBranchId` | outage | The contingency that produced the entry; empty in basecase mode |
| `limitMW` | rating | The rating the scan measured against, i.e. rating MVA 1 |
| `baseFlowMW` | — | The **pre-contingency (basecase) flow**, in MW and signed by flow direction. It is *not* the MW behind `loadingBeforePct` in N-1 mode — do not show it as the "before MW" there |
| `loadingBeforePct` | before % | The scan's pre-redispatch loading (post-contingency, in N-1 mode) |
| `loadingAfterPct` | after % | The post-redispatch loading — the number to filter and sort on |
| — | before MW | Derive as `loadingBeforePct × limitMW / 100` — the flow that produced the percentage, and therefore the flow the outage actually causes. **Do not** read `baseFlowMW` for this |
| — | after MW | Derive as `loadingAfterPct × limitMW / 100`; **do not** read `shiftedFlowMWAfter`, which the runner writes as `0.0` on every row |

The two MW columns both come from the percentages, so a row is internally consistent: MW and % then
describe the same flow. `baseFlowMW` matches the derived before MW only in basecase mode (there the
scan is pre-contingency, so the two are the same state); in N-1 mode it is the pre-outage flow and is
typically far smaller — IEEE 39 `Bus24->Bus23(1)` under outage `Bus22->Bus21(1)` is
`baseFlowMW = −351.6` but `loadingBeforePct = 138.85 %` of 690 MVA = **958.1 MW**, which is the number
the CA post-contingency flow also reports.

```bash
cd wspace/<case dir>/result
python3 - <<'EOF'
import csv
rows = list(csv.DictReader(open('<stem>_DF_optadj_branch.csv')))
f = lambda r, k: float(r[k] or 0)
T = 100.0                                   # the run's resolved optAdjLoadingThreshold
rows.sort(key=lambda r: -f(r, 'loadingAfterPct'))
for r in rows:
    lim, bf, af = f(r, 'limitMW'), f(r, 'loadingBeforePct'), f(r, 'loadingAfterPct')
    if af >= T:
        print(f"{r['branchId']:<20}{r['outageBranchId']:<20}{lim:>7.0f}"
              f"{bf*lim/100:>9.1f}{bf:>8.2f}%{af:>8.2f}%{af*lim/100:>9.1f} MW")
EOF
```

Filter at the run's **resolved** `optAdjLoadingThreshold`, not a hard-coded 100: it is 100 by default
but may have been overridden, and `overLimitBefore`/`overLimitAfter` count entries at or above exactly
that value. State which threshold the list uses.

Four scope limits worth stating with the list:

- it covers **only the scan's candidates** — entries at or above `scanLoadingThreshold` (50 % basecase,
  90 % N-1) *before* the redispatch. A branch below that bar is absent from the file entirely, so the
  list is not the case's full branch set and cannot prove no other branch overloads;
- the redispatch can **raise** a listed entry (`Bus3→Bus2` 61.69 % → 64.45 % on the IEEE 39 basecase
  run) — the scan's candidate set, not the pre-redispatch overload set, is what gets re-checked;
- it is the **DCLF/LODF study state**, not an AC solution, and (per the caveat below) the held model
  usually still carries the scheduled dispatch — so this CSV is the only place the post-adjustment
  state exists until the setpoints are re-applied with a script;
- the `adjP` column of the gen CSV sums to ~zero — the redispatch moves MW between machines, it does
  not create it (IEEE 39 basecase: `+37.28 − 27.25 − 10.03 = 0`). Entries with identical before and
  after are the ones the optimizer's constraints left alone.

Worked example (IEEE 39 basecase, 50 %/100 %): 20 rows, 2 at/above 100 % after — worst
`Bus29->Bus38(1)` 103.41 % → **100.02 %** (800 MVA) and `Bus22->Bus21(1)` 101.08 % → **100.01 %**
(600 MVA); six rows bit-identical before and after, and one worse.

### Replying after a run

Reply with **two tables** — the before/after overload card, then the generator adjustments. The tool
card carries the counts, so the reply does not restate them.

```
Basecase redispatch ran (scan 50 %, enforce 100 %) — the two basecase overloads are driven onto the limit:

| Branch | Rating | Before | After |
|---|---|---|---|
| BUS-29 → BUS-38 | 800 MVA | −827.2 MW (103.41 %) | **100.02 %** |
| BUS-22 → BUS-21 | 600 MVA | 606.5 MW (101.08 %) | **100.01 %** |

Adjustments (3 of 10 control generators moved):

| Generator | Scheduled | AdjP | Limit |
|---|---|---|---|
| Bus30-G1 | 250.0 MW | **+37.28 MW** | max 700 |
| Bus38-G1 | 830.0 MW | **−27.25 MW** | max 830 (already at its cap) |
| Bus35-G1 | 650.0 MW | **−10.03 MW** | max 700 |
```

That example is the IEEE 39 basecase run verbatim, read off `ieee39_DF_optadj_branch.csv` and
`ieee39_DF_optadj_gen.csv`. In basecase mode the Before MW equals the CSV's `baseFlowMW`; in N-1 mode
it does **not**, and the card takes the flow the outage produces instead:

| Branch | Rating | Before | After |
|---|---|---|---|
| BUS-24 → BUS-23 (outage BUS-22 → BUS-21) | 690 MVA | −958.1 MW (138.85 %) | **125.25 %** |
| BUS-22 → BUS-21 (outage BUS-24 → BUS-23) | 690 MVA | 958.1 MW (138.85 %) | **113.79 %** |

`baseFlowMW` for those two rows is only −351.6 / 606.5 MW — the pre-outage flow, which pairs with no
percentage on the card.

**Overload table** — one row per entry at or above the resolved `optAdjLoadingThreshold`, worst
`loadingAfterPct` first, so the row count equals `overLimitAfter`. Build the rows per
[Listing the branches after the run](#listing-the-branches-after-the-run):

- **Branch** — `branchId`, rendered with `→` instead of `->`; in N-1 mode append the outage that
  produced the row (`BUS-24 → BUS-23 (outage BUS-22 → BUS-21)`);
- **Rating** — `limitMW` in MVA, the basis the scan measured against;
- **Before** — the flow behind `loadingBeforePct`, i.e. `loadingBeforePct × limitMW / 100`, shown with
  `(loadingBeforePct %)`. **Never** use `baseFlowMW` here in N-1 mode: it is the pre-contingency flow
  and is typically far smaller than the post-contingency flow the percentage describes (the CA file's
  `PostFlowMW`, or `baseFlowMW`'s sign, gives the direction);
- **After** — `loadingAfterPct` in **bold**, with `loadingAfterPct × limitMW / 100` appended when the
  ranking needs the MW. Do not read `shiftedFlowMWAfter` (always `0.0`).

A row sitting *on* the threshold (`100.02 %`, `100.01 %`) is the LP boundary, not a violation: say so
rather than calling it an overload. When `overLimitAfter` is 0, say the overloads cleared and carry the
peak before → after in the lead line; the table then shows the worst few rows instead of an empty body.

**Adjustments table** — every generator row in `<stem>_DF_optadj_gen.csv`, largest `adjP` first, headed
`Adjustments (<gensAdjusted> of <controlGens> control generators moved):`

- **Generator** — `genName`;
- **Scheduled** — `genP` in MW — the pre-adjustment schedule, not the post-run value;
- **AdjP** — `adjP` in MW, in **bold** with an explicit `+` on increases; the column sums to ~0;
- **Limit** — `max <limitMax>` (add `min <limitMin>` only when it is non-zero and binding), with
  `(already at its cap)` when `genP == limitMax` — that is what explains a residual overload.

Then add prose only when it matters:

- the LP ran out of room — name the generators pinned at their P limit, which is why entries remain;
- a follow-up ACLF/CA is planned — say the model still holds the scheduled dispatch (caveat below), so
  the tables' numbers live in the OptAdj CSVs only;
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
- **Measured in this workspace (2026-10-10), that mutation did _not_ reach the held model** in either
  mode. After a basecase run (3 gens adjusted, `Bus30-G1 +37.28 MW`) and after an N-1 run (6 adjusted,
  `Bus30-G1 +450.0`, `Bus32-G1 −353.1`, `Bus35-G1 −268.1`), a read-only Groovy probe still reported
  the scheduled `Bus30=2.5, Bus32=6.5, Bus35=6.5, Bus37=5.4 pu`, and the following `interpss_run_aclf`
  rewrote `ieee39_DF_branch.csv` byte-identically (same md5) to the pre-run solve. Until that is
  reconciled, treat the adjusted dispatch as living in the two OptAdj CSVs only: to have ACLF or CA
  see it, re-apply the `genName`/`adjP` setpoints with an `interpss_run_gvy` script and re-solve. This
  bullet records the measurement; [docs/interpss-tools.md](../../../docs/interpss-tools.md) and the
  bullet above still state the documented behaviour.
- **OptAdj is a DCLF/LODF redispatch, not an AC OPF.** Confirm a stressed operating point with
  `interpss_run_aclf` before acting on it.
- The post-opt re-check tracks **only the entries the scan found**; it does not discover new
  overloads on other branches. Run `$ipss-case-ca` afterwards for a fresh screening.
- An **empty scan** (nothing above the scan threshold) writes both CSVs header-only, reports
  `gensAdjusted: 0`, and does not call the optimizer — that is a result, not an error.
- The outcome is bounded by the case's own generator P limits; a case that cannot move enough MW
  will still show residual overloads.
- Large cases take minutes: the SSA scan and the LODF constraints scale with contingencies ×
  branches. `threads` in `optAdjConfig` (`0` = one worker per processor) is the only knob;
  `sparseSenMatrix` picks the sensitivity path but does not change the work the scan does.
- The mode token is `genAdjCA_N-1` since 0.7.8. `genAdjCaN_1` still works through `optAdjConfig` and a
  config file, but it is a Host-side alias: the CLI reads the file itself, so a CLI run on a
  `genAdjCaN_1` file reports `unsupported optAdjType` until the file says `genAdjCA_N-1`.

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
| `a basecase OptAdj run has no contingencies` | Drop `contingencyFile`, or switch `optAdjType` to `genAdjCA_N-1` |
| `unsupported optAdjType …` | Use `genAdjBaseCase` or `genAdjCA_N-1` |
| `unsupported optAdjType 'genAdjCaN_1'` from a **CLI** run | The retired spelling is a Host-side alias; the CLI reads the file itself, so update `config/opt_adj_run.json` to `genAdjCA_N-1` (the plugin path already normalises it) |
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
