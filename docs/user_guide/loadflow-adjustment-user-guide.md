# Loadflow Adjustment User Guide

Two practical adjustment workflows for InterPSS DSH Chat:

1. **Load-Q (voltage)** — raise or lower bus voltages by changing reactive load, using a
  `dV/dQ` sensitivity approach to size the step and AC load flow to confirm it  (`$ipss-case-aclf-adjust`).
2. **Gen OptAdj (thermal)** — relieve basecase or N-1 branch overloads by redispatching
  generator active power via a DC-sensitivity scan and Linear Programming  (`$ipss-case-optadj` / `interpss_case_optadj`).

Engineering detail: [load-q-adjustment.md](../load-q-adjustment.md) (voltage) and
[gen_opt_adjustment.md](../gen_opt_adjustment.md) (generator redispatch). Plugin overview:
[dsh_plugin_user_guide.md](dsh_plugin_user_guide.md).

---



## When to use this


| Situation                                                                  | Approach                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| One bus is outside a voltage band; other targets are weakly coupled        | Adjust **one** load Q (scalar `dV/dQ`)                               |
| Two or more buses must land in the same band and move each other’s voltage | Adjust the loads **together using an** N×N `dV/dQ` sensitivity matrix |
| Pre-contingency branch loading is above rating                             | LP-based Gen optimization adjustment **basecase** (`genAdjBaseCase`) |
| Post-contingency (N-1 branch outage) loading is above rating               | LP-based Gen optimization adjustment **CA N-1** (`genAdjCA_N-1`)      |


Typical voltage goal: bring a depressed bus into a band such as **[0.90, 0.91]** pu by reducing bus load Q (active power left unchanged). The shipped IEEE14 fixtures use that band.

Typical thermal goal: redispatch gen P on IEEE 39 (or your own rated case) so monitored branch
loadings stay under **100%** of rating.

---



# Part 1 — Bus Load-Q adjustment (voltage)



## Prerequisites

- InterPSS DSH Plugin with Chat tools available — see [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md)
- A loaded simulation case (IEEE CDF, PSS/E RAW or BPA Dat) under `wspace/data/**`
- Groovy scripts under the case folder’s `scripts/` directory (or an absolute / relative path the agent can resolve)
- Prefer **Creater** mode in Chat so the agent can call `interpss_case_load`, `interpss_run_aclf`, and `interpss_run_gvy`

There is **no CLI path** for these scripts: `IpssCmd` has no `gvy` subcommand. Run
adjustments through DSH Chat (or an equivalent bridge session).

---



## Core ideas (short)

1. **Injection vs load.** Sensitivity is reported as `dV / dQ_injection` (positive self term:
  injecting Q raises voltage). A load is a *negative* injection — to **raise** voltage,
   **reduce** load Q.
2. **B″ is a first cut.** `SenAnalysisType.QVOLTAGE` is fast and useful for ranking / a
  starting step. Size the final Q from AC solves (secants or a re-measured Jacobian).
3. **Target a band, not a point.** Aiming at exactly the edge often lands just outside.
  For one bus, use the **midpoint** of the band. For multi-bus “max load under the band”,
   use a slightly **inset** corner.
4. **Reload before comparing solves.** Use `reload: true` on script runs when you need a
  fresh parse; ACLF control adjustments on a held model can drift voltages between runs.
5. **Edit contribute loads.** On contribute gen/load models, set
  `bus.getContributeLoad(loadId).loadCP` — do not rely on aggregate `bus.loadP` / `bus.loadQ`.

---



## Workflow overview

```text
1. Load case
2. Solve ACLF  (or start from a solvable anchor if the stored case does not converge)
3. Measure dV/dQ  (B″ script, then AC check if stressed)
4. Size load-Q change for the voltage band
5. Apply Groovy edit  (reload: true when starting from the file on disk)
6. Solve ACLF and verify bus voltages in result CSVs
7. Re-measure if the operating point moved a lot or generators hit Q limits
```

Natural-language prompts the agent can map to tools:


