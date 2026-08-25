#!/usr/bin/env python3
"""
NERC TPL-001-5 Compliance Assessment Report Generator

Reads CSV output from InterPSS ACLF/CA (``python ../src/ipss_cmd.py`` from ``wspace/``) and produces a TPL-001-5
steady-state compliance report in Markdown format.

NERC TPL-001-5 Transmission System Planning Performance Requirements:
  P0: Normal system (no contingencies)
  P1: Single element loss - N-1 (generator, line, transformer, shunt)
  P2: Single element loss - N-1 (bus section, breaker)
  P3: Multiple element loss - N-2 on common ROW structure
  P4: Multiple element loss - N-2 (breaker failure)
  P5: Multiple element loss - N-2 (relay failure)
  P6: N-1-1 (manual adjustment between events)
  P7: Extreme events (consequential load loss acceptable)

Usage (from ``wspace/`` with venv activated):
  python ../src/report/generate_nerc_tpl_report.py <case_display_name> <result_dir>
  python ../src/report/generate_nerc_tpl_report.py 'IEEE 118-Bus Test Case' data/ieee/Ieee118Bus/result
  python ../src/report/generate_nerc_tpl_report.py 'Texas 2000-Bus System' data/psse/Texas2K/result
  # Legacy: subfolder under wspace/result/ still works, e.g. ieee_ieee118
"""

import sys
from collections import Counter
from datetime import datetime
from math import sqrt
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from report.ipss_report_common import (
    BASE_KVA,
    CFG,
    RESULT_DIR,
    WSPACE,
    _bus_in_service,
    _md_table_row,
    _md_table_sep,
    _status_badge,
    analyze_branch_loading,
    analyze_generator_q_limits,
    analyze_voltage_profile,
    load_csv,
    load_csv_optional,
    parse_network_info,
    resolve_case_base,
)

KNOWN_CASE_ALIASES = {
    "ieee": "ieee118",
    "texas": "texas2k",
}


def _discover_cases():
    """Discover available cases dynamically from result directory."""
    discovered = {}
    if not RESULT_DIR.exists():
        return discovered

    for case_path in sorted(p for p in RESULT_DIR.iterdir() if p.is_dir()):
        bus_files = list(case_path.glob("*_DF_bus.csv"))
        if not bus_files:
            continue

        for bus_file in bus_files:
            prefix = bus_file.name.removesuffix("_DF_bus.csv")
            branch_file = case_path / f"{prefix}_DF_branch.csv"
            gen_file = case_path / f"{prefix}_DF_gen.csv"
            load_file = case_path / f"{prefix}_DF_load.csv"
            if not (branch_file.exists() and gen_file.exists() and load_file.exists()):
                continue

            cfg = {
                "dir": case_path.name,
                "prefix": prefix,
                "name": prefix,
                "source": f"`result/{case_path.name}` (auto-discovered)",
            }
            discovered[case_path.name] = cfg
            discovered[case_path.name.lower()] = cfg
            discovered[prefix] = cfg
            discovered[prefix.lower()] = cfg

            lower_dir = case_path.name.lower()
            for needle, alias in KNOWN_CASE_ALIASES.items():
                if needle in lower_dir:
                    discovered[alias] = cfg
    return discovered


def _load_cases():
    """Load discovered cases from result directory."""
    return _discover_cases()


CASES = _load_cases()


def _get_case(case_name):
    """Resolve case config by name."""
    if case_name in CASES:
        return CASES[case_name]
    lowered = case_name.lower()
    if lowered in CASES:
        return CASES[lowered]
    available = ", ".join(sorted(CASES.keys()))
    raise ValueError(f"Unknown case '{case_name}'. Available: {available}")


def _default_case_name():
    """Choose a default case from discovered cases."""
    # Prefer common alias if available; otherwise first stable discovered key.
    for preferred in ("ieee118", "texas2k"):
        if preferred in CASES:
            return preferred
    if CASES:
        # Filter duplicate keys that point to the same config by using directory names.
        unique_dirs = sorted({cfg["dir"] for cfg in CASES.values()})
        if unique_dirs:
            return unique_dirs[0]
    raise ValueError(
        f"No result cases discovered under '{RESULT_DIR}'. "
        "Run `python ../src/ipss_cmd.py` first to generate CSV outputs."
    )


def analyze_contingency_candidates(branches, gens, cfg=None):
    """Identify critical elements for N-1 contingency analysis."""
    if cfg is None:
        cfg = CFG
    min_gen_output = cfg["generator"]["min_gen_output_mw"]

    critical_branches = []
    for br in branches:
        p = float(br['PFrom2To'])
        q = float(br['QFrom2To'])
        s = sqrt(p**2 + q**2)
        br_name = br['Name'].strip() if br['Name'].strip() else br['ID'].strip()
        critical_branches.append((s, br_name, br['FromBusName'], br['ToBusName']))
    critical_branches.sort(reverse=True)

    critical_gens = []
    for gen in gens:
        pg = float(gen['PGen'])
        bus = gen['BusNumber']
        name = gen['BusName'].strip()
        if abs(pg) > min_gen_output:
            critical_gens.append((abs(pg), bus, name, pg))
    critical_gens.sort(reverse=True)

    max_elements = cfg["display"]["max_critical_elements"]
    return {
        'top_branches': critical_branches[:max_elements],
        'top_gens': critical_gens[:max_elements],
    }


def identify_parallel_circuits(branches):
    """Identify parallel circuits that would be P3/P5 category events."""
    from collections import defaultdict
    pairs = defaultdict(list)
    for br in branches:
        from_id = br['FromBusNumber']
        to_id = br['ToBusNumber']
        key = tuple(sorted([from_id, to_id]))
        br_name = br['Name'].strip() if br['Name'].strip() else br['ID'].strip()
        pairs[key].append(br_name)

    parallel = {k: v for k, v in pairs.items() if len(v) > 1}
    return parallel


