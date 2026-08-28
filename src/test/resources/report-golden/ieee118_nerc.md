# NERC TPL-001-5 Transmission System Planning Performance
## Compliance Assessment Report

**IEEE 118-bus**

---

| Field | Value |
| --- | --- |
| **System** | IEEE 118-bus |
| **Base MVA** | 100 MVA |
| **Report Date** | 2020-01-01 20:00:00 |
| **Input** | `data/ieee/Ieee118Bus/result` |
| **P0 Status** | **NON-COMPLIANT** |

## AclfNetwork Summary

| Parameter | Value |
| --- | --- |
| Number of Active Buses | 118 |
| Number of Active Branches | 186 |
| Total Generation (MW) | 3800.48 |
| Total Load (MW) | 3668.00 |
| PV bus limit controls | 53 |
| Loadflow Converged | true |
| Max Mismatch | dPmax :  0.0000 at Bus : Bus30,     dQmax :  0.00001 at Bus : Bus30 |

## NERC TPL-001-5 Performance Criteria Overview

The NERC TPL-001-5 standard defines seven planning event categories with corresponding steady-state performance requirements.

| Category | Initial Condition | Contingency | Element Loss | Voltage | Thermal | Stability |
| --- | --- | --- | --- | --- | --- | --- |
| **P0** | All in Svc | None | None | 0.95–1.05 pu | ≤100% Rate A | Stable |
| **P1** | All in Svc | 1 gen, trans, line, shunt | N-1 | 0.90–1.05 pu | ≤100% Rate A | Stable |
| **P2** | All in Svc | 1 bus section, breaker | N-1 | 0.90–1.05 pu | ≤100% Rate A | Stable |
| **P3** | All in Svc | Common ROW | N-2 | 0.90–1.05 pu | ≤100% Rate B | Stable |
| **P4** | All in Svc | Breaker failure (bus-tie) | N-2 | 0.90–1.05 pu | ≤100% Rate B | Stable |
| **P5** | All in Svc | Relay failure (delayed fault) | N-2 | 0.90–1.05 pu | ≤100% Rate B | Stable |
| **P6** | All in Svc | N-1-1 (manual adj. between) | N-1 + N-1 | 0.90–1.05 pu | ≤100% Rate B | May shed load |
| **P7** | All in Svc | Common ROW + delayed fault | N-2+ | Evaluate risk | Evaluate risk | May interrupt svc |

## Executive Summary

### P0 (Base Case) Assessment: **FAIL** — NON-COMPLIANT (voltage violations)

| Metric | Value |
| --- | --- |
| Total Buses | 118 (64 PQ, 53 PV, 1 Swing) |
| Total Branches | 186 (0 with MVA ratings) |
| Total Generators | 53 |
| Total Load | 36.68 pu P / 14.38 pu Q |
| Total Generation | 38.00 pu P / 7.99 pu Q |
| System Losses | 1.32 pu P / -6.39 pu Q |
| Swing Bus | Bus69 (Sporn     V2) at 1.0350 pu |
| Swing Output | 5.13 pu P / -0.82 pu Q |

### Compliance Summary

| Assessment Area | Result | Status |
| --- | --- | --- |
| **Voltage Profile** | 2 buses < 0.95 pu (1.7%); 44 marginal (37.3%) | **FAIL** |
| **Thermal Loading** | Branch MVA ratings not populated (186 branches) | INCONCLUSIVE |
| **Generator Q-Limits** | 5 at limit (9.4%), 0 violations (0.0%) | **PASS** |
| **P0 OVERALL** | voltage violations | **INCONCLUSIVE** |

> **Note:** Summary P/Q values are reported in per-unit on a 100 MVA base unless otherwise noted.

## Section 1: P0 — Normal System (Base Case)

**Category P0** requires all transmission elements in service with no contingencies.
Steady-state performance criteria:

- Bus voltages must remain within **0.95–1.05 pu**
- Branch thermal loading must not exceed **100% of Rate A**
- System must remain **stable**