| You say                           | Typical tools / skills                           |
| --------------------------------- | ------------------------------------------------ |
| Load the large-load-Q IEEE14 case | `$ipss-case-load` / `interpss_case_load`         |
| Run ACLF                          | `$ipss-case-aclf` / `interpss_run_aclf`          |
| Run the dV/dQ script              | `$ipss-case-script` / `interpss_run_gvy`         |
| Adjust load Q to a target band    | `$ipss-case-aclf-adjust` (this whole workflow)   |
| Summarize lowest voltages         | `$ipss-case-summary` / `interpss_case_summary`   |


Bare script names resolve to the case folder’s `scripts/` directory.

---



## Example A — Single bus: IEEE14 Bus14

**Goal:** raise V(Bus14) into **[0.90, 0.91]** pu by reducing Bus14 load Q only.


|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| Case           | `wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee`              |
| Starting point | Bus14 = 14.9 MW + j50.0 MVAr, V ≈ 0.871 pu (only bus below 0.90) |
| Applied result | Q 50.0 → **44.1 MVAr**, V(Bus14) ≈ **0.905** pu                  |




### Scripts


| Script                             | What it does                                                             |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `ieee14_dvdq_Bus14.gvy`            | Read-only. Prints `dV(Bus14)/dQ(Bus14)` and the B″-implied load-Q window |
| `ieee14_dvdq_Bus14_0p90to0p91.gvy` | Read-only. Same sensitivity sized for the **[0.90, 0.91]** window        |
| `ieee14_adjBus14Q_0p90to0p91.gvy`  | Sets Bus14 load to 14.9 MW + j44.1 MVAr                                  |




### Steps in Chat

```text
/ipss-case-load wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee
/ipss-case-aclf-adjust adjust Bus14 load Q to raise bus voltage to [0.90, 0.91]
Show the lowest bus voltages
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee' })
interpss_run_aclf()
interpss_run_gvy({ script: 'ieee14_dvdq_Bus14_0p90to0p91.gvy' })
interpss_run_gvy({ script: 'ieee14_adjBus14Q_0p90to0p91.gvy', reload: true })
interpss_run_aclf()
```



### What to expect

- B″ may suggest a more aggressive Q cut than AC reality (on this case, B″ window ≈ 41.3–43.5 MVAr;
AC window ≈ 43.1–45.1 MVAr). Prefer the AC-sized value (**44.1** MVAr midpoint).
- After ACLF, Bus14 should sit near **0.905** pu inside the band; no bus below 0.90 pu.



### Apply your own Q (template)

```groovy
busId  = "Bus14";
loadId = "Bus14-L1";
loadP  = 0.149;   // MW in pu on system base — leave unchanged
loadQ  = 0.441;   // MVAr in pu — the adjusted value

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
```

Save under the case `scripts/` folder and run with `$ipss-case-script`, then ACLF.

---



## Example B — Coupled buses: IEEE14 Bus13 + Bus14

**Goal:** bring **both** Bus13 and Bus14 into **[0.90, 0.91]** pu by adjusting both load Q
values together.


|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| Case           | `wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee`                                 |
| Starting point | Both buses at j50.0 MVAr — past the nose point; ACLF does **not** converge as stored |
| Applied result | Q13 → **47.33**, Q14 → **17.51** MVAr; V13 ≈ **0.905**, V14 ≈ **0.905** pu           |


Do **not** adjust one bus at a time here: near the target, cross terms are ~70–80% of the
self terms, so each Q move strongly affects the other voltage.

### Scripts


| Script                              | What it does                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `ieee14_qv_adjust.gvy`              | Older adjuster for the previous band; kept for reference                             |
| `ieee14_qv_adjust_0p90to0p91.gvy`   | Starts from a solvable anchor and walks both Q values into **[0.90, 0.91]** (Newton) |
| `ieee14_adjBus1314Q_0p90to0p91.gvy` | Sets Bus13 to 13.5 MW + j47.33 MVAr and Bus14 to 14.9 MW + j17.51 MVAr (one shot)    |


As in Example A, the adjuster **derives** the two Q values and the setter **applies** them; once the
values are known, the setter alone reproduces the state.

### Steps in Chat

