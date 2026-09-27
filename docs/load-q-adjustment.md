# Load-Q Adjustment — dV/dQ Sensitivity Walkthroughs

Worked examples of using the Groovy script adapter to move bus voltages with reactive load:
measure a `dV/dQ` sensitivity, size a load-Q change from it, and confirm the result with AC load
flow. The engineering point is the same in both, in different degrees — the linearised (B″)
sensitivity is a *first cut only*; once the case is stressed, the value that actually governs the
operating point has to be measured from AC solves.

| | **Part 1 — single load** | **Part 2 — multiple loads** |
| --- | --- | --- |
| Case | `wspace/data/ieee/Ieee14BusLargeLoadQ/ieee14.ieee` | `wspace/data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee` |
| Buses adjusted | Bus14 | Bus13 **and** Bus14 |
| Starting state | solved, V(Bus14) = 0.871352 pu | **no solution** — j50.0 MVAr at both buses is past the nose point |
| Method | B″ first cut, then AC secant steps; target = midpoint of the band | 2×2 `dV/dQ` matrix re-measured by finite differences every pass; damped Newton with a line search |
| Result | Q 50.0 → 46.0 MVAr, V(Bus14) = 0.895243 pu | Q13 50.0 → 45.505 and Q14 50.0 → 21.320 MVAr, V13 = 0.89900, V14 = 0.89100 pu |

## Part 1 — Single load: Bus14 (one bus, secant steps)

- **Case**: `wspace/data/ieee/Ieee14BusLargeLoadQ/ieee14.ieee` (IEEE 14-bus, 14 buses, 20 branches)
- **Problem**: Bus14 carries an unusually large reactive load (14.9 MW + j50.0 MVAr); its
  solved voltage is 0.871 pu and it is the only bus below 0.90 pu
- **Goal**: raise V(Bus14) into the window **[0.89, 0.90]** pu by reducing Bus14 load Q only
- **Result**: Bus14 load Q 50.0 → **46.0 MVAr**, giving **V(Bus14) = 0.895243 pu** (in window)

### Deliverables

| File | Role |
| --- | --- |
| `wspace/data/ieee/Ieee14BusLargeLoadQ/scripts/ieee14_dvdq_Bus14.gvy` | Read-only. Computes `dV(Bus14)/dQ(Bus14)` and the load-Q window implied by it |
| `wspace/data/ieee/Ieee14BusLargeLoadQ/scripts/ieee14_adjBus14Q_0p89to0p90.gvy` | Mutating. Sets Bus14 load to 14.9 MW + j46.0 MVAr |

Both are evaluated by `interpss_run_gvy`; a bare file name resolves to the case folder's
`scripts/` directory.

### Step 1 — measure dV/dQ at Bus14

`AclfNetDshGvyScriptProcessor` binds `aclfnet` (the live `AclfNetwork`) and `senAlgo` (a
`SenAnalysisAlgorithm` on that same network). `SenAnalysisType.QVOLTAGE` is the linearised
`dV/dQ` from the B″ network:

```groovy
dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, 'Bus14', 'Bus14')
```

Signature is `dV(monitorBus)/dQ(injectBus)`, in pu voltage per pu reactive **injection** —
so the self term is positive here (`dVdQ > 0`: injecting Q raises the bus voltage). Reaching
a target voltage therefore needs

```text
dQinject = (targetV - V0) / dVdQ      [pu injection, positive]
Qload    = Qload0 - dQinject          [the load moves the other way]
```

Measured on the solved base case:

| Quantity | Value |
| --- | --- |
| Base voltage V0 | 0.871352 pu |
| Base load | 14.9 MW + j50.0 MVAr |
| `dV(Bus14)/dQ(Bus14)` (B″) | **0.4437 pu/pu** |
| `dQ/dV` (reciprocal) | 2.2539 pu/pu |
| B″-implied load-Q window for [0.89, 0.90] pu | 43.54 … 45.80 MVAr (midpoint 44.67) |

Because `SenAnalysisType.QVOLTAGE` is topology/admittance based, the *sensitivity* is
reproducible; the *base voltage* the script prints is the operating point of the held model,
so run it on a solved case (after an ACLF) for a meaningful window.

### Why B″ is not enough

B″ is a linearisation and ignores reactive losses, so it understates the stiffness of a
deeply depressed bus. The AC finite difference on this case, from two real solves:

