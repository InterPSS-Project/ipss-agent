# Load-Q Adjustment to Control Bus Voltage via dV/dQ Sensitivity

Raise (or lower) bus voltages by changing reactive load, using a `dV/dQ` sensitivity to size
the step and AC load flow to confirm it. The linearised (B″) sensitivity is a *first cut only*;
once the case is stressed, the value that governs the operating point must be measured from AC
solves.

This note states the method in general form, then illustrates it with the IEEE 14-bus system:
**Bus14** alone (single load), and **Bus13 + Bus14** together (coupled loads).


|                | **Single load**                                                        | **Multiple loads**                                                                      |
| -------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| When           | One bus is outside the voltage band; coupling to other targets is weak | Two or more buses must land in the same band and are strongly coupled                   |
| Sensitivity    | Scalar `dV/dQ` at the monitor bus                                      | N×N `dV/dQ` matrix among the adjusted buses                                             |
| Sizing         | B″ first cut, then AC secant steps; target = midpoint of the band      | Re-measure the matrix by finite differences each pass; damped Newton with a line search |
| IEEE14 example | Bus14 only → Q 50.0 → 46.0 MVAr, V = 0.895 pu                          | Bus13 + Bus14 → Q 50.0/50.0 → 45.5/21.3 MVAr, V = 0.899 / 0.891 pu                      |


---



## Method



### Convention

`SenAnalysisType.QVOLTAGE` returns the linearised `dV/dQ` from the B″ network. The Groovy
binding exposes it as:

```groovy
dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, injectBus, monitorBus)
```

Signature is `dV(monitorBus)/dQ(injectBus)`, in pu voltage per pu reactive **injection**. The
self term is positive (`dVdQ > 0`: injecting Q raises the bus voltage). A load is a *negative*
injection, so reaching a higher voltage means **reducing** load Q:

```text
dQinject = (targetV - V0) / dVdQ      [pu injection, positive]
Qload    = Qload0 - dQinject          [the load moves the other way]
```

For N buses, form the injection-convention matrix `M` from `senAlgo`, then the load-convention
Jacobian the adjuster steps on:

```text
M[f][t] = dV(bus_t) / dQinjection(bus_f)         (positive self terms)
J[r][c] = dV(bus_r) / dQload(bus_c) = -M[r][c]   (negative self terms)

Newton step:  dQload = inv(J) @ (V_measured - V_target)     [pu on system MVA base]
```

A step that *increases* load Q must *lower* voltage, so `J` is negative and the correction is
`inv(J) @ (V - Vtarget)`, not `inv(J) @ (Vtarget - V)`.

### Why B″ is not enough

B″ is a linearisation at V ≈ 1.0 pu and ignores reactive losses, so it understates the stiffness
of a depressed bus and drifts when bus types change (PV→PQ at Q limits). Use it to rank buses
and pick a starting step; size the final Q from AC finite differences or secants.

### Workflow (any case)

1. **Solve** the base case (or find a solvable anchor if the stored case does not converge).
2. **Measure** `dV/dQ` — B″ for a first cut; AC finite difference for the operating point.
3. **Size** the load-Q change for a voltage **band** (not a single point), using the midpoint for
  one bus, or a band-inset corner when maximising load under a multi-bus constraint.
4. **Apply** the edit through the contribute load (`bus.getContributeLoad(loadId).loadCP`), not
  the aggregate `bus.loadP` / `bus.loadQ`, on contribute gen/load models.
5. **Confirm** with a fresh ACLF (`reload: true` before each solve so control adjustments do not
  drift the held model away from a fresh-parse solution).
6. **Re-measure** before the next step when the operating point has moved or generators have
  hit Q limits — do not extrapolate a single linear value across a large voltage swing.



### Caveats (general)

- Always reparse (`reload: true`) per solve when comparing voltages across Q values.
- Treat B″ as a first cut; final size from AC secants or a re-measured Jacobian.
- A voltage target is a band, not a point — asking for exactly the edge often lands just outside.
- ACLF overwrites `result/*_DF_*.csv` and `_network_info.txt` in the case folder each run.
- Script edits live in the bridge-held model unless written back to the case file.
- Keep scenario scripts in version control (or a shared `wspace/script/` fixture directory).

---



## Example A — Single load: IEEE14 Bus14

Raise V(Bus14) into **[0.89, 0.90]** pu by reducing Bus14 load Q only.