```text
/ipss-case-load wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee
/ipss-case-aclf-adjust adjust Bus13 and Bus14 load Q to raise bus voltage to [0.90, 0.91]
Show the lowest bus voltages
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee' })
interpss_run_gvy({ script: 'ieee14_qv_adjust_0p90to0p91.gvy', reload: true })   # derives Q13/Q14 (~8 passes)
interpss_run_gvy({ script: 'ieee14_adjBus1314Q_0p90to0p91.gvy', reload: true }) # applies those values
interpss_run_aclf()
```

`reload: true` on the adjuster re-parses the stored j50/j50 case; the script then resets to a
solvable anchor and iterates (~8 passes on this fixture). No ACLF is needed before it — the stored
case does not converge. The setter also runs with `reload: true`, so it starts from the file rather
than from whatever state the held model is in (see **Common pitfalls**).

### What to expect

- The stored case may fail ACLF until the adjuster has run — that is intentional.
- Final voltages: Bus13 ≈ **0.905**, Bus14 ≈ **0.905** (both near the band midpoint, ~0.005 pu
clear of each edge).
- Generators may be at Q limits (`GenPQ`); that is why B″ alone is a poor guide on this case.



### Apply your own Q (template)

```groovy
// pu Q on the system base; MW left as stored (13.5 / 14.9 MW)
def LOAD_Q = ['Bus13': 0.4733d, 'Bus14': 0.1751d]

LOAD_Q.each { id, q ->
    def load = aclfnet.getBus(id).getContributeLoad(id + '-L1')
    load.loadCP = new Complex(load.loadCP.real, q)
}
```

Save under the case `scripts/` folder and run with `$ipss-case-script` (add `reload: true`), then ACLF.

---



## Checklist for load-Q on your own case

1. Identify buses outside the voltage band and whether they are strongly coupled.
2. Decide **single-bus** vs **multi-bus** adjustment (table at the top).
3. Copy or adapt the Example A / B scripts: change `busId`, `loadId`, voltage band, and
  (for multi-bus) the bus list and anchor Q values.
4. Keep the three roles in separate files: a **read-only** sensitivity script, a **mutating**
  adjuster that derives the Q values, and a small **mutating setter** that applies them.
5. Solve → measure → size → apply → solve → verify from `result/*_DF_bus.csv`.
6. If the case does not converge as stored, give the adjuster a **solvable anchor** (known good
  Q values + flat start) before the first Newton pass.
7. Persist calibrated Q into the case file (or keep the script as the fixture) if the edit must
  survive the next case load — bridge edits are in-memory only.

---



# Part 2 — Gen Optimize Adjustment (OptAdj)

Relieve **branch thermal overloads** by redispatching generator active power (P). An SSA
(DC-sensitivity) scan collects branches — or post-contingency pairs — above a *scan* threshold; a Linear Programming approach moves control generators so monitored loadings stay under an *OptAdj* (enforce) threshold; the same monitored set is re-checked.

Packaged as `$ipss-case-optadj` / `interpss_case_optadj`. Method, Java samples, and
regression anchors: [gen_opt_adjustment.md](../gen_opt_adjustment.md).


|                               | **Basecase OptAdj**                          | **N-1 contingency OptAdj**                            |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------- |
| When                          | Pre-contingency loading above rating         | Post-contingency (branch outage) loading above rating |
| `optAdjType`                  | `genAdjBaseCase` (default)                   | `genAdjCA_N-1`                                         |
| Typical scan / opt thresholds | 50% scan → 100% opt                          | 90% scan → 100% opt                                   |
| Contingency input             | None (rejects a contingency file)            | All N-1, or a listed `contingencyFile`                |
| Sensitivity path              | `sparseSenMatrix: true` (default)            | same key; `false` selects dense sensitivities          |
| IEEE39 sample                 | `IEEE39_OptBasecase_SsaResult_Sparse_Sample` | `IEEE39_OptN1Scan_SsaResult_Sparse_Sample`            |

The N-1 token was renamed from `genAdjCaN_1` to `genAdjCA_N-1` in 0.7.8. The bridge accepts the
canonical token only and the Host maps the retired spelling wherever it reads the mode — the
`optAdjType` argument above, an `optAdjType` inside `optAdjConfig`, or the one in a
`config/opt_adj_run.json` written from an older copy of this guide — so such a file still runs. The
mode is not one of the six file keys the record reads (0.7.11): when neither the argument nor the file
names one, a contingency file means N-1 and otherwise the basecase, which is how a CLI run of the same
file decides it.


