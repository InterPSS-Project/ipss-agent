# NERC TPL-001-5 Transmission System Planning Performance
## Compliance Assessment Report

**IEEE 14-Bus System**

---

| Field | Value |
| --- | --- |
| **System** | IEEE 14-Bus System |
| **Base MVA** | 100 MVA |
| **Report Date** | 2020-01-01 20:00:00 |
| **Input** | `data/ieee/Ieee14Bus/result` |
| **P0 Status** | **NON-COMPLIANT** |

## AclfNetwork Summary

| Parameter | Value |
| --- | --- |
| Number of Active Buses | 14 |
| Number of Active Branches | 20 |
| Total Generation (MW) | 272.39 |
| Total Load (MW) | 259.00 |
| PV bus limit controls | 4 |
| Loadflow Converged | true |
| Max Mismatch | dPmax :  0.00001 at Bus : Bus5,     dQmax :  0.00006 at Bus : Bus4 |

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
| Total Buses | 14 (9 PQ, 4 PV, 1 Swing) |
| Total Branches | 20 (0 with MVA ratings) |
| Total Generators | 3 |
| Total Load | 2.59 pu P / 0.74 pu Q |
| Total Generation | 2.72 pu P / 0.82 pu Q |
| System Losses | 0.13 pu P / 0.09 pu Q |
| Swing Bus | Bus1 (Bus 1     HV) at 1.0600 pu |
| Swing Output | 2.32 pu P / -0.17 pu Q |

### Compliance Summary

| Assessment Area | Result | Status |
| --- | --- | --- |
| **Voltage Profile** | 7 buses > 1.05 pu (50.0%); 0 marginal (0.0%) | **FAIL** |
| **Thermal Loading** | Branch MVA ratings not populated (20 branches) | INCONCLUSIVE |
| **Generator Q-Limits** | 0 at limit (0.0%), 0 violations (0.0%) | **PASS** |
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
| Minimum Voltage | **1.0100 pu** | Bus3 (Bus 3     HV) |
| Maximum Voltage | **1.0900 pu** | Bus8 (Bus 8     TV) |

#### Voltage Band Distribution

| Voltage Range | Description | Buses | % of In-Service |
| --- | --- | --- | --- |
| 0.95–0.98 pu | Marginal Low (OK) | 0 | 0.0% |
| 0.98–1.02 pu | Nominal | 3 | 21.4% |
| 1.02–1.05 pu | High Acceptable (OK) | 4 | 28.6% |
| > 1.05 pu | High Violation (NON-COMPLIANT) | 7 | 50.0% |

#### Voltage Violations (Above 1.05 pu) — 7 Buses

| Bus | Name | Voltage (pu) |
| --- | --- | --- |
| Bus1 | Bus 1     HV | 1.0600 |
| Bus6 | Bus 6     LV | 1.0700 |
| Bus7 | Bus 7     ZV | 1.0615 |
| Bus8 | Bus 8     TV | 1.0900 |
| Bus9 | Bus 9     LV | 1.0559 |
| Bus11 | Bus 11    LV | 1.0569 |
| Bus12 | Bus 12    LV | 1.0552 |

**P0 Voltage Result:** **FAIL**

> **Action Required:** Review voltage profile, consider capacitor bank additions,
> OLTC tap adjustments, or generator voltage setpoint changes at affected buses.

### 1.2 Branch Thermal Loading Assessment

**P0 Thermal Result: INCONCLUSIVE**

> **Critical Data Gap:** Branch MVA ratings (`LimMvaA`) are not populated in the
> input data. All **20 branches** show a **0.0 MVA rating** in the dataset.
> Thermal loading assessment requires valid branch MVA ratings.
### 1.3 Generator Reactive Power Assessment

**P0 Generator Q-Limit Result:** **PASS**

## Section 2: Contingency Analysis (P1–P7)

### 2.1 Critical Elements for N-1 Contingency Analysis

#### Top 10 Most Heavily Loaded Circuits (Potential P1/P3/P5)

