# Gen Optimize Adjustment (OptAdj) — Generator Redispatch for Thermal Limits

Relieve branch thermal overloads by redispatching generator active power (P), using DCLF
flow / LODF sensitivities and a linear program (`GenStateOptimizer`). The SSA scan first
collects overloaded branches (or post-contingency pairs); the optimizer then adjusts control
generators so monitored loadings stay under a percent-of-rating threshold.

This note follows the sparse SSA-result path used by the IEEE-39 samples in
`src/main/java/org/interpss/sample/optadj/`. Thresholds and mode are carried by
`OptAdjRunConfig` (`org.interpss.agent.runner.config`).


|                               | **Basecase OptAdj**                            | **N-1 contingency OptAdj**                                 |
| ----------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| When                          | Pre-contingency branch loading is above rating | Post-contingency (branch outage) loading is above rating   |
| `OptAdjRunConfig` type        | `GEN_ADJ_BASE_CASE` (`"genAdjBaseCase"`)       | `GEN_ADJ_CA_N1` (`"genAdjCA_N-1"`)                          |
| SSA scan                      | `AclfNetSsaHelper.baseCaseScan(thresholdPct)`  | `AclfNetSsaHelper.contingencyScan(contList, thresholdPct)` |
| Optimizer                     | `AclfNetLoadFlowOptimizer(sparse)`             | `AclfNetContigencyOptimizer(sparse)`                       |
| IEEE39 sample                 | `IEEE39_OptBasecase_SsaResult_Sparse_Sample`   | `IEEE39_OptN1Scan_SsaResult_Sparse_Sample`                 |
| Typical scan / opt thresholds | 50% scan → 100% opt                            | 90% scan → 100% opt                                        |


---



## Prerequisites