---



## Prerequisites (OptAdj)

The tool **refuses** a case that is missing either of these — it does not guess limits or ratings:


| Requirement                                  | Why                                                 | How to satisfy                                                                      |
| -------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A **P gen limit** on every active generator  | Optimizer constraint builder needs `getPGenLimit()` | Run a `scripts/*.gvy` that sets `gen.pGenLimit` (IEEE 39: `ieee39_limit_setup.gvy`) |
| **Rating MVA 1** (`LimMvaA`) on every branch | Scan uses `abs(flow / ratingMvaA) * 100`            | Same script sets `ratingMva1` (lines 600 MVA, transformers 800 MVA on IEEE 39)      |


Also:

- InterPSS DSH Plugin with Chat tools — see [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md)
- A loaded case under `wspace/data/**` (IEEE CDF, PSS/E RAW or BPA Dat)
- Prefer **Creater** mode so the agent can call `interpss_case_load`, `interpss_run_gvy`, and
`interpss_case_optadj`

CLI alternative (no Chat): `IpssCmd optadj` — see [IpssCmd.md](../../IpssCmd.md).

---



## Core ideas (short)

1. **Scan threshold vs OptAdj threshold.** The scan uses a *lower* percent (50% basecase / 90%
  N-1) so near-limit branches enter the sparse sensitivity set. The LP enforces a *higher*
   limit (typically **100%** of rating).
2. **Sparse SSA path.** The runner wraps the scan in `OptAdjResultContainer` and uses the sparse
  optimizer — control gens and monitored branches come from the over-limit set, not the full
   network.
3. **Mutates the held model.** Generator P on the bridge-held network is overwritten. Later ACLF,
  CA, or a second OptAdj continues from the redispatched state. Use `reload: true` (or reload the
   case) to restore the file’s dispatch.
4. **DCLF, not AC OPF.** Confirm stressed solutions with ACLF when it matters.
5. **Config.** Thresholds and mode live in `OptAdjRunConfig` / optional
  `config/opt_adj_run.json` beside `ca_run.json`. Tool scalars override the file.

---



## Workflow overview

```text
1. Load case
2. Apply gen P limits + branch ratingMva1  (if the case file does not already have them)
3. interpss_case_optadj  (basecase or genAdjCA_N-1)
4. Read gen / branch OptAdj CSVs  (or the card’s Explore results tables)
5. Optional: ACLF or CA to confirm the redispatched operating point
```

Natural-language prompts the agent can map to tools:


| You say                                          | Typical tools / skills                             |
| ------------------------------------------------ | -------------------------------------------------- |
| Load the IEEE39 case                             | `$ipss-case-load` / `interpss_case_load`           |
| Apply IEEE39 gen limits and branch ratings       | `$ipss-case-script` / `interpss_run_gvy`           |
| Relieve basecase overloads by redispatching gens | `$ipss-case-optadj` / `interpss_case_optadj`       |
| Relieve N-1 overloads by redispatching gens      | `$ipss-case-optadj` with `optAdjType: genAdjCA_N-1` |
| Confirm with AC load flow                        | `$ipss-case-aclf` / `interpss_run_aclf`            |


---



## Case setup (IEEE39)

Shared fixture for both OptAdj modes. Java: `IEEE39_Sample_Data.createTestCaseNetwork()`.
Groovy: `wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy`.


| Setting                  | Value                                 |
| ------------------------ | ------------------------------------- |
| Case file                | `wspace/data/ieee/ieee39/ieee39.ieee` |
| Zero-P contribute gens   | Cleared                               |
| `Bus39-G1` P limit       | `[0, 10.0]` pu                        |
| `Bus38-G1` P limit       | `[0, 8.3]` pu                         |
| Other gens P limit       | `[0, 7.0]` pu                         |
| Line `ratingMva1`        | 600 MVA                               |
| Transformer `ratingMva1` | 800 MVA                               |


Without these, the IEEE-39 demos do not show meaningful overloads (and the Chat tool refuses).

---



## Example C — Basecase OptAdj: IEEE39

**Goal:** Reduce pre-contingency branch loadings that exceed rating by redistributing gen P.