```text
(0.877732 - 0.871352) / 0.01 = 0.638 pu/pu        (~1.4x the B'' value, near the base)
```

and the AC sensitivity falls to ~0.52 pu/pu as the bus recovers toward 0.90 pu. The B″
window is therefore too optimistic: it says 43.5–45.8 MVAr, while AC says ~45.1–46.9 MVAr.

### Step 2 — size the adjustment

Each row below is a real measurement on this case, with a **fresh reparse per solve**
(`interpss_run_gvy` with `reload: true`, then `interpss_run_aclf`, reading Bus14 `VoltMag`
from `result/ieee14_DF_bus.csv`). Steps 3 onward use AC secants, `(V2-V1)/(Q2-Q1)`, rather
than the linear value.

| Q (MVAr) | V(Bus14) pu | How |
| --- | --- | --- |
| 50.00 | 0.871352 | base case (only bus below 0.90) |
| 49.00 | 0.877732 | finite-difference probe for the AC `dV/dQ` |
| 45.51 | 0.897791 | secant from the 50.00 / 49.00 pair — in window |
| 45.13 | 0.899754 | secant from the 49.00 / 45.51 pair — top edge |
| 45.00 | 0.900423 | just outside, over-corrected |
| **46.00** | **0.895243** | **applied** — inside [0.89, 0.90] |

The AC-measured window for [0.89, 0.90] pu is ≈ 45.1 … 46.9 MVAr, i.e. ~3.1–4.9 MVAr of
reactive load shed. 46.0 MVAr sits at its midpoint, leaving margin on both edges.

```groovy
busId  = "Bus14";
loadId = "Bus14-L1";
loadP  = 0.149;   // 14.9 MW — untouched
loadQ  = 0.460;   // 46.0 MVAr

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
```

IEEE14 is a **contribute gen/load model** (`net.isContributeGenLoadModel()`), so the edit goes
through the contribute load: assigning `bus.loadP` / `bus.loadQ` (the aggregates) does not move
the case totals on this model.

### Verification

After the adjustment (`reload: true` → script → ACLF): converged, total generation
276.27 → 275.47 MW, total load unchanged at 259.00 MW. Lowest bus voltages:

| Bus | VoltMag (pu) |
| --- | --- |
| **Bus14** | **0.895243** |
| Bus13 | 0.979396 |
| Bus10 | 0.987854 |
| Bus9 | 0.990461 |

No bus is below 0.89 pu, and Bus14 — the only bus that was below 0.90 — is now inside the
requested window.

### Reproduce