def analyze_contingency_results(contingency_data, cfg=None):
    """Analyze post-contingency thermal compliance from contingency CSV.

    The contingency CSV has columns:
      BranchID, BranchName, BranchCode, IsXfmr,
      ContingencyName, OutageBranchId, OutageBranchName,
      BasecaseFlowMW, PostFlowMW, LineRatingMW, LoadingPercent
    """
    if not contingency_data:
        return None

    if cfg is None:
        cfg = CFG
    th = cfg["thermal"]
    overload_pct = th["overload_pct"]
    severe_pct = th["severe_pct"]

    overloads = []
    severe_overloads = []
    seen = set()

    for row in contingency_data:
        loading = float(row['LoadingPercent'])
        branch_id = row['BranchID']
        contingency_name = row['ContingencyName']
        outage_branch = row.get('OutageBranchName', '') or row.get('OutageBranchId', '')
        base_flow = float(row['BasecaseFlowMW'])
        post_flow = float(row['PostFlowMW'])
        rating = float(row['LineRatingMW'])

        key = (branch_id, contingency_name)
        if key in seen:
            continue
        seen.add(key)

        if loading > overload_pct:
            entry = {
                'branch': branch_id,
                'contingency': contingency_name,
                'outage': outage_branch,
                'base_flow': base_flow,
                'post_flow': post_flow,
                'rating': rating,
                'loading_pct': loading,
            }
            if loading > severe_pct:
                severe_overloads.append(entry)
            else:
                overloads.append(entry)

    overloads.sort(key=lambda x: x['loading_pct'], reverse=True)
    severe_overloads.sort(key=lambda x: x['loading_pct'], reverse=True)

    total_contingencies = len(set(r['ContingencyName'] for r in contingency_data))
    total_monitored = len(contingency_data)

    return {
        'overloads': overloads,
        'severe_overloads': severe_overloads,
        'total_overloads': len(overloads) + len(severe_overloads),
        'total_contingencies': total_contingencies,
        'total_monitored': total_monitored,
        'p1_thermal_pass': len(overloads) + len(severe_overloads) == 0,
        'worst': (overloads + severe_overloads)[:10] if overloads or severe_overloads else [],
    }


# --- Report Generation ---