|               |                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| Case          | `wspace/data/ieee/ieee39/ieee39.ieee`                                                                                |
| Config        | `optAdjType: genAdjBaseCase`, scan **50%**, enforce **100%**                                                         |
| Limits script | `ieee39_limit_setup.gvy`                                                                                             |
| Result files  | `result/ieee39_DF_optadj_gen.csv`, `result/ieee39_DF_optadj_branch.csv` (an N-1 run writes the `…_optadj_N1_…` pair) |




### Steps in Chat

```text
/ipss-case-load wspace/data/ieee/ieee39/ieee39.ieee; apply wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy; Run Loadflow; List overloading branches
/ipss-case-optadj basecase
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/ieee39/ieee39.ieee' })
interpss_run_gvy({ script: 'ieee39_limit_setup.gvy', reload: true })
interpss_case_optadj({ optAdjType: 'genAdjBaseCase' })
```

Defaults when thresholds are omitted: scan **50%**, OptAdj **100%**.

### What to expect

- Card summary: mode, both thresholds, `scanned`, `overLimitBefore` → `overLimitAfter`,
`controlGens` / `gensAdjusted`.
- **Explore results:** Gen adjustments (`adjP` in MW) and Branch loading
(`loadingBeforePct` / `loadingAfterPct`).
- On the IEEE 39 fixture with the limit script applied, expect several generators with material
`adjP` and peak monitored loading reduced toward (or under) 100%. Exact counts depend on the
library build; see [gen_opt_adjustment.md](../gen_opt_adjustment.md) for regression anchors.

---



## Example D — N-1 OptAdj: IEEE39

**Goal:** Reduce post-contingency loadings for single branch outages by redistributing gen P.


|               |                                                               |
| ------------- | ------------------------------------------------------------- |
| Case          | `wspace/data/ieee/ieee39/ieee39.ieee`                         |
| Config        | `optAdjType: genAdjCA_N-1`, scan **90%**, enforce **100%**     |
| Contingencies | All N-1 (branches not on the reference bus), or a listed JSON |




### Steps in Chat

```text
/ipss-case-load wspace/data/ieee/ieee39/ieee39.ieee; apply wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy; Run CA N-1; List overloading branches (max 10)
/ipss-case-optadj CA N-1
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/ieee39/ieee39.ieee' })
interpss_run_gvy({ script: 'ieee39_limit_setup.gvy', reload: true })
interpss_case_optadj({ optAdjType: 'genAdjCA_N-1' })
# or a listed contingency set:
# interpss_case_optadj({ optAdjType: 'genAdjCA_N-1', contingencyFile: 'sub_115kV.json' })
```

Defaults when thresholds are omitted: scan **90%**, OptAdj **100%**.
`contingencyFile` is rejected in basecase mode.

### What to expect

- `contingencies` ≈ 45 on IEEE 39 (non-ref branches); `outageBranchId` filled in the branch CSV.
- Peak contingency loading on the SSA-tracked pairs drops after redispatch; some pairs may remain
above 100% when gen limits bind — that is normal for the LP.
- Prefer the card’s tables over pasting CSV rows into Chat.

---



## Reading OptAdj results


