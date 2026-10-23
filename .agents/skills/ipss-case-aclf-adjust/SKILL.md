---
name: ipss-case-aclf-adjust
description: Use when asked to adjust bus load Q (reactive load) to bring a bus voltage magnitude into a target band for the current InterPSS simulation case — measuring dV/dQ sensitivity, sizing the change from it, applying it with a Groovy script, and confirming with AC load flow.
metadata:
  short-description: Adjust load Q to hit a voltage band
---

# InterPSS Load-Q Voltage Adjustment

Bring a bus voltage into a target band (for example **[0.90, 0.91]** pu) by changing reactive load,
sized from a `dV/dQ` sensitivity and confirmed with a real AC load flow. The linearised (B″)
sensitivity is a **first cut only** — on a stressed case the value that governs the operating
point must come from AC solves.

Worked reference: [docs/load-q-adjustment.md](../../../docs/load-q-adjustment.md) — Example A
(single bus) and Example B (two coupled buses).

## When to use

- "Bus N is below 0.90 pu — reduce its load Q to fix it."
- "Adjust load Q to raise/lower bus voltage to a band."
- Re-running a documented load-Q adjustment after the case file or folder moved.

Not for: switching shunts, transformer taps, or generator voltage setpoints — those are different
controls. Single-bus coupling assumed; for two strongly coupled buses use the matrix form below.

## Convention (get this right first)

`SenAnalysisType.QVOLTAGE` returns the **linearised** `dV/dQ` from the B″ network, and the Groovy
binding exposes `senAlgo` over the live case:

```groovy
dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, injectBusId, monitorBusId)
```

Signature is `dV(monitorBus)/dQ(injectBus)`, in pu voltage per pu reactive **injection**. The self
term is positive, so a load — a *negative* injection — moves the opposite way:

```text
dQinject = (targetV - V0) / dVdQ      [pu injection, positive]
Qload    = Qload0 - dQinject          [the load moves the other way]
```

`dQ/dV` is `1/dVdQ`. Mixing the injection and load signs is the most common error: it inverts the
step.

## Workflow

### Step 1 — solve the base case

```
interpss_case_load({ case: '<case>' })
interpss_run_aclf({ case: '<case>' })
```

The sensitivity script prints the held model's operating-point voltage, so the case must be solved
first for a meaningful window. If the stored case does not converge, anchor it first (see Example B).

### Step 2 — measure dV/dQ and the implied window

Write this read-only script to the case folder's `scripts/` (an existing copy may be there already),
then run it:

```
interpss_run_gvy({ case: '<case>', script: 'ieee14_dvdq_Bus14_0p90to0p91.gvy' })
```

```groovy
busId = "Bus14"; loadId = "Bus14-L1";
vLow = 0.90; vHigh = 0.91;                       // target band, pu

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
v0 = bus.voltageMag; q0 = load.loadCP.imaginary; // pu on the 100 MVA base

dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, busId, busId)
qForHigh = q0 - (vHigh - v0) / dVdQ;   // load Q at the 0.91 edge (smaller Q)
qForLow  = q0 - (vLow  - v0) / dVdQ;   // load Q at the 0.90 edge (larger Q)
println "dV/dQ=" + dVdQ + "  first-cut Q window " + (qForLow*100) + " .. " + (qForHigh*100) + " MVAr"
```

Measured on the IEEE14 large-Q case (shipped **[0.90, 0.91]** band):

| Quantity | Value |
| --- | --- |
| Base | 14.9 MW + j50.0 MVAr, V = 0.871352 pu |
| `dV(Bus14)/dQ(Bus14)` (B″) | **0.4437 pu/pu** |
| B″-implied window for [0.90, 0.91] | 41.3 … 43.5 MVAr (midpoint ≈ 42.4) |

### Step 3 — re-measure on AC before committing

B″ ignores reactive losses and understates a depressed bus: the AC finite difference here is
**0.638 pu/pu** near the base (from solves at Q = 50.0 and 49.0 MVAr) falling to ~0.52 pu/pu near
0.90 pu. Perturb one load Q at a time, solve, and divide the voltage response by the perturbation:

```text
AC dV/dQ ≈ (V(Q+eps) − V(Q)) / eps        eps ≈ 1 MVAr, then restore Q
```

Each probe needs a **fresh reparse** (`reload: true`) before the solve, or the held model drifts
(see caveats). On this case the AC window for **[0.90, 0.91]** is ≈ **43.1 … 45.1 MVAr** —
materially different from the B″ window.

### Step 4 — apply the edit

Write the mutating script next to the read-only one and run it with `reload: true`:

```
interpss_run_gvy({ case: '<case>', script: 'ieee14_adjBus14Q_0p90to0p91.gvy', reload: true })
```