DSH chat tools, in order:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14BusLargeLoadQ/ieee14.ieee' })
interpss_run_aclf({ case: '…' })                                    # solve the base case
interpss_run_gvy({ case: '…', script: 'ieee14_dvdq_Bus14.gvy' })    # read-only: dV/dQ + window
interpss_run_gvy({ case: '…', script: 'ieee14_adjBus14Q_0p89to0p90.gvy', reload: true })
interpss_run_aclf({ case: '…' })                                    # confirm V(Bus14)
```

There is no CLI path for the scripts: `IpssCmd` has no `gvy` subcommand, and a CLI `aclf`
run is its own JVM — nothing stays loaded for the next command, and script edits do not
survive.

### Caveats and lessons (Part 1 — single load)

- **Always reparse (`reload: true`) per solve.** The AC load flow mutates the held model
  through its control adjustments (PV/PQ limit switching, discrete and tap control, voltage
  adjustment), so repeated solves on a held model drift from the fresh-parse solution. In this
  exercise a held-model run at Q ≈ 45.5 MVAr read ~0.0014 pu higher than the same input on a
  fresh parse; every number in the tables above is from the reload path.
- **Treat B″ `dV/dQ` as a first cut.** Useful for ranking and for a starting step; size the
  final value from AC solve secants.
- **A voltage target is a band, not a point.** Asking for exactly 0.90 pu landed at 0.900423 —
  outside the window — which is why the working target is the midpoint of [0.89, 0.90].
- **ACLF overwrites results.** Each run replaces `result/ieee14_DF_{bus,branch,gen,load}.csv`
  and `result/ieee14_network_info.txt`; any previously generated report or HTML dashboard for
  that folder is stale afterwards and must be regenerated.
- **Scripts are not self-preserving.** `wspace/data/ieee/Ieee14BusLargeLoadQ/scripts/` was
  emptied by an external process partway through this work, taking both scripts and the two
  pre-existing `ieee14inv_adjBus14*.gvy` with it (both have since been restored). Keep scenario
  edits in version control (or in the shared `wspace/script/` fixture directory) if they need to
  outlive the case folder.

## Part 2 — Multiple loads: Bus13 + Bus14 (2×2 dV/dQ matrix)

Adjusting one bus at a time does not generalise. When two buses must land in the same window and
they are strongly coupled, each bus's Q moves the other's voltage almost as much as its own, so
the two targets have to be solved together — which is what the 2×2 form of the same measurement
does.

### The case and the goal

- **Case**: `wspace/data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee` (IEEE 14-bus, 14 buses, 20 branches)
- **Problem**: Bus13 (13.5 MW) and Bus14 (14.9 MW) both carry **j50.0 MVAr**. That loading is past
  the nose point, so the ACLF does not converge at all — `max mismatch dP 0.01036 @ Bus9`,
  `dQ 0.01911 @ Bus14` — and the voltage a diverged run leaves behind (0.663 / 0.588 pu) is not a
  solution of anything. Unlike Part 1 there is no solved operating point to start from.
- **Goal**: bring **both** buses into **[0.89, 0.90]** pu by adjusting their load Q (the MW is
  untouched)
- **Result**: Q13 50.0 → **45.505 MVAr**, Q14 50.0 → **21.320 MVAr**, giving
  **V13 = 0.89900 pu**, **V14 = 0.89100 pu** — converged, 7 passes

### Deliverables

| File | Role |
| --- | --- |
| `wspace/data/ieee/Ieee14BusLargeLoadQ2/scripts/ieee14_dvdq_matrix.gvy` | Effectively read-only. Prints the 2×2 **reference** matrix (B″) and, when the model is solved, the 2×2 **operating-point** matrix measured by finite differences, each with its inverse. Restores Q and the solved state before returning. |
| `wspace/data/ieee/Ieee14BusLargeLoadQ2/scripts/ieee14_qv_adjust.gvy` | Mutating. Walks Q13/Q14 from a solvable anchor to the largest load Q that keeps both buses inside [0.89, 0.90], and leaves the model solved at the target. |

Both are evaluated by `interpss_run_gvy`; a bare file name resolves to the case folder's
`scripts/` directory.

### Step 1 — the 2×2 matrix, and the two conventions

`senAlgo.calBusSensitivity(QVOLTAGE, from, to)` returns `dV(to)/dQ**injection**(from)`, positive on
the self term (injecting Q raises the voltage). A load is a *negative* injection, so the matrix the
adjuster steps on is the load-convention one:

```text
M[f][t] = dV(bus_t) / dQinjection(bus_f)         (senAlgo; positive self terms)
J[r][c] = dV(bus_r) / dQload(bus_c) = -M[r][c]   (negative self terms)

Newton step:  dQload = inv(J) @ (V_measured - V_target)     [pu on the 100 MVA base]
```

Worth stating out loud because it is easy to get backwards: a step that *increases* load Q must
*lower* voltage, so `J` is negative and the correction is `inv(J) @ (V - Vtarget)`, not
`inv(J) @ (Vtarget - V)`.

### Step 2 — why the reference matrix is not enough

Two independent effects move the reference matrix on this case, and both are visible at once:

| Network state | `dV/dQinjection` matrix (pu/pu) |
| --- | --- |
| Freshly parsed — all four generators regulating as PV | `[ 0.1172 0.0608 ; 0.0608 0.2558 ]` |
| After the limit-controlled solves — generators pinned at their Q limits (`GenPQ`) | `[ 0.3731 0.2723 ; 0.2723 0.4437 ]` |

B″ is built from the current bus types and branch admittances, so a PV→PQ conversion changes it; it
also linearises at V ≈ 1.0 pu, which a stressed case is nowhere near. The finite-difference
measurement shows how far the real sensitivity travels:

```text
|dV(Bus13)/dQload(Bus13)|   0.086 pu/pu   at V13 = 1.0504   (anchor)
                            0.509 pu/pu   at V13 = 0.8990   (target)