| Field / file                         | Meaning                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overLimitBefore` / `overLimitAfter` | Entries at or above the OptAdj threshold, before and after                                                                                                                                                                |
| `controlGens` / `gensAdjusted`       | Generators considered / moved by a material `adjP`                                                                                                                                                                        |
| `<stem>_DF_optadj_gen.csv`           | `genName, genP, adjP, limitMax, limitMin` — MW; largest `adjP` first (N-1: `<stem>_DF_optadj_N1_gen.csv`)                                                                                                                 |
| `<stem>_DF_optadj_branch.csv`        | `branchId, outageBranchId, limitMW, …, loadingBeforePct, loadingAfterPct` — `outageBranchId` empty in basecase (N-1: `<stem>_DF_optadj_N1_branch.csv`). The Diagram tab (0.7.7+) quotes `loadingAfterPct` on branch hover |


Suggested follow-on: `$ipss-case-aclf` or `$ipss-case-ca` on the redispatched held model (or
`reload: true` first if you need the file’s original dispatch).

---



## Checklist for OptAdj on your own case

1. Confirm every active generator has a **P gen limit** and every branch has **ratingMva1**.
2. Decide **basecase** vs **N-1** (`genAdjBaseCase` / `genAdjCA_N-1`).
3. Optionally persist defaults in `config/opt_adj_run.json`; override per call with tool args.
4. Run OptAdj → read gen / branch CSVs (or the card) → optional ACLF/CA confirm.
5. Remember the held model is mutated; reload before comparing to the stored case file.

---



## Common pitfalls


| Symptom                                          | Likely cause                                                          | What to do                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Voltage moves the wrong way after raising load Q | Injection/load convention mixed up                                    | Reduce load Q to raise V; use `J = −M` for Newton                                |
| B″ window looks good but ACLF misses the band    | Stressed bus / Q-limited gens                                         | Size from AC secants or re-measure `J` each pass                                 |
| Numbers drift between identical Q values         | Held-model control adjustments                                        | Use `reload: true` before each comparative solve                                 |
| Same Q values now give a lower voltage           | A diverged ACLF left the generators switched to `GenPQ` at constant Q | Re-parse (`reload: true`) before applying — a load-only script cannot restore PV |
| Aggregate `bus.loadQ` change has no effect       | Contribute gen/load model                                             | Edit `getContributeLoad(loadId).loadCP`                                          |
| Next load restores old Q                         | Edit never written to disk                                            | Update the case file or re-run the adjuster script                               |
| Result CSVs look “old” after another ACLF        | Each ACLF overwrites `result/`                                        | Re-read CSVs / regenerate reports after the final solve                          |
| OptAdj refuses: generators have no P gen limit   | Missing `pGenLimit`                                                   | Run the case’s limit-setup script (IEEE39: `ieee39_limit_setup.gvy`)             |
| OptAdj refuses: branches have no rating MVA 1    | Missing `ratingMva1` / `LimMvaA`                                      | Same — rate branches before the scan                                             |
| `a basecase OptAdj run has no contingencies`     | `contingencyFile` passed with `genAdjBaseCase`                        | Drop the file, or switch to `genAdjCA_N-1`                                        |
| ACLF/CA still show pre-OptAdj dispatch           | Expected the file, but held model was not mutated / or was reloaded   | OptAdj mutates the held net; do not reload if you want the redispatched state    |
| Some N-1 pairs still above 100% after OptAdj     | Gen P limits / LP feasibility                                         | Normal when limits bind; check `adjP` and tighten ratings or widen gen limits    |


---



## Related

- [load-q-adjustment.md](../load-q-adjustment.md) — load-Q method, conventions, IEEE14 walkthroughs
- [gen_opt_adjustment.md](../gen_opt_adjustment.md) — OptAdj method, samples, SSA/null paths, anchors
- [oneline_diagram_user_guide.md](oneline_diagram_user_guide.md) — Diagram tab OptAdj loading tooltips (0.7.7+)
- [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md) — InterPSS tab, Chat tools, OptAdj overview
- [batch_chat_user_guide.md](batch_chat_user_guide.md) — batch `/ipss-sim` style runs
- [IpssCmd.md](../../IpssCmd.md) — CLI `optadj` subcommand
- [Release-V0.7.15.md](../release_note/Release-V0.7.15.md) — OptAdj config trail (`sparseSenMatrix`, `genAdjCA_N-1`, mode as call arg) through 0.7.15
- Skills: `$ipss-case-aclf-adjust` (load-Q), `$ipss-case-optadj` (gen redispatch), `$ipss-case-load`,
`$ipss-case-aclf`, `$ipss-case-ca`, `$ipss-case-script`, `$ipss-case-summary`
- Load-Q Example A scripts: `wspace/data/ieee/Ieee14Bus_LargeLoadQ/scripts/`
- Load-Q Example B scripts: `wspace/data/ieee/Ieee14Bus_LargeLoadQ2/scripts/`
- OptAdj IEEE39 limits: `wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy`
- OptAdj samples: `src/main/java/org/interpss/sample/optadj/`
  (`IEEE39_OptBasecase_SsaResult_Sparse_Sample`, `IEEE39_OptN1Scan_SsaResult_Sparse_Sample`)