| Rank | Branch | Flow (MVA) | From | To |
| --- | --- | --- | --- | --- |
| 1 | Bus1->Bus2(1) | 158.2 | Bus 1     HV | Bus 2     HV |
| 2 | Bus1->Bus5(1) | 75.6 | Bus 1     HV | Bus 5     HV |
| 3 | Bus2->Bus3(1) | 73.3 | Bus 2     HV | Bus 3     HV |
| 4 | Bus4->Bus5(1) | 63.2 | Bus 4     HV | Bus 5     HV |
| 5 | Bus2->Bus4(1) | 56.2 | Bus 2     HV | Bus 4     HV |
| 6 | Bus5->Bus6(1) | 45.8 | Bus 5     HV | Bus 6     LV |
| 7 | Bus2->Bus5(1) | 41.5 | Bus 2     HV | Bus 5     HV |
| 8 | Bus4->Bus7(1) | 29.7 | Bus 4     HV | Bus 7     ZV |
| 9 | Bus7->Bus9(1) | 28.7 | Bus 7     ZV | Bus 9     LV |
| 10 | Bus3->Bus4(1) | 23.7 | Bus 3     HV | Bus 4     HV |

#### Top 10 Largest Generators (Potential P1 Events)

| Rank | Bus | Name | P Output (MW) |
| --- | --- | --- | --- |
| 1 | Bus1 | Bus 1     HV | 232.4 |
| 2 | Bus2 | Bus 2     HV | 40.0 |

### 2.2 Parallel Circuits (P3/P5 Common-Mode Events)

No parallel circuits identified.

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
| Voltage Compliance | 0 buses below 0.95 pu | **FAIL** |
| Thermal Compliance | Ratings not available | INCONCLUSIVE |
| Generator Q-Limits | 0 at limit, 0 violations | **PASS** |
| **P0 OVERALL** | voltage violations | **INCONCLUSIVE** |

#### Voltage Issues

- **7 buses** exceed the 1.05 pu maximum
- **0 buses** (0% of in-service buses) operate in the marginal range (0.95–0.98 pu)

**Recommendations:**
- Add capacitor banks at affected low-voltage buses
- Review OLTC tap settings on transformers in voltage-depressed corridors
- Consider adjusting generator voltage setpoints on nearby PV buses

#### Branch Rating Issue

- **CRITICAL:** All 20 branch MVA ratings (`LimMvaA`) are **missing** from the input data
- Thermal overload compliance cannot be evaluated without valid ratings
- **Action Required:** Populate `LimMvaA`, `LimMvaB`, and `LimMvaC` for every branch

### 3.2 P1–P6 Contingency Analysis Assessment

No contingency analysis data available. The following analysis is required:

1. **Run N-1 contingency analysis** on the top 10 most heavily loaded circuits
2. **Test N-1 loss** of the 10 largest generators
3. **Evaluate P3 common-mode events** for all 0 parallel circuit pairs
4. **Assess transformer outages** for voltage support impact
5. **Run N-1-1 analysis** for sequential contingencies
6. **Populate branch MVA ratings** and re-run thermal compliance assessment

#### Remaining NERC TPL-001-5 Analysis Work

**P2 (Bus section/breaker):** Not evaluated — requires bus-breaker model data.
**P3/P5 (Common ROW/Delayed fault):** No parallel circuit pairs identified.
**P4 (Breaker failure):** Not evaluated — requires breaker failure analysis tools.
**P6 (N-1-1):** Not evaluated — requires sequential contingency analysis.
**P7 (Extreme events):** Not evaluated — requires extreme event scenario definition.

### 3.3 Data Quality Assessment

| Data Field | Status | Notes |
| --- | --- | --- |
| Branch MVA Ratings (`LimMvaA`) | **MISSING** | All 20 branches show 0.0. Required for thermal compliance. |
| Branch MVA Ratings (`LimMvaB`) | MISSING | Emergency (Rate B) ratings not populated. |
| Branch MVA Ratings (`LimMvaC`) | MISSING | Rate C ratings not populated. |
| Bus Voltage Setpoints | PRESENT | 14 of 14 generator buses have VSched. |
| Generator Q Limits | PRESENT | QMax/QMin defined for 4 buses. |
| Transformer Tap Data | PRESENT | Ratio and tap data included in model. |
| Load Data | PRESENT | 11 loads defined with P and Q values. |
| Branch Composition |  | 15 lines, 5 transformers (25.0% xfmrs) |
| Contingency Data | MISSING | Run `python ../src/ipss_cmd.py ca` to generate contingency analysis. |

---

## Report Metadata

| Field | Value |
| --- | --- |
| Generated By | `org.interpss.agent.report.NercTplReportGenerator` |
| Case | IEEE 14-Bus System |
| Source Data | `data/ieee/Ieee14Bus/result/ieee14_DF_*.csv` |
| Input File | `data/ieee/Ieee14Bus/result` |
| NERC Standard | TPL-001-5 (Transmission System Planning Performance) |

---

> **End of NERC TPL-001-5 Compliance Assessment Report**