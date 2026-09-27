# Loadflow Adjustment User Guide

Loadflow adjustment, such as raise (or lower) bus voltages by changing reactive load (**load Q**), using a `dV/dQ`
sensitivity to size the step and AC load flow to confirm it.

This guide is the practical how-to for InterPSS DSH Chat. For the engineering detail
behind the method (B″ vs AC sensitivity, Jacobian convention, Newton loop), see
[load-q-adjustment.md](../load-q-adjustment.md).

---

## When to use this


| Situation                                                                  | Approach                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| One bus is outside a voltage band; other targets are weakly coupled        | Adjust **one** load Q (scalar `dV/dQ`)             |
| Two or more buses must land in the same band and move each other’s voltage | Adjust the loads **together** (N×N `dV/dQ` matrix) |


Typical goal: bring a depressed bus into a band such as **[0.89, 0.90]** pu by reducing
load Q (active power left unchanged).

---



## Prerequisites

- InterPSS DSH Plugin with Chat tools available — see [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md)
- A loaded simulation case (IEEE CDF or PSS/E RAW) under `wspace/data/**`
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


| You say                           | Typical tools / skills                             |
| --------------------------------- | -------------------------------------------------- |
| Load the large-load-Q IEEE14 case | `$ipss-case-load` / `interpss_case_load`           |
| Run ACLF                          | `$ipss-case-aclf` / `interpss_run_aclf`            |
| Run the dV/dQ script              | `$ipss-case-script` / `interpss_run_gvy`           |
| Summarize lowest voltages         | `$ipss-case-summary` / `interpss_summarize_result` |


Bare script names resolve to the case folder’s `scripts/` directory.

---



## Example A — Single bus: IEEE14 Bus14

**Goal:** raise V(Bus14) into **[0.89, 0.90]** pu by reducing Bus14 load Q only.


|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| Case           | `wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee`               |
| Starting point | Bus14 = 14.9 MW + j50.0 MVAr, V ≈ 0.871 pu (only bus below 0.90) |
| Applied result | Q 50.0 → **46.0 MVAr**, V(Bus14) = **0.895** pu                  |




### Scripts


| Script                            | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `ieee14_dvdq_Bus14.gvy`           | Read-only. Prints `dV(Bus14)/dQ(Bus14)` and the B″-implied load-Q window |
| `ieee14_adjBus14Q_0p89to0p90.gvy` | Sets Bus14 load to 14.9 MW + j46.0 MVAr                                  |




### Steps in Chat

```text
Load wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee
Run ACLF
Run ieee14_dvdq_Bus14.gvy
Reload and run ieee14_adjBus14Q_0p89to0p90.gvy, then run ACLF
Show the lowest bus voltages
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14Bus_LargeLoadQ/ieee14.ieee' })
interpss_run_aclf()
interpss_run_gvy({ script: 'ieee14_dvdq_Bus14.gvy' })
interpss_run_gvy({ script: 'ieee14_adjBus14Q_0p89to0p90.gvy', reload: true })
interpss_run_aclf()
```



### What to expect

- B″ may suggest a more aggressive Q cut than AC reality (on this case, B″ window ≈ 43.5–45.8 MVAr;
AC window ≈ 45.1–46.9 MVAr). Prefer the AC-sized value (**46.0** MVAr midpoint).
- After ACLF, Bus14 should sit near **0.895** pu inside the band; no bus below 0.89 pu.



### Apply your own Q (template)

```groovy
busId  = "Bus14";
loadId = "Bus14-L1";
loadP  = 0.149;   // MW in pu on system base — leave unchanged
loadQ  = 0.460;   // MVAr in pu — the adjusted value

bus  = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
```

Save under the case `scripts/` folder and run with `$ipss-case-script`, then ACLF.

---



## Example B — Coupled buses: IEEE14 Bus13 + Bus14

**Goal:** bring **both** Bus13 and Bus14 into **[0.89, 0.90]** pu by adjusting both load Q
values together.


|                |                                                                                      |
| -------------- | ------------------------------------------------------------------------------------ |
| Case           | `wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee`                                  |
| Starting point | Both buses at j50.0 MVAr — past the nose point; ACLF does **not** converge as stored |
| Applied result | Q13 → **45.505**, Q14 → **21.320** MVAr; V13 = **0.899**, V14 = **0.891** pu         |


Do **not** adjust one bus at a time here: near the target, cross terms are ~70–80% of the
self terms, so each Q move strongly affects the other voltage.

### Scripts