```groovy
busId = "Bus14"; loadId = "Bus14-L1";
loadP = 0.149;   // 14.9 MW — untouched
loadQ = 0.441;   // 44.1 MVAr — midpoint of the AC window

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
```

On a **contribute** gen/load model (IEEE14 and PSS/E cases are), edit
`bus.getContributeLoad(id).loadCP`; assigning the aggregate `bus.loadP` / `bus.loadQ` does not move
the case totals.

### Step 5 — confirm with AC load flow

```
interpss_run_aclf({ case: '<case>' })
```

Read `result/<stem>_DF_bus.csv` (`VoltMag` column) and check the band. Verify:

- the target bus is **inside** the band,
- no bus dropped **below** the lower edge,
- the case converged.

Verified outcome for the reference case: Q 50.0 → **44.1 MVAr**, **V(Bus14) ≈ 0.905 pu**, no bus
below 0.90 (next lowest Bus13 ≈ 0.985).

## Sizing table (worked example, [0.90, 0.91])

| Q (MVAr) | V(Bus14) pu | How |
| --- | --- | --- |
| 50.00 | 0.871352 | base |
| 45.00 | 0.900423 | AC probe — 0.90 edge just below |
| 43.20 | 0.909548 | AC probe — 0.91 edge just above |
| **44.10** | **0.905016** | **applied** — AC-window midpoint |

Aim at the **band midpoint**, not an edge: requesting exactly a band edge overshoots.

## Two coupled buses

When two buses must land in the same band and their cross terms are comparable to the self terms,
a scalar `dV/dQ` does not generalise. Build the injection matrix `M[f][t] = dV(bus_t)/dQinj(bus_f)`,
convert to the load convention `J = −M`, re-measure it by finite differences **each pass**, and take
a damped Newton step with a line search:

```text
dQload = inv(J) @ (V_measured − V_target)     [pu on system MVA base]
```

Example B′ (Bus13 + Bus14, shipped **[0.90, 0.91]**) reached Q13 ≈ 47.33, Q14 ≈ 17.51 MVAr →
V13 ≈ V14 ≈ 0.905 pu in 8 passes (`ieee14_qv_adjust_0p90to0p91.gvy` /
`ieee14_adjBus1314Q_0p90to0p91.gvy`). See
[docs/load-q-adjustment.md](../../../docs/load-q-adjustment.md).

## Caveats

- **Reparse per solve.** Run every script with `reload: true` before comparing voltages across Q
  values. An ACLF mutates the held model through control adjustments (PV/PQ limit switching,
  discrete/tap control, voltage adjustment), so a held-model solve drifts from the fresh-parse
  solution — ~0.0014 pu in the reference case.
- **Re-measure when the point moves.** Do not extrapolate one linear `dV/dQ` across a large voltage
  swing, and re-measure after generators hit Q limits (bus type changes, and with it B″ itself).
- **A target is a band.** Size for the midpoint (or a band-inset corner when maximising load).
- **ACLF overwrites results.** Each run replaces `result/*_DF_*.csv` and `_network_info.txt`; any
  report or dashboard derived from the previous CSVs is stale.
- **Scripts are not durable.** Case-folder `scripts/` folders get rebuilt/moved; keep scenario
  scripts in version control or in the shared `wspace/script/` fixture directory.
- **No CLI path.** `IpssCmd` has no `gvy` subcommand, so the scripts only run through the DSH
  bridge; a CLI `aclf` run re-parses the case and loses the edit.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Script reports no change though one was expected | The edit was already applied (assign absolute values) or the case was reparsed; use `reload: true` and absolute `loadCP` values |
| Edit had no effect on case totals | Contribute model — edit `getContributeLoad(id).loadCP`, not `bus.loadP` |
| Voltage landed outside the band | Re-measure the AC `dV/dQ` at the current point and take another secant step; do not reuse the B″ value |
| `script not found: … (no .gvy files there)` | The case folder in the path does not exist (renamed/moved) or `scripts/` is empty — check `wspace/data/…` and recreate the scripts there |
| Sensitivity script prints a base voltage of ~1.0 pu | The held case is not solved — run `interpss_run_aclf` first |
| `dV/dQ` sign implies the wrong direction | Injection vs load convention — `Qload = Qload0 − (targetV − V0)/dVdQ` |
| Non-convergent ACLF after a large step | The step was too big or the case is past the nose point; back off, or anchor on a solvable case first, and check the mismatch bus |

## Related

- [docs/load-q-adjustment.md](../../../docs/load-q-adjustment.md) — method, both worked examples
- `$ipss-case-script` — `.gvy` file vs inline source, `reload: true`, array form
- `$ipss-case-aclf` — solve the edited case and write the result files
- `$ipss-case-load` — load/switch the case (and the reload + apply form)
- [docs/groovy-script-adapter-architecture.md](../../../docs/groovy-script-adapter-architecture.md) — `aclfnet` / `senAlgo` binding