### 1.1 Steady-State Voltage Profile

#### Voltage Extremes

| Metric | Value | Location |
| --- | --- | --- |
| Minimum Voltage | **0.9430 pu** | Bus76 (Darrah    V2) |
| Maximum Voltage | **1.0500 pu** | Bus10 (Breed     V1) |

#### Voltage Band Distribution

| Voltage Range | Description | Buses | % of In-Service |
| --- | --- | --- | --- |
| 0.90–0.95 pu | Low Violation (NON-COMPLIANT) | 2 | 1.7% |
| 0.95–0.98 pu | Marginal Low (OK) | 44 | 37.3% |
| 0.98–1.02 pu | Nominal | 63 | 53.4% |
| 1.02–1.05 pu | High Acceptable (OK) | 9 | 7.6% |

#### Voltage Violations (Below 0.95 pu) — 2 Buses

| Bus | Name | Voltage (pu) |
| --- | --- | --- |
| Bus53 | Wooster   V2 | **0.9460** |
| Bus76 | Darrah    V2 | **0.9430** |

#### Marginal Low Voltage (0.95–0.98 pu) — 44 Buses

These buses are within the P0 **0.95–1.05 pu** band but below **0.98 pu**. Per-bus listing is omitted for large cases.

| Metric | Value |
| --- | --- |
| Buses in band | 44 |
| Minimum V | 0.9494 pu |
| Median V | 0.9669 pu |
| Mean V | 0.9650 pu |
| Maximum V | 0.9798 pu |

**Lowest 10 buses by voltage (sample):**

| Bus | Name | V (pu) |
| --- | --- | --- |
| Bus118 | WHuntngd  V2 | 0.9494 |
| Bus55 | Wagenhls  V2 | 0.9520 |
| Bus107 | Reusens   V2 | 0.9520 |
| Bus56 | Sunnysde  V2 | 0.9540 |
| Bus1 | Riversde  V2 | 0.9550 |
| Bus54 | Torrey    V2 | 0.9550 |
| Bus52 | SCoshoct  V2 | 0.9568 |
| Bus20 | Adams     V2 | 0.9578 |
| Bus74 | Bellefnt  V2 | 0.9580 |
| Bus21 | Jay       V2 | 0.9584 |

**P0 Voltage Result:** **FAIL**

> **Action Required:** Review voltage profile, consider capacitor bank additions,
> OLTC tap adjustments, or generator voltage setpoint changes at affected buses.

### 1.2 Branch Thermal Loading Assessment

**P0 Thermal Result: INCONCLUSIVE**

> **Critical Data Gap:** Branch MVA ratings (`LimMvaA`) are not populated in the
> input data. All **186 branches** show a **0.0 MVA rating** in the dataset.
> Thermal loading assessment requires valid branch MVA ratings.
### 1.3 Generator Reactive Power Assessment

**P0 Generator Q-Limit Result:** **PASS**

#### Generators at Q-Limit — 5 Units

| Bus | Name | Q (pu) | Qmax (pu) | Qmin (pu) | At Limit |
| --- | --- | --- | --- | --- | --- |
| Bus19 | Lincoln   V2 | -0.0800 | 0.2400 | -0.0800 | **Qmin** |
| Bus34 | Rockhill  V2 | -0.0683 | 0.2400 | -0.0800 | **Qmin** |
| Bus74 | Bellefnt  V2 | -0.0563 | 0.0900 | -0.0600 | **Qmin** |
| Bus103 | Claytor   V2 | 0.4000 | 0.4000 | -0.1500 | **Qmax** |
| Bus105 | Roanoke   V2 | -0.0800 | 0.2300 | -0.0800 | **Qmin** |

> **Note:** Generators at Q-limit have been switched from PV to PQ mode during the
> load flow solution, reducing voltage regulation capability in these areas.

## Section 2: Contingency Analysis (P1–P7)

### 2.1 Critical Elements for N-1 Contingency Analysis