| Script                              | What it does                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `ieee14_dvdq_matrix.gvy`            | Read-only. Prints the 2×2 B″ matrix and, when solved, the AC finite-difference matrix      |
| `ieee14_qv_adjust.gvy`              | Starts from a solvable anchor and walks both Q values into the band (damped Newton)        |
| `ieee14_adjBus1314Q_0p89to0p90.gvy` | Sets Bus13 to 13.5 MW + j45.5053 MVAr and Bus14 to 14.9 MW + j21.3202 MVAr (one shot)      |


As in Example A, the adjuster **derives** the two Q values and the setter **applies** them; once the
values are known, the setter alone reproduces the state.




### Steps in Chat

```text
Load wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee
Reload and run ieee14_qv_adjust.gvy to derive Q13 / Q14
Reload and run ieee14_adjBus1314Q_0p89to0p90.gvy to apply them
Run ACLF
Run ieee14_dvdq_matrix.gvy again to see the operating-point matrix at the target
```

Equivalent tool sequence:

```text
interpss_case_load({ case: 'wspace/data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee' })
interpss_run_gvy({ script: 'ieee14_qv_adjust.gvy', reload: true })                 # derives Q13/Q14 (~7 passes)
interpss_run_gvy({ script: 'ieee14_adjBus1314Q_0p89to0p90.gvy', reload: true })    # applies those values
interpss_run_aclf()
interpss_run_gvy({ script: 'ieee14_dvdq_matrix.gvy' })                            # operating-point matrix at the target
```

`reload: true` on the adjuster re-parses the stored j50/j50 case; the script then resets to a
solvable anchor and iterates (~7 passes on this fixture). No ACLF is needed before it — the stored
case does not converge. The setter also runs with `reload: true`, so it starts from the file rather
than from whatever state the held model is in (see **Common pitfalls**).

### What to expect

- The stored case may fail ACLF until the adjuster has run — that is intentional.
- Final voltages: Bus14 ≈ **0.891**, Bus13 ≈ **0.899** (band corner inset by 0.001 pu so both
stay strictly inside [0.89, 0.90] while maximising load Q).
- Generators may be at Q limits (`GenPQ`); that is why B″ alone is a poor guide on this case.

### Apply your own Q (template)

```groovy
// pu Q on the system base; MW left as stored (13.5 / 14.9 MW)
def LOAD_Q = ['Bus13': 0.455053d, 'Bus14': 0.213202d]

LOAD_Q.each { id, q ->
    def load = aclfnet.getBus(id).getContributeLoad(id + '-L1')
    load.loadCP = new Complex(load.loadCP.real, q)
}
```

Save under the case `scripts/` folder and run with `$ipss-case-script` (add `reload: true`), then ACLF.

---



## Checklist for your own case

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



## Common pitfalls


| Symptom                                          | Likely cause                       | What to do                                              |
| ------------------------------------------------ | ---------------------------------- | ------------------------------------------------------- |
| Voltage moves the wrong way after raising load Q | Injection/load convention mixed up | Reduce load Q to raise V; use `J = −M` for Newton       |
| B″ window looks good but ACLF misses the band    | Stressed bus / Q-limited gens      | Size from AC secants or re-measure `J` each pass        |
| Numbers drift between identical Q values         | Held-model control adjustments     | Use `reload: true` before each comparative solve        |
| Same Q values now give a lower voltage           | A diverged ACLF left the generators switched to `GenPQ` at constant Q | Re-parse (`reload: true`) before applying — a load-only script cannot restore PV |
| Aggregate `bus.loadQ` change has no effect       | Contribute gen/load model          | Edit `getContributeLoad(loadId).loadCP`                 |
| Next load restores old Q                         | Edit never written to disk         | Update the case file or re-run the adjuster script      |
| Result CSVs look “old” after another ACLF        | Each ACLF overwrites `result/`     | Re-read CSVs / regenerate reports after the final solve |


---



## Related

- [load-q-adjustment.md](../load-q-adjustment.md) — method, conventions, and full IEEE14 walkthroughs
- [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md) — InterPSS tab, Chat tools, what-if scripts
- [batch_chat_user_guide.md](batch_chat_user_guide.md) — batch `/ipss-sim` style runs
- Skills: `$ipss-case-load`, `$ipss-case-aclf`, `$ipss-case-script`, `$ipss-case-summary`
- Example A scripts: `wspace/data/ieee/Ieee14Bus_LargeLoadQ/scripts/`
- Example B scripts: `wspace/data/ieee/Ieee14Bus_LargeLoadQ2/scripts/`