def generate_report(case_name, result_dir=None):
    """Generate the NERC TPL-001-5 compliance report in Markdown format.

    Args:
        case_name: Human-readable case name for the report header (from CLI).
        result_dir: Directory with CSV outputs: path relative to `wspace/` (e.g. `data/ieee/Ieee118Bus/result`),
            or a subdirectory name under `wspace/result/` (legacy). If omitted, uses discovery under
            `wspace/result/` only.

    Returns:
        (markdown_report, case_base) where case_base is the resolved directory containing the CSVs.
    """
    if result_dir:
        case_base = resolve_case_base(result_dir)
        bus_files = list(case_base.glob("*_DF_bus.csv"))
        prefix = bus_files[0].name.removesuffix("_DF_bus.csv")
        display_name = case_name
        source_desc = f"`{case_base.relative_to(WSPACE)}`"
    else:
        case = _get_case(case_name)
        case_base = RESULT_DIR / case["dir"]
        prefix = case["prefix"]
        display_name = case["name"]
        source_desc = case["source"]

    # Load data
    buses = load_csv(f'{prefix}_DF_bus.csv', case_base)
    branches = load_csv(f'{prefix}_DF_branch.csv', case_base)
    gens = load_csv(f'{prefix}_DF_gen.csv', case_base)
    loads = load_csv(f'{prefix}_DF_load.csv', case_base)

    # Load contingency data if available
    contingency_raw = load_csv_optional(f'{prefix}_DF_contingency.csv', case_base)

    # Load network info if available
    network_info_data = parse_network_info(case_base, prefix)

    # Run analyses
    voltage = analyze_voltage_profile(buses)
    branch_load = analyze_branch_loading(branches)
    gen_q = analyze_generator_q_limits(gens)
    contingency = analyze_contingency_candidates(branches, gens)
    parallel = identify_parallel_circuits(branches)
    contingency_results = analyze_contingency_results(contingency_raw)

    # System statistics
    total_gen_p = sum(float(g['PGen']) for g in gens)
    total_gen_q = sum(float(g['QGen']) for g in gens)
    total_load_p = sum(float(l['PLoadTotal']) for l in loads)
    total_load_q = sum(float(l['QLoadTotal']) for l in loads)
    losses_p = total_gen_p - total_load_p
    losses_q = total_gen_q - total_load_q

    pv_buses = [b for b in buses if b['BusType'] == 'PV']
    pq_buses = [b for b in buses if b['BusType'] == 'PQ']
    swing_buses = [b for b in buses if b['BusType'] == 'Swing']

    # Swing bus info (dynamic, not hardcoded)
    swing_bus_num = swing_buses[0]['Number'] if swing_buses else None
    swing_bus_name = swing_buses[0]['Name'].strip() if swing_buses else "Unknown"
    swing_vsched = next((float(g['VSched']) for g in gens if g['BusNumber'] == swing_bus_num), 0) if swing_bus_num else 0
    swing_p = next((float(g['PGen']) for g in gens if g['BusNumber'] == swing_bus_num), 0) if swing_bus_num else 0
    swing_q = next((float(g['QGen']) for g in gens if g['BusNumber'] == swing_bus_num), 0) if swing_bus_num else 0

    report = []
    w = report.append

    # ===================================================================
    # Title and Header
    # ===================================================================
    w("# NERC TPL-001-5 Transmission System Planning Performance")
    w("## Compliance Assessment Report")
    w("")
    w(f"**{display_name}**")
    w("")
    w("---")
    w("")
    w(_md_table_row("Field", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row("**System**", display_name))
    w(_md_table_row("**Base MVA**", f"{BASE_KVA/1000:.0f} MVA"))
    w(_md_table_row("**Report Date**", datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    w(_md_table_row("**Input**", source_desc))

    # Determine P0 overall pass/fail
    # Priority: voltage violations → NON-COMPLIANT regardless of thermal
    #           thermal violations → NON-COMPLIANT
    #           thermal missing (voltage OK) → INCONCLUSIVE
    #           Q violations → NON-COMPLIANT
    #           all pass → COMPLIANT
    p0_voltage_ok = voltage['passed']
    p0_thermal_ok = branch_load['has_ratings'] and len(branch_load['overloaded']) == 0
    p0_thermal_inconclusive = not branch_load['has_ratings']
    q_pass = len(gen_q['violations']) == 0

    if not p0_voltage_ok:
        p0_status = "**NON-COMPLIANT**"
        p0_description = "voltage violations"
    elif p0_thermal_inconclusive:
        p0_status = "INCONCLUSIVE"
        p0_description = "Thermal ratings missing"
    elif not p0_thermal_ok:
        p0_status = "**NON-COMPLIANT**"
        p0_description = "thermal overloads"
    elif not q_pass:
        p0_status = "**NON-COMPLIANT**"
        p0_description = "generator Q-limit violations"
    else:
        p0_status = "COMPLIANT"
        p0_description = "All P0 criteria met"

    p0_overall_pass = (p0_voltage_ok and p0_thermal_ok and q_pass and not p0_thermal_inconclusive)

    w(_md_table_row("**P0 Status**", p0_status))
    w("")

    # ===================================================================
    # AclfNetwork Summary
    # ===================================================================
    if network_info_data:
        w("## AclfNetwork Summary")
        w("")
        aclf = network_info_data["aclf_network"]
        lf = network_info_data["loadflow_run"]
        w(_md_table_row("Parameter", "Value"))
        w(_md_table_sep(2))
        for key, value in aclf.items():
            w(_md_table_row(key, value))
        if lf:
            w(_md_table_row("Loadflow Converged", lf.get("Loadflow converged", "N/A")))
            w(_md_table_row("Max Mismatch", lf.get("Max mismatch", "N/A")))
        w("")

    # ===================================================================
    # NERC TPL-001-5 Performance Criteria Overview
    # ===================================================================
    w("## NERC TPL-001-5 Performance Criteria Overview")
    w("")
    w("The NERC TPL-001-5 standard defines seven planning event categories with corresponding steady-state performance requirements.")
    w("")
    p0_v_str = f"{CFG['voltage']['p0']['v_min']:.2f}–{CFG['voltage']['p0']['v_max']:.2f} pu"
    p1_v_str = f"{CFG['voltage']['p1_p7']['v_min']:.2f}–{CFG['voltage']['p1_p7']['v_max']:.2f} pu"
    w(_md_table_row("Category", "Initial Condition", "Contingency", "Element Loss", "Voltage", "Thermal", "Stability"))
    w(_md_table_sep(7))
    w(_md_table_row("**P0**", "All in Svc", "None", "None", p0_v_str, "≤100% Rate A", "Stable"))
    w(_md_table_row("**P1**", "All in Svc", "1 gen, trans, line, shunt", "N-1", p1_v_str, "≤100% Rate A", "Stable"))
    w(_md_table_row("**P2**", "All in Svc", "1 bus section, breaker", "N-1", p1_v_str, "≤100% Rate A", "Stable"))
    w(_md_table_row("**P3**", "All in Svc", "Common ROW", "N-2", p1_v_str, "≤100% Rate B", "Stable"))
    w(_md_table_row("**P4**", "All in Svc", "Breaker failure (bus-tie)", "N-2", p1_v_str, "≤100% Rate B", "Stable"))
    w(_md_table_row("**P5**", "All in Svc", "Relay failure (delayed fault)", "N-2", p1_v_str, "≤100% Rate B", "Stable"))
    w(_md_table_row("**P6**", "All in Svc", "N-1-1 (manual adj. between)", "N-1 + N-1", p1_v_str, "≤100% Rate B", "May shed load"))
    w(_md_table_row("**P7**", "All in Svc", "Common ROW + delayed fault", "N-2+", "Evaluate risk", "Evaluate risk", "May interrupt svc"))
    w("")

    # ===================================================================
    # Executive Summary
    # ===================================================================
    w("## Executive Summary")
    w("")

    if p0_overall_pass:
        w("### P0 (Base Case) Assessment: **PASS** — COMPLIANT")
    elif not p0_voltage_ok or not p0_thermal_ok or not q_pass:
        w(f"### P0 (Base Case) Assessment: **FAIL** — NON-COMPLIANT ({p0_description})")
    elif p0_thermal_inconclusive:
        w("### P0 (Base Case) Assessment: INCONCLUSIVE")
    else:
        w(f"### P0 (Base Case) Assessment: **FAIL** — NON-COMPLIANT ({p0_description})")
    w("")
    w(_md_table_row("Metric", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row("Total Buses", f"{len(buses)} ({len(pq_buses)} PQ, {len(pv_buses)} PV, {len(swing_buses)} Swing)"))
    w(_md_table_row("Total Branches", f"{len(branches)} ({branch_load['branches_with_ratings']} with MVA ratings)"))
    w(_md_table_row("Total Generators", gen_q['total_gens']))
    w(_md_table_row("Total Load", f"{total_load_p:.2f} pu P / {total_load_q:.2f} pu Q"))
    w(_md_table_row("Total Generation", f"{total_gen_p:.2f} pu P / {total_gen_q:.2f} pu Q"))
    w(_md_table_row("System Losses", f"{losses_p:.2f} pu P / {losses_q:.2f} pu Q"))
    if swing_bus_num:
        w(_md_table_row("Swing Bus", f"Bus{swing_bus_num} ({swing_bus_name}) at {swing_vsched:.4f} pu"))
        w(_md_table_row("Swing Output", f"{swing_p:.2f} pu P / {swing_q:.2f} pu Q"))
    w("")

    w("### Compliance Summary")
    w("")
    w(_md_table_row("Assessment Area", "Result", "Status"))
    w(_md_table_sep(3))
    v_status = _status_badge(voltage['passed'])
    n_active = voltage.get("buses_analyzed", 0)

    if not branch_load['has_ratings']:
        t_result = f"Branch MVA ratings not populated ({branch_load['total_branches']} branches)"
        t_status = "INCONCLUSIVE"
    else:
        overloads_p0 = branch_load['overloaded']
        t_result = f"{len(overloads_p0)} overloaded circuits" if overloads_p0 else "No overloads"
        t_status = _status_badge(len(overloads_p0) == 0)

    # Voltage result with percentages
    v_low_count = len(voltage['violations_low'])
    v_high_count = len(voltage['violations_high'])
    v_marg_count = len(voltage['low_voltage_warn'])
    v_low_pct = (v_low_count / n_active * 100) if n_active > 0 else 0
    v_high_pct = (v_high_count / n_active * 100) if n_active > 0 else 0
    v_marg_pct = (v_marg_count / n_active * 100) if n_active > 0 else 0

    v_parts = []
    if v_low_count > 0:
        v_parts.append(f"{v_low_count} buses < {CFG['voltage']['p0']['v_min']:.2f} pu ({v_low_pct:.1f}%)")
    if v_high_count > 0:
        v_parts.append(f"{v_high_count} buses > {CFG['voltage']['p0']['v_max']:.2f} pu ({v_high_pct:.1f}%)")
    v_parts.append(f"{v_marg_count} marginal ({v_marg_pct:.1f}%)")
    v_result = "; ".join(v_parts)
    if not v_parts:
        v_result = "All buses within limits"

    w(_md_table_row("**Voltage Profile**", v_result, v_status))
    w(_md_table_row("**Thermal Loading**", t_result, t_status))

    # Generator Q-Limits with percentage
    q_at_limit = len(gen_q['at_limit'])
    q_violations = len(gen_q['violations'])
    n_gens = gen_q['total_gens']
    q_limit_pct = (q_at_limit / n_gens * 100) if n_gens > 0 else 0
    q_viol_pct = (q_violations / n_gens * 100) if n_gens > 0 else 0
    w(_md_table_row("**Generator Q-Limits**",
                    f"{q_at_limit} at limit ({q_limit_pct:.1f}%), {q_violations} violations ({q_viol_pct:.1f}%)",
                    _status_badge(q_pass)))

    if contingency_results:
        p1_th_status = _status_badge(contingency_results['p1_thermal_pass'])
        w(_md_table_row("**P1 Contingency Thermal**", f"{contingency_results['total_overloads']} post-contingency overloads from {contingency_results['total_contingencies']} N-1 contingencies", p1_th_status))

    if p0_overall_pass:
        w(_md_table_row("**P0 OVERALL**", "All criteria met", "**COMPLIANT**"))
    elif p0_thermal_inconclusive:
        w(_md_table_row("**P0 OVERALL**", p0_description, "**INCONCLUSIVE**"))
    else:
        w(_md_table_row("**P0 OVERALL**", p0_description, "**NON-COMPLIANT**"))
    w("")

    base_mva_val = BASE_KVA / 1000
    w(f"> **Note:** Summary P/Q values are reported in per-unit on a {base_mva_val:.0f} MVA base unless otherwise noted.")
    w("")

    # ===================================================================
    # Section 1: P0 - Normal System (Base Case)
    # ===================================================================
    w("## Section 1: P0 — Normal System (Base Case)")
    w("")
    w("**Category P0** requires all transmission elements in service with no contingencies.")
    w("Steady-state performance criteria:")
    w("")
    w(f"- Bus voltages must remain within **{CFG['voltage']['p0']['v_min']:.2f}–{CFG['voltage']['p0']['v_max']:.2f} pu**")
    w("- Branch thermal loading must not exceed **100% of Rate A**")
    w("- System must remain **stable**")
    w("")

    # 1.1 Voltage Profile
    w("### 1.1 Steady-State Voltage Profile")
    w("")
    w("#### Voltage Extremes")
    w("")
    w(_md_table_row("Metric", "Value", "Location"))
    w(_md_table_sep(3))
    w(_md_table_row("Minimum Voltage", f"**{voltage['v_min']:.4f} pu**", voltage['v_min_bus']))
    w(_md_table_row("Maximum Voltage", f"**{voltage['v_max']:.4f} pu**", voltage['v_max_bus']))
    w("")

    # Voltage band distribution
    bands = voltage.get("bands", {})
    if bands:
        n_active = voltage.get("buses_analyzed", 0)
        w("#### Voltage Band Distribution")
        w("")
        w(_md_table_row("Voltage Range", "Description", "Buses", "% of In-Service"))
        w(_md_table_sep(4))

        band_descriptions = {
            "severe_low": f"< {CFG['voltage']['bands'].get('severe_low', 0.90):.2f} pu",
            "violation_low": f"{CFG['voltage']['bands'].get('severe_low', 0.90):.2f}–{CFG['voltage']['bands'].get('violation_low', 0.95):.2f} pu",
            "marginal": f"{CFG['voltage']['bands'].get('violation_low', 0.95):.2f}–{CFG['voltage']['bands'].get('marginal_low', 0.98):.2f} pu",
            "nominal": f"{CFG['voltage']['bands'].get('marginal_low', 0.98):.2f}–{CFG['voltage']['bands'].get('marginal_high', 1.02):.2f} pu",
            "high_ok": f"{CFG['voltage']['bands'].get('marginal_high', 1.02):.2f}–{CFG['voltage']['bands'].get('violation_high', 1.05):.2f} pu",
            "violation_high": f"> {CFG['voltage']['bands'].get('violation_high', 1.05):.2f} pu",
        }
        band_labels = {
            "severe_low": "Severe Low (NON-COMPLIANT)",
            "violation_low": "Low Violation (NON-COMPLIANT)",
            "marginal": "Marginal Low (OK)",
            "nominal": "Nominal",
            "high_ok": "High Acceptable (OK)",
            "violation_high": "High Violation (NON-COMPLIANT)",
        }
        for band_key in ["severe_low", "violation_low", "marginal", "nominal", "high_ok", "violation_high"]:
            count = len(bands.get(band_key, []))
            pct = (count / n_active * 100) if n_active > 0 else 0
            if count > 0 or band_key in ("marginal", "nominal"):
                w(_md_table_row(
                    band_descriptions.get(band_key, ""),
                    band_labels.get(band_key, band_key),
                    str(count),
                    f"{pct:.1f}%"
                ))
        w("")

    if voltage.get("inactive_excluded", 0):
        nx = voltage["inactive_excluded"]
        w(
            f"> **Note:** P0 voltage statistics use **in-service buses only** (`InService` in the bus CSV). "
            f"**{nx}** out-of-service buses were excluded (they often show **0.0 pu** and are outside the solved network)."
        )
        w("")

    if voltage['violations_low']:
        w(f"#### Voltage Violations (Below {CFG['voltage']['p0']['v_min']:.2f} pu) — {len(voltage['violations_low'])} Buses")
        w("")
        w(_md_table_row("Bus", "Name", "Voltage (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in voltage['violations_low']:
            w(_md_table_row(f"Bus{bid}", name, f"**{v:.4f}**"))
        w("")

    if voltage['violations_high']:
        w(f"#### Voltage Violations (Above {CFG['voltage']['p0']['v_max']:.2f} pu) — {len(voltage['violations_high'])} Buses")
        w("")
        w(_md_table_row("Bus", "Name", "Voltage (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in voltage['violations_high']:
            w(_md_table_row(f"Bus{bid}", name, f"{v:.4f}"))
        w("")

    if voltage['low_voltage_warn']:
        warn = voltage['low_voltage_warn']
        n_warn = len(warn)
        v_lo = CFG['voltage']['p0']['v_min']
        v_ml = CFG['voltage']['p0']['v_marginal_low']
        w(f"#### Marginal Low Voltage ({v_lo:.2f}–{v_ml:.2f} pu) — {n_warn} Buses")
        w("")
        vals = sorted(v for _, _, v in warn)
        v_min_m = vals[0]
        v_max_m = vals[-1]
        v_mean = sum(vals) / n_warn
        mid = n_warn // 2
        if n_warn % 2:
            v_med = vals[mid]
        else:
            v_med = (vals[mid - 1] + vals[mid]) / 2
        w(
            f"These buses are within the P0 **{v_lo:.2f}–{CFG['voltage']['p0']['v_max']:.2f} pu** band but below **{v_ml:.2f} pu**. "
            "Per-bus listing is omitted for large cases."
        )
        w("")
        w(_md_table_row("Metric", "Value"))
        w(_md_table_sep(2))
        w(_md_table_row("Buses in band", str(n_warn)))
        w(_md_table_row("Minimum V", f"{v_min_m:.4f} pu"))
        w(_md_table_row("Median V", f"{v_med:.4f} pu"))
        w(_md_table_row("Mean V", f"{v_mean:.4f} pu"))
        w(_md_table_row("Maximum V", f"{v_max_m:.4f} pu"))
        w("")
        n_sample = CFG['display']['marginal_sample_count']
        w(f"**Lowest {n_sample} buses by voltage (sample):**")
        w("")
        w(_md_table_row("Bus", "Name", "V (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in sorted(warn, key=lambda x: x[2])[:n_sample]:
            w(_md_table_row(f"Bus{bid}", name, f"{v:.4f}"))
        w("")

    w(f"**P0 Voltage Result:** {_status_badge(voltage['passed'])}")
    if not voltage['passed']:
        w("")
        w("> **Action Required:** Review voltage profile, consider capacitor bank additions,")
        w("> OLTC tap adjustments, or generator voltage setpoint changes at affected buses.")
    w("")

    # 1.2 Branch Thermal Loading
    w("### 1.2 Branch Thermal Loading Assessment")
    w("")

    ratings_unavailable = not branch_load['has_ratings']

    if ratings_unavailable:
        w("**P0 Thermal Result: INCONCLUSIVE**")
        w("")
        w("> **Critical Data Gap:** Branch MVA ratings (`LimMvaA`) are not populated in the")
        w(f"> input data. All **{branch_load['total_branches']} branches** show a **0.0 MVA rating** in the dataset.")
        w("> Thermal loading assessment requires valid branch MVA ratings.")
    else:
        w(f"Branches with MVA ratings: {branch_load['branches_with_ratings']}/{branch_load['total_branches']}")
        w("")

        overloads_p0 = branch_load['overloaded']
        if overloads_p0:
            w(f"#### P0 Overloaded Circuits (>{CFG['thermal']['overload_pct']:.0f}%) — {len(overloads_p0)} Circuits")
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
            w(_md_table_sep(5))
            for bf in overloads_p0:
                w(_md_table_row(bf['name'], f"{bf['from']} → {bf['to']}",
                              f"**{bf['s_mva']:.1f}**", f"{bf['rating_mva']:.1f}",
                              f"**{bf['loading_pct']:.1f}**"))
            w("")

        if branch_load['heavily_loaded']:
            hl = CFG['thermal']['heavy_pct']
            hl_over = CFG['thermal']['overload_pct']
            w(f"#### Heavily Loaded Branches ({hl:.0f}–{hl_over:.0f}%) — {len(branch_load['heavily_loaded'])} Circuits")
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
            w(_md_table_sep(5))
            max_display = CFG['display']['max_heavily_loaded']
            for bf in branch_load['heavily_loaded'][:max_display]:
                w(_md_table_row(bf['name'], f"{bf['from']} → {bf['to']}",
                              f"{bf['s_mva']:.1f}", f"{bf['rating_mva']:.1f}",
                              f"{bf['loading_pct']:.1f}"))
            if len(branch_load['heavily_loaded']) > max_display:
                w(f"*... and {len(branch_load['heavily_loaded'])-max_display} more circuits*")
            w("")

        if branch_load['moderate_loaded']:
            ml = CFG['thermal']['moderate_pct']
            hl = CFG['thermal']['heavy_pct']
            w(f"#### Moderately Loaded Branches ({ml:.0f}–{hl:.0f}%) — {len(branch_load['moderate_loaded'])} Circuits")
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Loading %"))
            w(_md_table_sep(4))
            max_display = CFG['display']['max_moderate_loaded']
            for bf in branch_load['moderate_loaded'][:max_display]:
                w(_md_table_row(bf['name'], f"{bf['from']} → {bf['to']}", f"{bf['s_mva']:.1f}", f"{bf['loading_pct']:.1f}"))
            if len(branch_load['moderate_loaded']) > max_display:
                w(f"*... and {len(branch_load['moderate_loaded'])-max_display} more circuits*")
            w("")

        w("#### Top 5 Loaded Circuits")
        w("")
        w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
        w(_md_table_sep(5))
        for bf in branch_load['top_5']:
            w(_md_table_row(bf['name'], f"{bf['from']} → {bf['to']}",
                          f"{bf['s_mva']:.1f}", f"{bf['rating_mva']:.1f}",
                          f"{bf['loading_pct']:.1f}"))
        w("")

        if overloads_p0:
            w(f"**P0 Thermal Result: FAIL** ({len(overloads_p0)} overloads detected)")
        else:
            w("**P0 Thermal Result: PASS** (no overloads)")
        w("")

        # Rate B Loading Summary
        if branch_load.get('has_ratings_b'):
            overloaded_b = branch_load.get('overloaded_b', [])
            heavy_b = branch_load.get('heavy_loaded_b', [])
            if overloaded_b or heavy_b:
                w("#### Rate B (Emergency) Loading Summary")
                w("")
                w("> Rate B (emergency) ratings are used for P3–P7 category thermal compliance. "
                  "Branches exceeding Rate B limits in the base case warrant attention.")
                w("")
                if overloaded_b:
                    w(f"- **{len(overloaded_b)} circuits** exceed 100% of Rate B in the base case")
                if heavy_b:
                    w(f"- **{len(heavy_b)} circuits** operate above 80% of Rate B in the base case")
                w("")
                if overloaded_b:
                    w(_md_table_row("Branch", "From–To", "Rate A Loading %", "Rate B Loading %", "Rate B Rating (MVA)"))
                    w(_md_table_sep(5))
                    for bf in overloaded_b[:5]:
                        w(_md_table_row(bf['name'], f"{bf['from']} → {bf['to']}",
                                      f"{bf['loading_pct']:.1f}", f"**{bf['loading_pct_b']:.1f}**",
                                      f"{bf['rating_mva_b']:.1f}"))
                    w("")
        w("")

    # 1.3 Generator Reactive Power
    w("### 1.3 Generator Reactive Power Assessment")
    w("")

    q_pass = len(gen_q['violations']) == 0
    w(f"**P0 Generator Q-Limit Result:** {_status_badge(q_pass)}")
    w("")

    if not q_pass:
        w(f"#### Generator Q-Limit Violations — {len(gen_q['violations'])} Violations")
        w("")
        w(_md_table_row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)"))
        w(_md_table_sep(5))
        for v in gen_q['violations']:
            w(_md_table_row(f"Bus{v['bus']}", v['name'], f"{v['q']:.4f}", f"{v['qmax']:.4f}", f"{v['qmin']:.4f}"))
        w("")

    if gen_q['at_limit']:
        w(f"#### Generators at Q-Limit — {len(gen_q['at_limit'])} Units")
        w("")
        max_display_q = CFG['display']['max_q_limit']
        q_margin = CFG['generator']['q_at_limit_margin']
        display_q = gen_q['at_limit'][:max_display_q]
        w(_md_table_row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)", "At Limit"))
        w(_md_table_sep(6))
        for g in display_q:
            qmax_val = float(g['qmax'])
            qmin_val = float(g['qmin'])
            q_val = float(g['q'])
            if abs(qmax_val - q_val) < q_margin:
                limit_label = "**Qmax**"
            else:
                limit_label = "**Qmin**"
            w(_md_table_row(f"Bus{g['bus']}", g['name'], f"{q_val:.4f}", f"{qmax_val:.4f}", f"{qmin_val:.4f}", limit_label))
        if len(gen_q['at_limit']) > max_display_q:
            w(f"")
            w(f"*... and {len(gen_q['at_limit'])-max_display_q} more units at limit*")
        w("")
        w("> **Note:** Generators at Q-limit have been switched from PV to PQ mode during the")
        w("> load flow solution, reducing voltage regulation capability in these areas.")
        w("")

    # ===================================================================
    # Section 2: Contingency Analysis (P1–P7)
    # ===================================================================
    w("## Section 2: Contingency Analysis (P1–P7)")
    w("")

    # 2.1 Critical Elements
    w("### 2.1 Critical Elements for N-1 Contingency Analysis")
    w("")
    w("#### Top 10 Most Heavily Loaded Circuits (Potential P1/P3/P5)")
    w("")
    w(_md_table_row("Rank", "Branch", "Flow (MVA)", "From", "To"))
    w(_md_table_sep(5))
    for i, (s, name, fr, to) in enumerate(contingency['top_branches'], 1):
        s_mva = s * BASE_KVA / 1000
        w(_md_table_row(i, name, f"{s_mva:.1f}", fr.strip(), to.strip()))
    w("")

    w("#### Top 10 Largest Generators (Potential P1 Events)")
    w("")
    w(_md_table_row("Rank", "Bus", "Name", "P Output (MW)"))
    w(_md_table_sep(4))
    for i, (pg, bid, name, pout) in enumerate(contingency['top_gens'], 1):
        p_mw = pout * BASE_KVA / 1000
        w(_md_table_row(i, f"Bus{bid}", name, f"{p_mw:.1f}"))
    w("")

    # 2.2 Parallel Circuits
    w("### 2.2 Parallel Circuits (P3/P5 Common-Mode Events)")
    w("")
    if parallel:
        n_par = len(parallel)
        w(
            f"**{n_par} parallel bus-pairs** (identical from–to with multiple circuit IDs) are candidates "
            "for P3 (common-mode) and P5 (delayed fault) contingency assessment. "
            "Full per-pair listing is omitted for large models."
        )
        w("")
        circ_hist = Counter(len(names) for names in parallel.values())
        max_circ = max(circ_hist)
        w(_md_table_row("Metric", "Value"))
        w(_md_table_sep(2))
        w(_md_table_row("Parallel bus-pairs", str(n_par)))
        for n_circ in sorted(circ_hist):
            w(_md_table_row(f"Pairs with {n_circ} parallel circuits", str(circ_hist[n_circ])))
        w(_md_table_row("Maximum circuits on one corridor", str(max_circ)))
        w("")
        w("**Sample bus-pairs (10 lowest bus numbers, stable ordering):**")
        w("")

        def _pair_sort_key(item):
            (fa, ta), _ = item

            def _num(x):
                try:
                    return int(str(x).strip())
                except (TypeError, ValueError):
                    return 0

            a, b = _num(fa), _num(ta)
            return (min(a, b), max(a, b))

        sample = sorted(parallel.items(), key=_pair_sort_key)[:10]
        w(_md_table_row("Bus Pair", "Circuits", "Parallel Circuits"))
        w(_md_table_sep(3))
        for (f, t), names in sample:
            w(_md_table_row(f"Bus{f} ↔ Bus{t}", str(len(names)), ", ".join(names)))
        w("")
        w("> **Note:** These parallel circuits, if physically located on common tower")
        w("> structures, constitute P3 events (N-2 loss on common ROW).")
    else:
        w("No parallel circuits identified.")
    w("")

    # 2.3 Contingency Results (if available)
    if contingency_results:
        w("### 2.3 N-1 Contingency Analysis Results")
        w("")
        w(f"Contingency analysis was performed on **{contingency_results['total_contingencies']} unique N-1 contingencies**, ")
        w(f"monitoring **{contingency_results['total_monitored']}** branch flow conditions.")
        w("")

        w("#### P1 Thermal Compliance Summary")
        w("")
        w(_md_table_row("Metric", "Value"))
        w(_md_table_sep(2))
        w(_md_table_row("Contingencies Run", contingency_results['total_contingencies']))
        w(_md_table_row("Monitored Branches", contingency_results['total_monitored']))
        w(_md_table_row("Post-Contingency Overloads", contingency_results['total_overloads']))
        severe_th = int(CFG['thermal']['severe_pct'])
        w(_md_table_row(f"Severe Overloads (>{severe_th}%)", len(contingency_results['severe_overloads'])))
        w(_md_table_row("P1 Thermal Status", _status_badge(contingency_results['p1_thermal_pass'])))
        w("")

        if contingency_results['overloads'] or contingency_results['severe_overloads']:
            w("#### Post-Contingency Overloads")
            w("")
            w(_md_table_row("Monitored Branch", "Outage (Contingency)", "Base Flow (MW)", "Post Flow (MW)", "Rating (MW)", "Loading %"))
            w(_md_table_sep(6))

            all_overloads = contingency_results['severe_overloads'] + contingency_results['overloads']
            max_ca_display = CFG['display']['max_contingency_overloads']
            for ol in all_overloads[:max_ca_display]:
                w(_md_table_row(
                    ol['branch'],
                    f"{ol['contingency']}",
                    f"{ol['base_flow']:.1f}",
                    f"**{ol['post_flow']:.1f}**",
                    f"{ol['rating']:.1f}",
                    f"**{ol['loading_pct']:.1f}**"
                ))
            if len(all_overloads) > max_ca_display:
                w(f"")
                w(f"*... and {len(all_overloads)-max_ca_display} more overloads*")
            w("")

            w("> **NERC TPL-001-5 P1 Requirement:** Post-contingency thermal loading must not exceed")
            w("> 100% of Rate A. These overloads indicate **P1 non-compliance** for the listed contingencies.")
            w("> Mitigation options include: line uprating, series compensation, generation redispatch,")
            w("> or transmission expansion.")
            w("")
        else:
            w("**No post-contingency thermal overloads detected.** All monitored branches remain within")
            w("their MVA ratings under N-1 contingency conditions. **P1 thermal criteria PASS.**")
            w("")
    else:
        w("### 2.3 N-1 Contingency Analysis Results")
        w("")
        w("> **Note:** No contingency analysis data (`_DF_contingency.csv`) found for this case.")
        w("> Run contingency analysis using:")
        w(">")
        w("> ```bash")
        w("> python ../src/ipss_cmd.py ca <format> <input>")
        w("> ```")
        w("")

    # ===================================================================
    # Section 3: Assessment & Recommendations
    # ===================================================================
    w("## Section 3: Assessment and Recommendations")
    w("")

    # 3.1 P0
    w("### 3.1 P0 Base Case Assessment")
    w("")
    w(_md_table_row("Criterion", "Result", "Status"))
    w(_md_table_sep(3))
    w(_md_table_row("Voltage Compliance", f"{len(voltage['violations_low'])} buses below {CFG['voltage']['p0']['v_min']:.2f} pu", _status_badge(voltage['passed'])))

    if ratings_unavailable:
        w(_md_table_row("Thermal Compliance", "Ratings not available", "INCONCLUSIVE"))
    else:
        overloads_p0 = branch_load['overloaded']
        if overloads_p0:
            w(_md_table_row("Thermal Compliance", f"{len(overloads_p0)} overloaded circuits", _status_badge(False)))
        else:
            w(_md_table_row("Thermal Compliance", "No overloads", _status_badge(True)))

    w(_md_table_row("Generator Q-Limits", f"{len(gen_q['at_limit'])} at limit, {len(gen_q['violations'])} violations", _status_badge(q_pass)))

    if p0_overall_pass:
        w(_md_table_row("**P0 OVERALL**", "All criteria met", "**COMPLIANT**"))
    elif p0_thermal_inconclusive:
        w(_md_table_row("**P0 OVERALL**", p0_description, "**INCONCLUSIVE**"))
    else:
        w(_md_table_row("**P0 OVERALL**", p0_description, "**NON-COMPLIANT**"))
    w("")

    # Voltage issues
    v_p0 = CFG['voltage']['p0']
    v_min_limit = v_p0['v_min']
    v_max_limit = v_p0['v_max']
    v_marg_low = v_p0['v_marginal_low']

    if not voltage['passed']:
        w("#### Voltage Issues")
        w("")
        if voltage['violations_low']:
            w(f"- **{len(voltage['violations_low'])} buses** violate the {v_min_limit:.2f} pu minimum")
        if voltage['violations_high']:
            w(f"- **{len(voltage['violations_high'])} buses** exceed the {v_max_limit:.2f} pu maximum")
        n_active = voltage.get("buses_analyzed", len(buses))
        pct_marginal = len(voltage["low_voltage_warn"]) / n_active * 100 if n_active else 0
        w(
            f"- **{len(voltage['low_voltage_warn'])} buses** ({pct_marginal:.0f}% of in-service buses) "
            f"operate in the marginal range ({v_min_limit:.2f}–{v_marg_low:.2f} pu)"
        )
        w("")
        w("**Recommendations:**")
        w("- Add capacitor banks at affected low-voltage buses")
        w("- Review OLTC tap settings on transformers in voltage-depressed corridors")
        w("- Consider adjusting generator voltage setpoints on nearby PV buses")
        w("")
    elif voltage['low_voltage_warn']:
        w("#### Voltage Observations")
        w("")
        w(f"- All bus voltages are within the required {v_min_limit:.2f}–{v_max_limit:.2f} pu range")
        w(f"- **{len(voltage['low_voltage_warn'])} buses** are in the marginal range ({v_min_limit:.2f}–{v_marg_low:.2f} pu) — monitor during contingency analysis")
        w("")
    else:
        w("#### Voltage Observations")
        w("")
        w(f"- All bus voltages are within the required {v_min_limit:.2f}–{v_max_limit:.2f} pu range with no marginal buses")
        w(f"- Voltage range: {voltage['v_min']:.4f} – {voltage['v_max']:.4f} pu")
        w("")

    # Q-limit findings
    if gen_q['at_limit']:
        w("#### Generator Q-Limit Findings")
        w("")
        q_margin = CFG['generator']['q_at_limit_margin']
        qmin_count = sum(1 for g in gen_q['at_limit'] if abs(float(g['q']) - float(g['qmin'])) < q_margin)
        qmax_count = len(gen_q['at_limit']) - qmin_count
        parts = []
        if qmin_count > 0:
            parts.append(f"**{qmin_count} at Qmin**")
        if qmax_count > 0:
            parts.append(f"**{qmax_count} at Qmax**")
        w(f"- {', '.join(parts)} with no remaining reactive power margin")
        w(f"- Generators at limit reduce voltage regulation capability during contingencies")
        if qmax_count > 0:
            w(f"- Generators at Qmax indicate constrained reactive power supply")
        if qmin_count > 0:
            w(f"- Generators at Qmin may indicate over-excitation or absorption limits")
        w(f"- PV→PQ switching occurred for these buses during solution")
        w("")

    # Branch rating issue
    if ratings_unavailable:
        w("#### Branch Rating Issue")
        w("")
        w(f"- **CRITICAL:** All {branch_load['total_branches']} branch MVA ratings (`LimMvaA`) are **missing** from the input data")
        w("- Thermal overload compliance cannot be evaluated without valid ratings")
        w("- **Action Required:** Populate `LimMvaA`, `LimMvaB`, and `LimMvaC` for every branch")
        w("")
    else:
        overload_pct = int(CFG['thermal']['overload_pct'])
        heavy_pct = int(CFG['thermal']['heavy_pct'])
        overloads_p0 = branch_load['overloaded']
        if overloads_p0:
            w("#### Branch Overload Findings")
            w("")
            w(f"- **{len(overloads_p0)} circuits** exceed {overload_pct}% of Rate A in the base case")
            w(f"- {len(branch_load['heavily_loaded'])} circuits operate above {heavy_pct}% loading")
            w("- **Recommendation:** Review overloaded circuits for uprating, reconfiguration, or generation redispatch")
            w("")
        else:
            w("#### Branch Loading Observations")
            w("")
            w(f"- All circuits are within their MVA ratings in the base case")
            if branch_load['heavily_loaded']:
                w(f"- {len(branch_load['heavily_loaded'])} circuits operate above {heavy_pct}% loading — monitor during contingency analysis")
            w("")

    # 3.2 Contingency Assessment
    w("### 3.2 P1–P6 Contingency Analysis Assessment")
    w("")

    if contingency_results and contingency_results['total_overloads'] > 0:
        w("#### P1 (N-1) Contingency Thermal Assessment")
        w("")
        w(f"- **{contingency_results['total_contingencies']}** N-1 contingencies evaluated against {branch_load['branches_with_ratings']} branches with ratings")
        w(f"- **{contingency_results['total_overloads']} post-contingency overloads** detected (N-1 thermal violations)")
        severe_th = int(CFG['thermal']['severe_pct'])
        w(f"- **{len(contingency_results['severe_overloads'])} overloads exceed {severe_th}%** of line rating — require urgent mitigation")
        w(f"- **P1 Thermal Status: {_status_badge(contingency_results['p1_thermal_pass'])}**")
        w("")

        if len(gen_q['at_limit']) > 0:
            w(f"- **{len(gen_q['at_limit'])}** generators at reactive power limits reduce post-contingency voltage support capability")
            w("")
    elif contingency_results and contingency_results['p1_thermal_pass']:
        w("#### P1 (N-1) Contingency Thermal Assessment")
        w("")
        w(f"- **{contingency_results['total_contingencies']}** N-1 contingencies evaluated")
        w("- **No post-contingency thermal overloads** detected")
        w("- **P1 Thermal Status: PASS**")
        w("")
    else:
        w("No contingency analysis data available. The following analysis is required:")
        w("")
        w("1. **Run N-1 contingency analysis** on the top 10 most heavily loaded circuits")
        w("2. **Test N-1 loss** of the 10 largest generators")
        w(f"3. **Evaluate P3 common-mode events** for all {len(parallel)} parallel circuit pairs")
        w("4. **Assess transformer outages** for voltage support impact")
        w("5. **Run N-1-1 analysis** for sequential contingencies")
        if ratings_unavailable:
            w("6. **Populate branch MVA ratings** and re-run thermal compliance assessment")
        w("")

    w("#### Remaining NERC TPL-001-5 Analysis Work")
    w("")
    w("**P2 (Bus section/breaker):** Not evaluated — requires bus-breaker model data.")
    if parallel:
        w(f"**P3/P5 (Common ROW/Delayed fault):** Not evaluated — {len(parallel)} parallel circuit pair(s) identified as candidates.")
    else:
        w("**P3/P5 (Common ROW/Delayed fault):** No parallel circuit pairs identified.")
    w("**P4 (Breaker failure):** Not evaluated — requires breaker failure analysis tools.")
    w("**P6 (N-1-1):** Not evaluated — requires sequential contingency analysis.")
    w("**P7 (Extreme events):** Not evaluated — requires extreme event scenario definition.")
    w("")

    # 3.3 Data Quality
    w("### 3.3 Data Quality Assessment")
    w("")
    w(_md_table_row("Data Field", "Status", "Notes"))
    w(_md_table_sep(3))

    if ratings_unavailable:
        w(_md_table_row("Branch MVA Ratings (`LimMvaA`)", "**MISSING**", f"All {branch_load['total_branches']} branches show 0.0. Required for thermal compliance."))
    else:
        w(_md_table_row("Branch MVA Ratings (`LimMvaA`)", "**PRESENT**", f"{branch_load['branches_with_ratings']}/{branch_load['total_branches']} branches have valid ratings."))

    if branch_load.get('has_ratings_b'):
        w(_md_table_row("Branch MVA Ratings (`LimMvaB`)", "**PRESENT**", f"{branch_load['branches_with_ratings_b']}/{branch_load['total_branches']} branches have valid emergency (Rate B) ratings."))
    else:
        w(_md_table_row("Branch MVA Ratings (`LimMvaB`)", "MISSING", "Emergency (Rate B) ratings not populated."))

    if branch_load.get('has_ratings_c'):
        w(_md_table_row("Branch MVA Ratings (`LimMvaC`)", "**PRESENT**", f"{branch_load['branches_with_ratings_c']}/{branch_load['total_branches']} branches have valid Rate C ratings."))
    else:
        w(_md_table_row("Branch MVA Ratings (`LimMvaC`)", "MISSING", "Rate C ratings not populated."))

    vsched_count = sum(1 for g in gens if float(g.get('VSched', 0)) > 0)
    w(_md_table_row("Bus Voltage Setpoints", "PRESENT" if vsched_count > 0 else "MISSING", f"{vsched_count} of {len(gens)} generator buses have VSched."))

    q_defined = sum(1 for g in gens if float(g['QMax']) != 0 or float(g['QMin']) != 0)
    w(_md_table_row("Generator Q Limits", "PRESENT" if q_defined > 0 else "MISSING", f"QMax/QMin defined for {q_defined} buses."))

    w(_md_table_row("Transformer Tap Data", "PRESENT", "Ratio and tap data included in model."))

    load_defined = sum(1 for l in loads if float(l['PLoadTotal']) != 0 or float(l['QLoadTotal']) != 0)
    w(_md_table_row("Load Data", "PRESENT" if load_defined > 0 else "MISSING", f"{load_defined} loads defined with P and Q values."))

    n_xfmr = branch_load.get('total_transformers', 0)
    n_lines = branch_load.get('total_lines', 0)
    w(_md_table_row("Branch Composition", "", f"{n_lines} lines, {n_xfmr} transformers ({n_xfmr/branch_load['total_branches']*100:.1f}% xfmrs)" if branch_load['total_branches'] > 0 else "N/A"))

    if contingency_results:
        w(_md_table_row("Contingency Data", "**PRESENT**", f"{contingency_results['total_contingencies']} contingencies evaluated."))
    else:
        w(_md_table_row("Contingency Data", "MISSING", "Run `python ../src/ipss_cmd.py ca` to generate contingency analysis."))
    w("")

    # ===================================================================
    # Footer
    # ===================================================================
    w("---")
    w("")
    w("## Report Metadata")
    w("")
    w(_md_table_row("Field", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row("Generated By", "`src/report/generate_nerc_tpl_report.py`"))
    w(_md_table_row("Case", case_name))
    _src_rel = case_base.relative_to(WSPACE)
    w(_md_table_row("Source Data", f"`{_src_rel}/{prefix}_DF_*.csv`"))
    w(_md_table_row("Input File", source_desc))
    w(_md_table_row("NERC Standard", "TPL-001-5 (Transmission System Planning Performance)"))
    w("")
    w("---")
    w("")
    w("> **End of NERC TPL-001-5 Compliance Assessment Report**")

    return "\n".join(report), case_base


if __name__ == "__main__":
    if len(sys.argv) >= 3:
        case_name = sys.argv[1]
        case_dir = sys.argv[2]
        report, case_base = generate_report(case_name, case_dir)
    elif len(sys.argv) == 2:
        # Backward-compatible mode (alias/discovered case name only).
        case_name = sys.argv[1]
        report, case_base = generate_report(case_name)
    else:
        print("Usage: python ../src/report/generate_nerc_tpl_report.py <case_name> <result_dir>")
        print("Example: python ../src/report/generate_nerc_tpl_report.py 'IEEE 118-Bus' data/ieee/Ieee118Bus/result")
        print("Example: python ../src/report/generate_nerc_tpl_report.py 'Texas 2K' data/psse/Texas2K/result")
        print("\nBackward-compatible mode also supported:")
        print("  python ../src/report/generate_nerc_tpl_report.py <discovered_alias_or_case_dir>")
        sys.exit(1)

    print(report)

    # Write to Markdown file alongside the CSV outputs
    case_base.mkdir(parents=True, exist_ok=True)
    output_file = case_base / "NERC_TPL_001_5_Report.md"
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(report)
    print(f"\nReport saved to: {output_file}")