|         |                                                                               |
| ------- | ----------------------------------------------------------------------------- |
| Case    | `wspace/data/ieee/Ieee14BusLargeLoadQ/ieee14.ieee`                            |
| Problem | Bus14 carries 14.9 MW + j50.0 MVAr; solved V = 0.871 pu (only bus below 0.90) |
| Result  | Q 50.0 → **46.0 MVAr**, **V(Bus14) = 0.895243 pu**                            |




### Scripts


| File                                                            | Role                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `…/Ieee14BusLargeLoadQ/scripts/ieee14_dvdq_Bus14.gvy`           | Read-only. `dV(Bus14)/dQ(Bus14)` and the B″-implied load-Q window |
| `…/Ieee14BusLargeLoadQ/scripts/ieee14_adjBus14Q_0p89to0p90.gvy` | Mutating. Sets Bus14 load to 14.9 MW + j46.0 MVAr                 |


Bare script names resolve to the case folder's `scripts/` directory under `interpss_run_gvy`.

### Measure (B″)

```groovy
dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, 'Bus14', 'Bus14')
```


| Quantity                                  | Value                               |
| ----------------------------------------- | ----------------------------------- |
| Base voltage V0                           | 0.871352 pu                         |
| Base load                                 | 14.9 MW + j50.0 MVAr                |
| `dV(Bus14)/dQ(Bus14)` (B″)                | **0.4437 pu/pu**                    |
| B″-implied load-Q window for [0.89, 0.90] | 43.54 … 45.80 MVAr (midpoint 44.67) |


AC finite difference near the base is ~0.638 pu/pu (~1.4× B″), falling to ~0.52 pu/pu as the
bus recovers toward 0.90. The B″ window is therefore too optimistic (AC window ≈ 45.1–46.9 MVAr).

### Size from AC secants

Each row uses a fresh reparse (`reload: true`) then ACLF; steps after the probe use
`(V2−V1)/(Q2−Q1)` rather than B″.


| Q (MVAr)  | V(Bus14) pu  | How                                     |
| --------- | ------------ | --------------------------------------- |
| 50.00     | 0.871352     | base                                    |
| 49.00     | 0.877732     | finite-difference probe                 |
| 45.51     | 0.897791     | secant — in window                      |
| 45.13     | 0.899754     | secant — top edge                       |
| 45.00     | 0.900423     | over-corrected                          |
| **46.00** | **0.895243** | **applied** — midpoint of the AC window |


```groovy
busId  = "Bus14";
loadId = "Bus14-L1";
loadP  = 0.149;   // 14.9 MW — untouched
loadQ  = 0.460;   // 46.0 MVAr

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
```



### Verify

Converged; lowest voltages: Bus14 **0.895243**, Bus13 0.979, Bus10 0.988. No bus below 0.89 pu.