#### Top 10 Most Heavily Loaded Circuits (Potential P1/P3/P5)

| Rank | Branch | Flow (MVA) | From | To |
| --- | --- | --- | --- | --- |
| 1 | Bus8->Bus9(1) | 449.7 | Olive     V1 | Bequine   V1 |
| 2 | Bus9->Bus10(1) | 445.9 | Bequine   V1 | Breed     V1 |
| 3 | Bus8->Bus5(1) | 360.7 | Olive     V1 | Olive     V2 |
| 4 | Bus38->Bus37(1) | 268.2 | EastLima  V1 | EastLima  V2 |
| 5 | Bus30->Bus17(1) | 249.2 | Sorenson  V1 | Sorenson  V2 |
| 6 | Bus26->Bus30(1) | 224.0 | TannrsCk  V1 | Sorenson  V1 |
| 7 | Bus89->Bus92(1) | 202.0 | ClinchRv  V2 | Saltvlle  V2 |
| 8 | Bus68->Bus116(1) | 195.7 | Sporn     V1 | KygerCrk  V2 |
| 9 | Bus64->Bus65(1) | 194.5 | Kammer    V1 | Muskngum  V1 |
| 10 | Bus38->Bus65(1) | 190.2 | EastLima  V1 | Muskngum  V1 |

#### Top 10 Largest Generators (Potential P1 Events)

| Rank | Bus | Name | P Output (MW) |
| --- | --- | --- | --- |
| 1 | Bus89 | ClinchRv  V2 | 607.0 |
| 2 | Bus69 | Sporn     V2 | 513.5 |
| 3 | Bus80 | CabinCrk  V2 | 477.0 |
| 4 | Bus10 | Breed     V1 | 450.0 |
| 5 | Bus66 | Muskngum  V2 | 392.0 |
| 6 | Bus65 | Muskngum  V1 | 391.0 |
| 7 | Bus26 | TannrsCk  V1 | 314.0 |
| 8 | Bus100 | Glen Lyn  V2 | 252.0 |
| 9 | Bus25 | TannrsCk  V2 | 220.0 |
| 10 | Bus49 | Philo     V2 | 204.0 |

### 2.2 Parallel Circuits (P3/P5 Common-Mode Events)

**7 parallel bus-pairs** (identical from–to with multiple circuit IDs) are candidates for P3 (common-mode) and P5 (delayed fault) contingency assessment. Full per-pair listing is omitted for large models.

| Metric | Value |
| --- | --- |
| Parallel bus-pairs | 7 |
| Pairs with 2 parallel circuits | 7 |
| Maximum circuits on one corridor | 2 |

**Sample bus-pairs (10 lowest bus numbers, stable ordering):**

| Bus Pair | Circuits | Parallel Circuits |
| --- | --- | --- |
| Bus42 ↔ Bus49 | 2 | Bus42->Bus49(1), Bus42->Bus49(2) |
| Bus49 ↔ Bus54 | 2 | Bus49->Bus54(1), Bus49->Bus54(2) |
| Bus49 ↔ Bus66 | 2 | Bus49->Bus66(1), Bus49->Bus66(2) |
| Bus56 ↔ Bus59 | 2 | Bus56->Bus59(1), Bus56->Bus59(2) |
| Bus77 ↔ Bus80 | 2 | Bus77->Bus80(1), Bus77->Bus80(2) |
| Bus89 ↔ Bus90 | 2 | Bus89->Bus90(1), Bus89->Bus90(2) |
| Bus89 ↔ Bus92 | 2 | Bus89->Bus92(1), Bus89->Bus92(2) |

> **Note:** These parallel circuits, if physically located on common tower
> structures, constitute P3 events (N-2 loss on common ROW).

### 2.3 N-1 Contingency Analysis Results

> **Note:** No contingency analysis data (`_DF_contingency.csv`) found for this case.
> Run contingency analysis using:
>
> ```bash
> python ../src/ipss_cmd.py ca <format> <input>
> ```

## Section 3: Assessment and Recommendations