```

Neither reference value tracks that, so `ieee14_qv_adjust.gvy` re-measures the matrix at the
current operating point before every step and keeps the reference matrix only as the fallback for
a probe that will not solve.

### Step 3 — measure the operating-point matrix

The probe perturbs one load Q at a time, solves, divides the voltage response by the perturbation,
then restores the Q values **and** the saved bus voltages and re-solves — so the model is back on
the same solution branch before the next column and before the step itself:

```groovy
EPS = 0.01d                       // pu, 1 MVAr -- 0.02 pu far from the target
BUSES.eachWithIndex { id, c ->
    def qSave = BUSES.collect { qOf(it) }
    def vSave = snapV()
    setQ(id, qSave[c] + EPS)      // +EPS of *load* Q
    if (solveLf()) {
        def vp = BUSES.collect { vOf(it) }
        BUSES.eachWithIndex { bid, r -> J[r][c] = (vp[r] - v0[r]) / EPS }
    } else {                      // probe diverged -- fall back to the reference matrix
        J[0][c] = -M[0][c]; J[1][c] = -M[1][c]
    }
    BUSES.eachWithIndex { bid, i -> setQ(bid, qSave[i]) }
    restoreV(vSave); solveLf()
}
```

Measured on the way up to the target (self terms and the `J[0][1]` cross term, pu/pu):

| V13 / V14 (pu) | J self terms | J cross term |
| --- | --- | --- |
| 1.0504 / 1.0355 | -0.086 / -0.209 | -0.047 |
| 1.0085 / 1.0008 | -0.288 / -0.320 | -0.190 |
| 0.9851 / 0.9768 | -0.354 / -0.410 | -0.262 |
| 0.9648 / 0.9566 | -0.372 / -0.430 | -0.278 |
| 0.9450 / 0.9368 | -0.424 / -0.487 | -0.330 |
| 0.9234 / 0.9153 | -0.478 / -0.543 | -0.379 |
| 0.9031 / 0.8951 | -0.500 / -0.565 | -0.400 |
| **0.8990 / 0.8910** | **-0.509 / -0.575** | **-0.408** |

### Step 4 — the adjuster loop

It starts from a solvable anchor — the base IEEE-14 values Q13 = 5.8 MVAr, Q14 = 5.0 MVAr, flat
start via `aclfnet.initBusVoltage()` — because the case as stored has no solution to start from.
Then each pass measures V, measures J, and takes a damped Newton step whose predicted voltage move
is capped, applied through a line search that halves the step until a real solve improves
`max|V - target|`; a step that will not solve is rolled back to the saved solved state and retried.

| Pass | Q13, Q14 after (MVAr) | V13, V14 after (pu) | dQ applied (MVAr) |
| --- | --- | --- | --- |
| 1 | 26.514, 9.458 | 1.00847, 1.00084 | +20.714, +4.458 |
| 2 | 31.140, 12.951 | 0.98514, 0.97680 | +4.626, +3.492 |
| 3 | 35.066, 15.280 | 0.96484, 0.95658 | +3.926, +2.330 |
| 4 | 38.794, 17.493 | 0.94500, 0.93684 | +3.728, +2.212 |
| 5 | 42.045, 19.374 | 0.92340, 0.91527 | +3.252, +1.882 |
| 6 | 44.938, 21.004 | 0.90310, 0.89507 | +2.893, +1.630 |
| 7 | **45.505, 21.320** | **0.89900, 0.89100** | +0.567, +0.316 |

The pass-1 step is set by the predicted-move cap (0.020 pu), not by the matrix; the last step is
the Newton step itself and it lands within 4e-9 pu of the target.

The **target is the corner of the band inset by 1e-3 pu** — V13 → 0.899, V14 → 0.891 — because that
is the largest load Q that keeps both buses *strictly* inside [0.89, 0.90]. Aiming at the exact
corner puts V14 at 0.890000, which one run delivered as 0.889999998 — technically outside. Unlike
Part 1, the working target is deliberately not the midpoint: here the point of the exercise is the
largest reactive load the band allows.

### Step 5 — verification

`interpss_run_aclf` on the adjusted model: **converged**, total generation 275.81 MW, total load
unchanged at 259.00 MW, `max mismatch dP 0.00001 @ Bus6`, `dQ 0.00004 @ Bus13`. Lowest bus voltages
from `result/ieee14_DF_bus.csv`:

| Bus | VoltMag (pu) |
| --- | --- |
| **Bus14** | **0.891000** |
| **Bus13** | **0.899000** |
| Bus12 | 0.924066 |
| Bus11 | 0.959210 |
| Bus10 | 0.961847 |

`result/ieee14_DF_load.csv` reads back Bus13 j45.5053 MVAr and Bus14 j21.3202 MVAr. The two buses
the adjustment targets are still the lowest in the case, and both now sit inside the window.

At this operating point **all four generators are pinned at their reactive limits**: the model
reports `genCode = GenPQ` with `genQ` exactly at the limit for Bus2 (0.50), Bus3 (0.40), Bus6
(0.24) and Bus8 (0.24). That is the physical reason the reference matrix moved from the all-PV
value to the pinned one above, and it is what makes the case a useful stressed fixture — both buses
are held up entirely by the network, with no generator voltage support left.

### Reproduce

DSH chat tools, in order:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee' })
interpss_run_gvy({ script: 'ieee14_dvdq_matrix.gvy', reload: true })   # reference matrix
interpss_run_gvy({ script: 'ieee14_qv_adjust.gvy', reload: true })     # anchor -> 7 passes -> target
interpss_run_aclf()                                                    # confirm both buses
interpss_run_gvy({ script: 'ieee14_dvdq_matrix.gvy' })                 # operating-point matrix at the target
```