### Reproduce

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14BusLargeLoadQ/ieee14.ieee' })
interpss_run_aclf({ case: '…' })
interpss_run_gvy({ case: '…', script: 'ieee14_dvdq_Bus14.gvy' })
interpss_run_gvy({ case: '…', script: 'ieee14_adjBus14Q_0p89to0p90.gvy', reload: true })
interpss_run_aclf({ case: '…' })
```

There is no CLI path for these scripts: `IpssCmd` has no `gvy` subcommand, and a CLI `aclf`
run is its own JVM — nothing stays loaded for the next command.

**Lesson from this example:** aiming at exactly 0.90 pu landed at 0.900423 (outside the band);
the working target is the midpoint of [0.89, 0.90].

---



## Example B — Multiple loads: IEEE14 Bus13 + Bus14

Bring **both** buses into **[0.89, 0.90]** pu by adjusting their load Q together. Single-bus
adjustments do not generalise here — near the target the cross terms are ~0.7–0.8 of the self
terms, so each bus's Q moves the other's voltage almost as much as its own.


|         |                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------- |
| Case    | `wspace/data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee`                                               |
| Problem | Bus13 and Bus14 both carry j50.0 MVAr — past the nose point; ACLF does not converge               |
| Result  | Q13 50.0 → **45.505**, Q14 50.0 → **21.320** MVAr; **V13 = 0.899**, **V14 = 0.891** pu (7 passes) |




### Scripts


| File                                                    | Role                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `…/Ieee14BusLargeLoadQ2/scripts/ieee14_dvdq_matrix.gvy` | Prints the 2×2 B″ reference matrix and, when solved, the finite-difference operating-point matrix; restores Q and voltages before returning |
| `…/Ieee14BusLargeLoadQ2/scripts/ieee14_qv_adjust.gvy`   | Walks Q13/Q14 from a solvable anchor to the largest load Q that keeps both buses inside the band                                            |




### Why the reference matrix alone fails

B″ moves with bus type and is far from the AC sensitivity on a stressed path:


| Network state                                                    | `dV/dQinjection` (pu/pu)            |
| ---------------------------------------------------------------- | ----------------------------------- |
| Fresh parse — generators regulating as PV                        | `[ 0.1172 0.0608 ; 0.0608 0.2558 ]` |
| After limit-controlled solves — generators at Q limits (`GenPQ`) | `[ 0.3731 0.2723 ; 0.2723 0.4437 ]` |


AC `|dV(Bus13)/dQload(Bus13)|` grows from 0.086 pu/pu at the anchor (V13 ≈ 1.05) to 0.509 at
the target (V13 ≈ 0.90). The adjuster therefore re-measures `J` at the current point every pass
and keeps B″ only as a fallback when a probe will not solve.

### Measure the operating-point matrix

Perturb one load Q at a time, solve, divide voltage response by the perturbation, then restore
Q **and** saved bus voltages and re-solve before the next column:

```groovy
EPS = 0.01d                       // pu, 1 MVAr
BUSES.eachWithIndex { id, c ->
    def qSave = BUSES.collect { qOf(it) }
    def vSave = snapV()
    setQ(id, qSave[c] + EPS)      // +EPS of *load* Q
    if (solveLf()) {
        def vp = BUSES.collect { vOf(it) }
        BUSES.eachWithIndex { bid, r -> J[r][c] = (vp[r] - v0[r]) / EPS }
    } else {
        J[0][c] = -M[0][c]; J[1][c] = -M[1][c]
    }
    BUSES.eachWithIndex { bid, i -> setQ(bid, qSave[i]) }
    restoreV(vSave); solveLf()
}
```


| V13 / V14 (pu)      | J self terms        | J cross term |
| ------------------- | ------------------- | ------------ |
| 1.0504 / 1.0355     | -0.086 / -0.209     | -0.047       |
| 0.9450 / 0.9368     | -0.424 / -0.487     | -0.330       |
| **0.8990 / 0.8910** | **-0.509 / -0.575** | **-0.408**   |




### Adjuster loop

Start from a solvable anchor (base IEEE-14 Q13 = 5.8, Q14 = 5.0 MVAr, flat start) because the
stored case has no solution. Each pass: measure V, measure J, take a damped Newton step with a
predicted-move cap and a line search that halves until `max|V − target|` improves.


| Pass | Q13, Q14 (MVAr)    | V13, V14 (pu)        |
| ---- | ------------------ | -------------------- |
| 1    | 26.514, 9.458      | 1.00847, 1.00084     |
| 4    | 38.794, 17.493     | 0.94500, 0.93684     |
| 7    | **45.505, 21.320** | **0.89900, 0.89100** |


The target is the band corner inset by 1e-3 pu (V13 → 0.899, V14 → 0.891) — the largest load Q
that keeps both buses *strictly* inside [0.89, 0.90]. Unlike Example A, this is not the midpoint:
the point of the exercise is maximising reactive load under the band.

### Verify

Converged; Bus14 **0.891**, Bus13 **0.899** remain the lowest buses and sit inside the window.
All four generators are pinned at reactive limits (`GenPQ`) — both buses are held by the network
alone, which is why the reference matrix and the AC Jacobian diverge so far.

### Reproduce

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee' })
interpss_run_gvy({ script: 'ieee14_dvdq_matrix.gvy', reload: true })
interpss_run_gvy({ script: 'ieee14_qv_adjust.gvy', reload: true })
interpss_run_aclf()
interpss_run_gvy({ script: 'ieee14_dvdq_matrix.gvy' })
```

**Lessons from this example:** solve the pair together; re-measure every pass; start from a
solvable anchor; mind the injection vs load convention (`J = −M`).

---



## Related

- `docs/user_guide/Loadflow-adjustment-user-guide.md` — practical how-to for DSH Chat
- `docs/groovy-script-adapter-architecture.md` — `aclfnet` / `senAlgo` binding and sensitivity semantics
- `docs/interpss-tools.md` — `interpss_run_gvy` / `interpss_run_aclf` contracts
- Example A: `Ieee14BusLargeLoadQ/scripts/ieee14_dvdq_Bus14.gvy`, `ieee14_adjBus14Q_0p89to0p90.gvy`
- Example B: `Ieee14BusLargeLoadQ2/scripts/ieee14_dvdq_matrix.gvy`, `ieee14_qv_adjust.gvy`
- Skills: `ipss-case-script`, `ipss-case-aclf`