### 3.1 P0 Base Case Assessment

| Criterion | Result | Status |
| --- | --- | --- |
| Voltage Compliance | 2 buses below 0.95 pu | **FAIL** |
| Thermal Compliance | Ratings not available | INCONCLUSIVE |
| Generator Q-Limits | 5 at limit, 0 violations | **PASS** |
| **P0 OVERALL** | voltage violations | **INCONCLUSIVE** |

#### Voltage Issues

- **2 buses** violate the 0.95 pu minimum
- **44 buses** (37% of in-service buses) operate in the marginal range (0.95–0.98 pu)

**Recommendations:**
- Add capacitor banks at affected low-voltage buses
- Review OLTC tap settings on transformers in voltage-depressed corridors
- Consider adjusting generator voltage setpoints on nearby PV buses

#### Generator Q-Limit Findings

- **4 at Qmin**, **1 at Qmax** with no remaining reactive power margin
- Generators at limit reduce voltage regulation capability during contingencies
- Generators at Qmax indicate constrained reactive power supply
- Generators at Qmin may indicate over-excitation or absorption limits
- PV→PQ switching occurred for these buses during solution

#### Branch Rating Issue

- **CRITICAL:** All 186 branch MVA ratings (`LimMvaA`) are **missing** from the input data
- Thermal overload compliance cannot be evaluated without valid ratings
- **Action Required:** Populate `LimMvaA`, `LimMvaB`, and `LimMvaC` for every branch

### 3.2 P1–P6 Contingency Analysis Assessment

No contingency analysis data available. The following analysis is required:

1. **Run N-1 contingency analysis** on the top 10 most heavily loaded circuits
2. **Test N-1 loss** of the 10 largest generators
3. **Evaluate P3 common-mode events** for all 7 parallel circuit pairs
4. **Assess transformer outages** for voltage support impact
5. **Run N-1-1 analysis** for sequential contingencies
6. **Populate branch MVA ratings** and re-run thermal compliance assessment

#### Remaining NERC TPL-001-5 Analysis Work

**P2 (Bus section/breaker):** Not evaluated — requires bus-breaker model data.
**P3/P5 (Common ROW/Delayed fault):** Not evaluated — 7 parallel circuit pair(s) identified as candidates.
**P4 (Breaker failure):** Not evaluated — requires breaker failure analysis tools.
**P6 (N-1-1):** Not evaluated — requires sequential contingency analysis.
**P7 (Extreme events):** Not evaluated — requires extreme event scenario definition.

### 3.3 Data Quality Assessment

| Data Field | Status | Notes |
| --- | --- | --- |
| Branch MVA Ratings (`LimMvaA`) | **MISSING** | All 186 branches show 0.0. Required for thermal compliance. |
| Branch MVA Ratings (`LimMvaB`) | MISSING | Emergency (Rate B) ratings not populated. |
| Branch MVA Ratings (`LimMvaC`) | MISSING | Rate C ratings not populated. |
| Bus Voltage Setpoints | PRESENT | 118 of 118 generator buses have VSched. |
| Generator Q Limits | PRESENT | QMax/QMin defined for 53 buses. |
| Transformer Tap Data | PRESENT | Ratio and tap data included in model. |
| Load Data | PRESENT | 91 loads defined with P and Q values. |
| Branch Composition |  | 177 lines, 9 transformers (4.8% xfmrs) |
| Contingency Data | MISSING | Run `python ../src/ipss_cmd.py ca` to generate contingency analysis. |

---

## Report Metadata

| Field | Value |
| --- | --- |
| Generated By | `org.interpss.agent.report.NercTplReportGenerator` |
| Case | IEEE 118-bus |
| Source Data | `data/ieee/Ieee118Bus/result/ieee118_DF_*.csv` |
| Input File | `data/ieee/Ieee118Bus/result` |
| NERC Standard | TPL-001-5 (Transmission System Planning Performance) |

---

> **End of NERC TPL-001-5 Compliance Assessment Report**