`reload: true` on the adjuster is what makes the run reproducible from the stored case: it re-parses
the file (j50.0 / j50.0) and the script's own anchor restart takes it from there. Re-running the
adjuster without `reload` is safe as well — it continues from the solved state it finds and
re-measures the matrix there, so it is not exposed to the held-model drift Part 1 warns about.

### Caveats and lessons (Part 2 — multiple loads)

- **Solve the pair together.** Near the target the cross terms are 0.71–0.80 of the self terms
  (`J = [-0.509 -0.408 ; -0.411 -0.575]`), so a step sized for one bus moves the other by ~80% as
  much. Two independent single-bus adjustments chase each other; the 2×2 inverse is what resolves
  the pair.
- **Re-measure, do not extrapolate.** The self term grows from 0.086 to 0.509 pu/pu between anchor
  and target, and the reference matrix moves with the PV/PQ state on top of that: the all-PV
  reference understates the response at the target by 4.3×, and the pinned reference overstates the
  response at the anchor by 4.3×. A single linear step from either end misses the band.
- **Mind the convention.** `senAlgo` reports `dV/dQinjection` (positive self terms); loads are
  `-Qinjection`, so `J = -M` and the step is `inv(J) @ (V_measured - Vtarget)`.
- **Start from a solvable anchor.** The stored case does not converge, so there is no operating
  point to linearise at; the script resets Q to the base values and flat-starts before the first
  pass. Without that, the first Jacobian would be measured around a diverged state.
- **The adjuster solves inside the script.** Each pass runs the AC load flow directly
  (`LoadflowAlgoObjectFactory` + the case `config/aclf_run.json`, the same path `AclfRunner` uses),
  ~4 solves per pass with the finite-difference probes. `interpss_run_gvy` does not forbid this and
  the model it leaves is a normally solved one, but the run is no longer a pure model edit — the
  reference matrix script is the one to reach for when a read-only probe is wanted.
- **The edit is not persisted.** The adjustment lives in the bridge-held model; `ieee14.ieee` on
  disk still carries j50.0 / j50.0, so the next load reverts it. Write the calibrated Q into the
  case file (or keep the script as the fixture) if it has to survive.
- **ACLF overwrites results** — as in Part 1: each run replaces that folder's `result/*_DF_*.csv`
  and `_network_info.txt`.

## Related

- `docs/groovy-script-adapter-architecture.md` — the `aclfnet` / `senAlgo` binding contract and
  sensitivity semantics
- `docs/interpss-tools.md` — the `interpss_run_gvy` / `interpss_run_aclf` tool contracts
- Part 1 scripts: `wspace/data/ieee/Ieee14BusLargeLoadQ/scripts/ieee14_dvdq_Bus14.gvy`,
  `ieee14_adjBus14Q_0p89to0p90.gvy`
- Part 2 scripts: `wspace/data/ieee/Ieee14BusLargeLoadQ2/scripts/ieee14_dvdq_matrix.gvy`,
  `ieee14_qv_adjust.gvy`
- Skills: `ipss-case-script`, `ipss-case-aclf`