- IEEE CDF case `wspace/data/ieee/ieee39/ieee39.ieee`
- Generator P limits and branch `ratingMva1` applied (see [Case setup](#case-setup-ieee39))
- DCLF via `ContingencyAnalysisAlgorithm` with `CacheType.SenNotCached`
- Optimizer / SSA classes in **ipss-core** (`com.interpss.optadj.*`,
  `com.interpss.core.funcImpl.dclf.AclfNetSsaHelper`)
- Agent config record: `org.interpss.agent.runner.config.OptAdjRunConfig`

Optional Groovy mirror of the Java fixture limits:

`wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy`

---



## `OptAdjRunConfig`

The mode (`genAdjBaseCase` / `genAdjCA_N-1`) is a **runner / bridge argument**, not a
`config/opt_adj_run.json` key. The persisted record holds the thresholds and run-control knobs:

```java
public record OptAdjRunConfig(
    Double scanLoadingThreshold,
    Double optAdjLoadingThreshold,
    String contingencyMode,
    String contingencyFile,
    Boolean sparseSenMatrix,
    Integer threads) {

    public static final String GEN_ADJ_BASE_CASE = "genAdjBaseCase";
    public static final String GEN_ADJ_CA_N1 = "genAdjCA_N-1";
}
```

| Field | Meaning |
| --- | --- |
| `scanLoadingThreshold` | Percent used by the SSA scan (candidate collection); unset follows the caller’s mode (50 % basecase, 90 % N-1) |
| `optAdjLoadingThreshold` | Percent enforced by the LP optimizer |
| `contingencyMode` / `contingencyFile` | N-1 input: `all` or a `custom` contingency JSON |
| `sparseSenMatrix` | Sensitivity path handed to both optimizer constructors: `true` = sparse (default), `false` = dense |
| `threads` | SSA worker count (`0` = one per available processor) |

The DSH Host mirrors the six file keys in `DEFAULT_OPTADJ_CONFIG` and passes `optAdjType` separately.
It still *reads* a mode from the `optAdjConfig` object or the file — that is where 0.7.4–0.7.10 files
name it — and falls back to the CLI's own inference (a contingency path means N-1) when nothing names
one. The N-1 token was renamed from `genAdjCaN_1` to `genAdjCA_N-1` when `sparseSenMatrix` landed; the
Host still accepts the older spelling wherever it reads the mode and normalises it, while `parseType`
rejects it.

Both IEEE-39 samples build the config with the two-arg form (`new OptAdjRunConfig(50.0, 100.0)`) and
pass the two doubles into scan / optimize.

---



## Core ideas

1. **Scan threshold vs OptAdj threshold.** The SSA scan uses a *lower* percent (e.g. 50% or
   90%) so the sparse sensitivity matrix includes branches that are near limit. The optimizer
   enforces a *higher* limit (typically **100%** of rating). In samples:
   `optAdjRunConfig.scanLoadingThreshold()` vs `optAdjRunConfig.optAdjLoadingThreshold()`.
2. **Sparse SSA path.** Pass `true` to the optimizer constructor — the config's
   `sparseSenMatrix`, sparse by default — and wrap the scan result in
   `OptAdjResultContainer`. Control gens and monitored branches are taken from the SSA
   over-limit set, not the full network — smaller LP / sparse PTDF matrix.
3. **Null result container (full-network path).** In
   `BaseAclfNetLoadFlowOptimizer.optimize(dclfAlgo, ssaResult, threshold)`:
   - `ssaResult == null` → all active gens are control candidates;
     `buildSectionConstrain` monitors all (active) branches; sparse sen falls back to full
     `AclfNetSensSparseHelper.calSen()`.
   - non-null → control gens from `buildControlGenSet`, section constraints from
     `buildSsaSectionConstrain`, sparse sen scoped via `calSenSortNumber(busSet, branchSet)`.
   Plugin samples such as `IEEE39_OptBasecase_Sparse_Sample` call
   `optimize(dclfAlgo, null, 100.0)`. The agent samples below always pass a non-null
   `OptAdjResultContainer`.
4. **Adjustments are applied to the DCLF model.** After `optimize(...)`, re-run
   `dclfAlgo.calculateDclf(...)` and re-scan the *same* monitored set to verify relief.
5. **Ratings.** Loading percent uses `ratingMvaA` / `ratingMva1` on the branch. Without
   realistic ratings the scan finds nothing (or everything).

---



## Workflow overview

```text
1. Load network + apply gen P limits and branch ratings
2. Create ContingencyAnalysisAlgorithm; calculateDclf (INC_LOSS optional)
3. OptAdjRunConfig(type, scanPct, optPct)
4. SSA scan(scanPct)  →  SsaResultContainer
5. OptAdjResultContainer(ssaResult)
6. AclfNet*Optimizer(true).optimize(dclfAlgo, optAdjResult, optPct)
7. Print GenAdjustResult map (genP, adjP, limits)
8. Recalculate DCLF
9. Re-evaluate the same monitored branches / CA pairs; compare loadings
```

---



## Case setup (IEEE39)

Shared by both samples: `IEEE39_Sample_Data.createTestCaseNetwork()`.


| Setting                  | Value                                 |
| ------------------------ | ------------------------------------- |
| Case file                | `wspace/data/ieee/ieee39/ieee39.ieee` |
| Zero-P contribute gens   | Cleared                               |
| `Bus39-G1` P limit       | `[0, 10.0]` pu                        |
| `Bus38-G1` P limit       | `[0, 8.3]` pu                         |
| Other gens P limit       | `[0, 7.0]` pu                         |
| Line `ratingMva1`        | 600 MVA                               |
| Transformer `ratingMva1` | 800 MVA                               |


Without these ratings the IEEE-39 basecase / N-1 OptAdj demos do not show meaningful overloads.

---



## Example A — Basecase sparse OptAdj

**Sample:** `org.interpss.sample.optadj.IEEE39_OptBasecase_SsaResult_Sparse_Sample`

**Goal:** Reduce pre-contingency branch loadings that exceed rating by redistributing gen P.

### Steps

1. Load the prepared IEEE-39 network.
2. Build `ContingencyAnalysisAlgorithm` (`SenNotCached`, contribute-gen mode `true`) and run
   `calculateDclf(DclfMethod.INC_LOSS)`.
3. Create run config (50% scan → 100% opt):

   ```java
   OptAdjRunConfig optAdjRunConfig =
       new OptAdjRunConfig(50.0, 100.0);
   ```

4. Scan basecase:

   ```java
   SsaResultContainer ssaResult = new AclfNetSsaHelper(dclfAlgo)
       .baseCaseScan(optAdjRunConfig.scanLoadingThreshold());
   ```

5. Wrap and optimize:

   ```java
   OptAdjResultContainer optAdjResult = new OptAdjResultContainer(ssaResult);
   new AclfNetLoadFlowOptimizer(true).optimize(
       dclfAlgo, optAdjResult, optAdjRunConfig.optAdjLoadingThreshold());
   ```

6. Recalculate DCLF, then recompute loading only on the original SSA branch set:

   ```java
   dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);
   SsaResultContainer after = new AclfNetSsaHelper(dclfAlgo)
       .calBaseCaseLoading(ssaResult.getBaseOverLimitInfo());
   after.printBaseOverLimitInfo(ssaResult.getBaseOverLimitInfo());
   ```

### What to expect (regression anchors)

From the matching core test (`IEEE39_OptBasecase_SsaResult_Sparse_Test`), with the fixture
ratings above:


| Metric                            | Rough value                                            |
| --------------------------------- | ------------------------------------------------------ |
| Branches above 100% before OptAdj | 5                                                      |
| Generators with material `adjP`   | 5                                                      |
| Peak loading before / after       | ~138% → lower; overloads at 100% drop (often 0–2 left) |


Each `GenAdjustResult` prints `genP`, `adjP` (MW delta applied), and the gen P limit.

---



## Example B — N-1 sparse OptAdj

**Sample:** `org.interpss.sample.optadj.IEEE39_OptN1Scan_SsaResult_Sparse_Sample`

**Goal:** Reduce post-contingency loadings for single branch outages by redistributing gen P.

### Steps

1. Same network load and DCLF as Example A.
2. Create run config (90% scan → 100% opt):

   ```java
   OptAdjRunConfig optAdjRunConfig =
       new OptAdjRunConfig(90.0, 100.0);
   ```

3. Build an N-1 list: one `OPEN` outage per branch **not** connected to the reference bus.

   ```java
   List<DclfBranchOutage> contList = new ArrayList<>();
   net.getBranchList().stream()
       .filter(branch -> !((AclfBranch) branch).isConnect2RefBus())
       .forEach(branch -> {
           DclfBranchOutage cont = DclfAlgoObjectFactory.createContingency("contBranch:" + branch.getId());
           DclfOutageBranch outage = DclfAlgoObjectFactory.createCaOutageBranch(
               dclfAlgo.getDclfAlgoBranch(branch.getId()),
               ContingencyBranchOutageType.OPEN);
           cont.setOutageEquip(outage);
           contList.add(cont);
       });
   ```

4. Contingency SSA scan:

   ```java
   SsaResultContainer ssaResult = new AclfNetSsaHelper(dclfAlgo)
       .contingencyScan(contList, optAdjRunConfig.scanLoadingThreshold());
   ```

5. Optimize with the N-1-aware optimizer:

   ```java
   OptAdjResultContainer optAdjResult = new OptAdjResultContainer(ssaResult);
   new AclfNetContigencyOptimizer(true).optimize(
       dclfAlgo, optAdjResult, optAdjRunConfig.optAdjLoadingThreshold());
   ```

   `AclfNetContigencyOptimizer` extends the basecase optimizer and adds LODF-based section
   constraints for each SSA CA over-limit pair `(outageBranch, monitoredBranch)`.

6. Recalculate DCLF, then re-scan **only** the previously overloaded CA pairs:

   ```java
   dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);
   SsaResultContainer after = new AclfNetSsaHelper(dclfAlgo)
       .contingencyScan(contList, ssaResult.getCaOverLimitInfo());
   after.printCaOverLimitInfo(ssaResult.getCaOverLimitInfo());
   ```

### What to expect (regression anchors)

From `IEEE39_OptN1Scan_SsaResult_Sparse_Test` (same fixture):


| Metric                                   | Rough value                       |
| ---------------------------------------- | --------------------------------- |
| N-1 contingencies (non-ref branches)     | 45                                |
| SSA CA overload entries at 90%           | 19                                |
| Generators with material `adjP`          | 4                                 |
| Peak CA loading before / after           | ~139% → ~126%                     |
| SSA-tracked pairs still above 100% after | 3 (not always zero — LP / limits) |


---



## Key classes


| Class                        | Role                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `OptAdjRunConfig`            | Agent record: mode + scan / OptAdj loading thresholds (%)                  |
| `AclfNetSsaHelper`           | Basecase / contingency loading scan; post-opt re-evaluation helpers        |
| `SsaResultContainer`         | Holds `baseOverLimitInfo` / `caOverLimitInfo` and scan thresholds          |
| `SsaBranchOverLimitInfo`     | One monitored branch (base) or outage+monitored pair (CA)                  |
| `OptAdjResultContainer`      | Extends SSA result; stores OptAdj threshold and `GenAdjustResult` map      |
| `AclfNetLoadFlowOptimizer`   | Basecase section constraints + gen limits → LP → apply `adjP` to DCLF gens |
| `AclfNetContigencyOptimizer` | Same, plus post-contingency (LODF) section constraints                     |
| `BaseAclfNetLoadFlowOptimizer` | Shared `optimize(...)`; null vs SSA container branches                     |
| `GenStateOptimizer`          | LP solver over gen dispatch variables and section constraints              |


Constructor flag: `new AclfNetLoadFlowOptimizer(true)` / `new AclfNetContigencyOptimizer(true)`
selects the **sparse** sensitivity matrix (`AclfNetSensSparseHelper`), scoped to SSA
branches and control-gen parent buses when an `OptAdjResultContainer` is supplied.

---



## How to run the samples

From the `ipss-agent` project root (classpath / IDE run configuration with the case path
resolvable as `wspace/data/ieee/ieee39/ieee39.ieee`):

```text
org.interpss.sample.optadj.IEEE39_OptBasecase_SsaResult_Sparse_Sample
org.interpss.sample.optadj.IEEE39_OptN1Scan_SsaResult_Sparse_Sample
```

Plugin-side twins (same algorithm, different package / case loader) live under
`ipss-plugin/.../org/interpss/optadj/ieee39/sparse/`. Non-SSA (`null` container) variants are
named without `SsaResult` in the class name (e.g. `IEEE39_OptBasecase_Sparse_Sample`).

---



## Caveats

- OptAdj is a **DCLF / sensitivity** redispatch, not a full AC OPF. Confirm important
  solutions with AC load flow when the operating point is stressed.
- Passing `null` as the result container optimizes against **all** branches and gens
  (`BaseAclfNetLoadFlowOptimizer`); the SSA wrapper is what makes the sparse path scale.
- Post-opt N-1 verification that reuses `getCaOverLimitInfo()` only tracks pairs found in
  the pre-opt scan — it does not discover new overloads on other branches.
- Generator P limits in the fixture are intentional; without them the LP can move unlimited
  MW and the sample numbers will not match the regression tests. The agent runner therefore
  **refuses** a case whose active generators carry no P gen limit (the optimizer's constraint
  builder dereferences `getPGenLimit()` without a null check) and one whose branches carry no
  `ratingMva1` (the scan divides the flow by it).
- OptAdj is wired end to end since plugin 0.7.4: `OptAdjRunner` (`org.interpss.agent.runner`)
  runs both examples for the CLI (`IpssCmd optadj`), the bridge
  (`IpssAgentBridge.runOptAdjWithConfig`) and the chat tool `interpss_case_optadj`, with
  `config/opt_adj_run.json` persisted per case beside `ca_run.json`. The mode is a call argument
  (CLI infers N-1 from a contingency path; the Host reads one from its argument, its
  `optAdjConfig` or the file and then infers the same way); the file carries thresholds, contingency input,
  `sparseSenMatrix` and `threads`. Since 0.7.5 each mode writes its own result pair —
  `_DF_optadj_gen.csv` / `_DF_optadj_branch.csv` for the basecase,
  `_DF_optadj_N1_gen.csv` / `_DF_optadj_N1_branch.csv` for `genAdjCA_N-1` — so the two runs can share
  one `result/` folder.
- Since **0.7.7** the Diagram tab’s branch tooltip quotes those branch tables: **Basecase OptAdj
  Loading(%)** from `_DF_optadj_branch.csv` and **Contingency OptAdj Loading(%)** from
  `_DF_optadj_N1_branch.csv`, each the worst post-redispatch `loadingAfterPct` for that bus pair.
  Absent files leave the plain ACLF/CA lines unchanged. (0.7.6 added the client wiring; 0.7.7
  opened Host `readCsv` to the OptAdj families so the lines can actually load.)
- Related but different: voltage control via load Q is documented in
  [load-q-adjustment.md](load-q-adjustment.md), not here.

---



## Related

- Samples: `src/main/java/org/interpss/sample/optadj/`
- Config: `src/main/java/org/interpss/agent/runner/config/OptAdjRunConfig.java`
- Runner / bridge / CLI: `src/main/java/org/interpss/agent/runner/OptAdjRunner.java`,
  `IpssAgentBridge.runOptAdjWithConfig`, `IpssCmd optadj`
- Tool: `interpss_case_optadj` — [interpss-tools.md](interpss-tools.md) and the `$ipss-case-optadj` skill
- Diagram tooltips: [oneline_diagram_user_guide.md](user_guide/oneline_diagram_user_guide.md),
  [oneline-diagram-process.md](oneline-diagram-process.md)
- Case limits script: `wspace/data/ieee/ieee39/scripts/ieee39_limit_setup.gvy`
- Core implementation: `ipss-core` → `com.interpss.optadj.*`,
  `com.interpss.optadj.algo.lf.BaseAclfNetLoadFlowOptimizer`
- Voltage / load-Q adjustment: [load-q-adjustment.md](load-q-adjustment.md)
