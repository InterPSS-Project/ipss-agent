#!/usr/bin/env python3
"""
AC Load Flow (ACLF) Report Generator

Reads CSV output from ``../src/ipss_cmd.py aclf`` (run from ``wspace/``) and produces a neutral
AC load flow results report in Markdown format. The report focuses on
solved base-case quantities only — no NERC TPL contingency criteria,
no contingency CSV consumption, no compliance wording.

Sections produced:
  * Title and metadata table
  * AclfNetwork summary + loadflow convergence (from ``*_network_info.txt``)
  * Executive summary (bus counts, totals, losses, swing bus)
  * Steady-state voltage profile (extremes, band distribution, violations)
  * Branch thermal loading (overloads / heavily / moderately loaded, top 5)
  * Generator reactive power (Q-limit margins)
  * Footer with metadata

Usage (from ``wspace/`` with venv activated):
  python ../src/report/generate_aclf_report.py <case_display_name> <result_dir> [csv_prefix]
  python ../src/report/generate_aclf_report.py 'IEEE 118-Bus Test Case' data/ieee/result
  python ../src/report/generate_aclf_report.py 'IEEE 14-Bus System' data/ieee/result ieee14
  python ../src/report/generate_aclf_report.py 'Texas 2000-Bus System' data/psse/Texas2K/result

The thresholds reused from ``config/gen_report.json`` (P0 voltage limits and
Rate A loading bands) are labelled as **planning-style** guidance only — this
report does **not** assert NERC TPL-001-5 compliance. For TPL compliance,
use ``../src/report/generate_nerc_tpl_report.py`` against the same CSV set.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from src.report.ipss_report_common import (
    BASE_KVA,
    CFG,
    WSPACE,
    _md_table_row,
    _md_table_sep,
    _status_badge,
    analyze_branch_loading,
    analyze_generator_q_limits,
    analyze_voltage_profile,
    load_csv,
    parse_network_info,
    resolve_case_base,
)


def _resolve_prefix(case_base: Path, csv_prefix: str | None = None) -> str:
    """Return the ACLF CSV stem (e.g. ``ieee14``) under ``case_base``.

    If ``csv_prefix`` is set, that stem is used (after verifying companion CSVs).
    Otherwise the first ``*_DF_bus.csv`` in lexicographic order is used — when
    several cases share one ``result/`` folder, pass ``csv_prefix`` explicitly.
    """
    required = ["_DF_branch.csv", "_DF_gen.csv", "_DF_load.csv"]

    if csv_prefix is not None:
        prefix = csv_prefix.strip()
        if not prefix:
            raise ValueError("csv_prefix must be non-empty when provided.")
        bus_path = case_base / f"{prefix}_DF_bus.csv"
        if not bus_path.exists():
            raise FileNotFoundError(
                f"No {prefix}_DF_bus.csv under {case_base}. Run `python ../src/ipss_cmd.py aclf` first."
            )
        missing = [s for s in required if not (case_base / f"{prefix}{s}").exists()]
        if missing:
            raise FileNotFoundError(
                f"Missing required ACLF CSVs for prefix '{prefix}' in {case_base}: "
                f"{', '.join(missing)}"
            )
        return prefix

    bus_files = sorted(case_base.glob("*_DF_bus.csv"))
    if not bus_files:
        raise FileNotFoundError(
            f"No *_DF_bus.csv files found under {case_base}. Run `python ../src/ipss_cmd.py aclf` first."
        )
    prefix = bus_files[0].name.removesuffix("_DF_bus.csv")

    missing = [s for s in required if not (case_base / f"{prefix}{s}").exists()]
    if missing:
        raise FileNotFoundError(
            f"Missing required ACLF CSVs for prefix '{prefix}' in {case_base}: "
            f"{', '.join(missing)}"
        )
    return prefix


def generate_aclf_report(
    display_name: str, result_dir: str, csv_prefix: str | None = None
) -> tuple[str, Path]:
    """Generate the AC load flow results report in Markdown format.

    Args:
        display_name: Human-readable case name shown in the report header.
        result_dir: Directory containing the ACLF CSV outputs. Accepts an
            absolute path, a path relative to ``wspace/`` (e.g.
            ``data/ieee/result``), or a subdirectory name under
            ``wspace/result/`` (legacy layout, resolved by
            :func:`resolve_case_base`).
        csv_prefix: Optional CSV stem matching ``../src/ipss_cmd.py`` output (e.g.
            ``ieee14`` for ``ieee14_DF_bus.csv``). Use when multiple cases
            write to the same ``result_dir``.

    Returns:
        Tuple of ``(markdown_report, case_base)`` where ``case_base`` is the
        resolved directory containing the CSV files.
    """
    case_base = resolve_case_base(result_dir)
    prefix = _resolve_prefix(case_base, csv_prefix)
    source_desc = f"`{case_base.relative_to(WSPACE)}`"

    buses = load_csv(f"{prefix}_DF_bus.csv", case_base)
    branches = load_csv(f"{prefix}_DF_branch.csv", case_base)
    gens = load_csv(f"{prefix}_DF_gen.csv", case_base)
    loads = load_csv(f"{prefix}_DF_load.csv", case_base)

    network_info_data = parse_network_info(case_base, prefix)

    voltage = analyze_voltage_profile(buses)
    branch_load = analyze_branch_loading(branches)
    gen_q = analyze_generator_q_limits(gens)

    total_gen_p = sum(float(g["PGen"]) for g in gens)
    total_gen_q = sum(float(g["QGen"]) for g in gens)
    total_load_p = sum(float(l["PLoadTotal"]) for l in loads)
    total_load_q = sum(float(l["QLoadTotal"]) for l in loads)
    losses_p = total_gen_p - total_load_p
    losses_q = total_gen_q - total_load_q

    pv_buses = [b for b in buses if b["BusType"] == "PV"]
    pq_buses = [b for b in buses if b["BusType"] == "PQ"]
    swing_buses = [b for b in buses if b["BusType"] == "Swing"]

    swing_bus_num = swing_buses[0]["Number"] if swing_buses else None
    swing_bus_name = swing_buses[0]["Name"].strip() if swing_buses else "Unknown"
    swing_vsched = (
        next((float(g["VSched"]) for g in gens if g["BusNumber"] == swing_bus_num), 0)
        if swing_bus_num
        else 0
    )
    swing_p = (
        next((float(g["PGen"]) for g in gens if g["BusNumber"] == swing_bus_num), 0)
        if swing_bus_num
        else 0
    )
    swing_q = (
        next((float(g["QGen"]) for g in gens if g["BusNumber"] == swing_bus_num), 0)
        if swing_bus_num
        else 0
    )

    base_mva_val = BASE_KVA / 1000

    report: list[str] = []
    w = report.append

    # ===================================================================
    # Title and Header
    # ===================================================================
    w("# AC Load Flow Report")
    w("")
    w(f"**{display_name}**")
    w("")
    w("---")
    w("")
    w(_md_table_row("Field", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row("**System**", display_name))
    w(_md_table_row("**Base MVA**", f"{base_mva_val:.0f} MVA"))
    w(_md_table_row("**Report Date**", datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    w(_md_table_row("**Input**", source_desc))
    w(_md_table_row("**Source CSV Prefix**", f"`{prefix}_DF_*.csv`"))
    if network_info_data and network_info_data.get("loadflow_run"):
        converged = network_info_data["loadflow_run"].get("Loadflow converged", "N/A")
        w(_md_table_row("**Loadflow Converged**", converged))
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
    else:
        w("## AclfNetwork Summary")
        w("")
        w(
            f"> **Note:** No `{prefix}_network_info.txt` found alongside the CSVs. "
            "Solver-reported network statistics and convergence flag are unavailable."
        )
        w("")

    # ===================================================================
    # Executive Summary
    # ===================================================================
    w("## Executive Summary")
    w("")
    w(_md_table_row("Metric", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row(
        "Total Buses",
        f"{len(buses)} ({len(pq_buses)} PQ, {len(pv_buses)} PV, {len(swing_buses)} Swing)",
    ))
    w(_md_table_row(
        "Total Branches",
        f"{len(branches)} ({branch_load['branches_with_ratings']} with MVA ratings, "
        f"{branch_load['total_lines']} lines, {branch_load['total_transformers']} transformers)",
    ))
    w(_md_table_row("Total Generators", gen_q["total_gens"]))
    w(_md_table_row("Total Loads", len(loads)))
    w(_md_table_row(
        "Total Load",
        f"{total_load_p:.2f} pu P / {total_load_q:.2f} pu Q "
        f"({total_load_p * base_mva_val:.1f} MW / {total_load_q * base_mva_val:.1f} MVAr)",
    ))
    w(_md_table_row(
        "Total Generation",
        f"{total_gen_p:.2f} pu P / {total_gen_q:.2f} pu Q "
        f"({total_gen_p * base_mva_val:.1f} MW / {total_gen_q * base_mva_val:.1f} MVAr)",
    ))
    w(_md_table_row(
        "System Losses",
        f"{losses_p:.2f} pu P / {losses_q:.2f} pu Q "
        f"({losses_p * base_mva_val:.1f} MW / {losses_q * base_mva_val:.1f} MVAr)",
    ))
    if swing_bus_num:
        w(_md_table_row(
            "Swing Bus",
            f"Bus{swing_bus_num} ({swing_bus_name}) at {swing_vsched:.4f} pu",
        ))
        w(_md_table_row("Swing Output", f"{swing_p:.2f} pu P / {swing_q:.2f} pu Q"))
    w("")
    w(f"> **Note:** Summary P/Q values are reported in per-unit on a {base_mva_val:.0f} MVA base unless otherwise noted.")
    w("")

    # ===================================================================
    # Voltage Profile
    # ===================================================================
    v_p0 = CFG["voltage"]["p0"]
    v_min_limit = v_p0["v_min"]
    v_max_limit = v_p0["v_max"]
    v_marg_low = v_p0["v_marginal_low"]
    bands_cfg = CFG["voltage"]["bands"]

    w("## Steady-State Voltage Profile")
    w("")
    w(
        f"Voltage compliance bands below use planning-style limits of "
        f"**{v_min_limit:.2f}–{v_max_limit:.2f} pu** from `config/gen_report.json` "
        "(same thresholds the NERC report uses for P0). They are reported here as "
        "*reference bands*, not as a NERC compliance verdict."
    )
    w("")

    w("### Voltage Extremes")
    w("")
    w(_md_table_row("Metric", "Value", "Location"))
    w(_md_table_sep(3))
    w(_md_table_row("Minimum Voltage", f"**{voltage['v_min']:.4f} pu**", voltage["v_min_bus"]))
    w(_md_table_row("Maximum Voltage", f"**{voltage['v_max']:.4f} pu**", voltage["v_max_bus"]))
    w(_md_table_row("Buses Analyzed (in-service)", voltage.get("buses_analyzed", 0), ""))
    if voltage.get("inactive_excluded", 0):
        w(_md_table_row("Out-of-Service Excluded", voltage["inactive_excluded"], ""))
    w("")

    bands = voltage.get("bands", {})
    n_active = voltage.get("buses_analyzed", 0)
    if bands and n_active > 0:
        w("### Voltage Band Distribution")
        w("")
        w(_md_table_row("Voltage Range", "Description", "Buses", "% of In-Service"))
        w(_md_table_sep(4))

        band_descriptions = {
            "severe_low": f"< {bands_cfg.get('severe_low', 0.90):.2f} pu",
            "violation_low": f"{bands_cfg.get('severe_low', 0.90):.2f}–{bands_cfg.get('violation_low', 0.95):.2f} pu",
            "marginal": f"{bands_cfg.get('violation_low', 0.95):.2f}–{bands_cfg.get('marginal_low', 0.98):.2f} pu",
            "nominal": f"{bands_cfg.get('marginal_low', 0.98):.2f}–{bands_cfg.get('marginal_high', 1.02):.2f} pu",
            "high_ok": f"{bands_cfg.get('marginal_high', 1.02):.2f}–{bands_cfg.get('violation_high', 1.05):.2f} pu",
            "violation_high": f"> {bands_cfg.get('violation_high', 1.05):.2f} pu",
        }
        band_labels = {
            "severe_low": "Severe Low (below planning limit)",
            "violation_low": "Low Violation (below planning limit)",
            "marginal": "Marginal Low",
            "nominal": "Nominal",
            "high_ok": "High Acceptable",
            "violation_high": "High Violation (above planning limit)",
        }
        for band_key in [
            "severe_low",
            "violation_low",
            "marginal",
            "nominal",
            "high_ok",
            "violation_high",
        ]:
            count = len(bands.get(band_key, []))
            pct = (count / n_active * 100) if n_active > 0 else 0
            if count > 0 or band_key in ("marginal", "nominal"):
                w(_md_table_row(
                    band_descriptions.get(band_key, ""),
                    band_labels.get(band_key, band_key),
                    str(count),
                    f"{pct:.1f}%",
                ))
        w("")

    if voltage.get("inactive_excluded", 0):
        nx = voltage["inactive_excluded"]
        w(
            f"> **Note:** Voltage statistics use **in-service buses only** "
            f"(`InService` in the bus CSV). **{nx}** out-of-service buses were excluded."
        )
        w("")

    if voltage["violations_low"]:
        w(f"### Buses Below {v_min_limit:.2f} pu — {len(voltage['violations_low'])} Buses")
        w("")
        w(_md_table_row("Bus", "Name", "Voltage (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in voltage["violations_low"]:
            w(_md_table_row(f"Bus{bid}", name, f"**{v:.4f}**"))
        w("")

    if voltage["violations_high"]:
        w(f"### Buses Above {v_max_limit:.2f} pu — {len(voltage['violations_high'])} Buses")
        w("")
        w(_md_table_row("Bus", "Name", "Voltage (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in voltage["violations_high"]:
            w(_md_table_row(f"Bus{bid}", name, f"{v:.4f}"))
        w("")

    if voltage["low_voltage_warn"]:
        warn = voltage["low_voltage_warn"]
        n_warn = len(warn)
        vals = sorted(v for _, _, v in warn)
        v_min_m = vals[0]
        v_max_m = vals[-1]
        v_mean = sum(vals) / n_warn
        mid = n_warn // 2
        v_med = vals[mid] if n_warn % 2 else (vals[mid - 1] + vals[mid]) / 2

        w(f"### Marginal Low Voltage ({v_min_limit:.2f}–{v_marg_low:.2f} pu) — {n_warn} Buses")
        w("")
        w(
            f"These buses are within the {v_min_limit:.2f}–{v_max_limit:.2f} pu band but below "
            f"{v_marg_low:.2f} pu. Per-bus listing is omitted for large cases."
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
        n_sample = CFG["display"]["marginal_sample_count"]
        w(f"**Lowest {n_sample} buses by voltage (sample):**")
        w("")
        w(_md_table_row("Bus", "Name", "V (pu)"))
        w(_md_table_sep(3))
        for bid, name, v in sorted(warn, key=lambda x: x[2])[:n_sample]:
            w(_md_table_row(f"Bus{bid}", name, f"{v:.4f}"))
        w("")

    v_status = _status_badge(voltage["passed"])
    w(f"**Voltage Within Planning Limits:** {v_status}")
    w("")

    # ===================================================================
    # Branch Thermal Loading
    # ===================================================================
    w("## Branch Thermal Loading")
    w("")

    ratings_unavailable = not branch_load["has_ratings"]

    if ratings_unavailable:
        w(
            f"> **Note:** Branch MVA ratings (`LimMvaA`) are not populated for any of the "
            f"**{branch_load['total_branches']} branches** in this dataset. Thermal loading "
            "percentages cannot be computed. Populate `LimMvaA` in the source case and rerun "
            "`python ../src/ipss_cmd.py aclf` to enable this section."
        )
        w("")
    else:
        w(
            f"Branches with Rate A ratings: **{branch_load['branches_with_ratings']}/"
            f"{branch_load['total_branches']}**."
        )
        w("")

        overload_pct = CFG["thermal"]["overload_pct"]
        heavy_pct = CFG["thermal"]["heavy_pct"]
        moderate_pct = CFG["thermal"]["moderate_pct"]

        overloads = branch_load["overloaded"]
        if overloads:
            w(f"### Overloaded Circuits (>{overload_pct:.0f}% Rate A) — {len(overloads)} Circuits")
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
            w(_md_table_sep(5))
            for bf in overloads:
                w(_md_table_row(
                    bf["name"],
                    f"{bf['from']} → {bf['to']}",
                    f"**{bf['s_mva']:.1f}**",
                    f"{bf['rating_mva']:.1f}",
                    f"**{bf['loading_pct']:.1f}**",
                ))
            w("")

        if branch_load["heavily_loaded"]:
            w(
                f"### Heavily Loaded Branches ({heavy_pct:.0f}–{overload_pct:.0f}%) — "
                f"{len(branch_load['heavily_loaded'])} Circuits"
            )
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
            w(_md_table_sep(5))
            max_display = CFG["display"]["max_heavily_loaded"]
            for bf in branch_load["heavily_loaded"][:max_display]:
                w(_md_table_row(
                    bf["name"],
                    f"{bf['from']} → {bf['to']}",
                    f"{bf['s_mva']:.1f}",
                    f"{bf['rating_mva']:.1f}",
                    f"{bf['loading_pct']:.1f}",
                ))
            if len(branch_load["heavily_loaded"]) > max_display:
                w(f"*... and {len(branch_load['heavily_loaded']) - max_display} more circuits*")
            w("")

        if branch_load["moderate_loaded"]:
            w(
                f"### Moderately Loaded Branches ({moderate_pct:.0f}–{heavy_pct:.0f}%) — "
                f"{len(branch_load['moderate_loaded'])} Circuits"
            )
            w("")
            w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Loading %"))
            w(_md_table_sep(4))
            max_display = CFG["display"]["max_moderate_loaded"]
            for bf in branch_load["moderate_loaded"][:max_display]:
                w(_md_table_row(
                    bf["name"],
                    f"{bf['from']} → {bf['to']}",
                    f"{bf['s_mva']:.1f}",
                    f"{bf['loading_pct']:.1f}",
                ))
            if len(branch_load["moderate_loaded"]) > max_display:
                w(f"*... and {len(branch_load['moderate_loaded']) - max_display} more circuits*")
            w("")

        w("### Top 5 Loaded Circuits")
        w("")
        w(_md_table_row("Branch", "From–To", "Flow (MVA)", "Rating (MVA)", "Loading %"))
        w(_md_table_sep(5))
        for bf in branch_load["top_5"]:
            rating_cell = f"{bf['rating_mva']:.1f}" if bf.get("rating_mva") else "—"
            w(_md_table_row(
                bf["name"],
                f"{bf['from']} → {bf['to']}",
                f"{bf['s_mva']:.1f}",
                rating_cell,
                f"{bf['loading_pct']:.1f}",
            ))
        w("")

        t_pass = len(overloads) == 0
        w(f"**Rate A Loading Within Limits:** {_status_badge(t_pass)}")
        w("")

        if branch_load.get("has_ratings_b"):
            overloaded_b = branch_load.get("overloaded_b", [])
            heavy_b = branch_load.get("heavy_loaded_b", [])
            if overloaded_b or heavy_b:
                w("### Rate B (Emergency) Loading Summary")
                w("")
                if overloaded_b:
                    w(f"- **{len(overloaded_b)} circuits** exceed 100% of Rate B in this base case")
                if heavy_b:
                    w(f"- **{len(heavy_b)} circuits** operate above 80% of Rate B in this base case")
                w("")
                if overloaded_b:
                    w(_md_table_row(
                        "Branch", "From–To", "Rate A Loading %", "Rate B Loading %", "Rate B Rating (MVA)"
                    ))
                    w(_md_table_sep(5))
                    for bf in overloaded_b[:5]:
                        w(_md_table_row(
                            bf["name"],
                            f"{bf['from']} → {bf['to']}",
                            f"{bf['loading_pct']:.1f}",
                            f"**{bf['loading_pct_b']:.1f}**",
                            f"{bf['rating_mva_b']:.1f}",
                        ))
                    w("")

    # ===================================================================
    # Generator Reactive Power
    # ===================================================================
    w("## Generator Reactive Power")
    w("")
    q_pass = len(gen_q["violations"]) == 0
    w(f"**Generators Within Q-Limits:** {_status_badge(q_pass)}")
    w("")
    n_gens = gen_q["total_gens"]
    n_at_limit = len(gen_q["at_limit"])
    n_viol = len(gen_q["violations"])
    q_limit_pct = (n_at_limit / n_gens * 100) if n_gens > 0 else 0
    q_viol_pct = (n_viol / n_gens * 100) if n_gens > 0 else 0
    w(_md_table_row("Metric", "Value"))
    w(_md_table_sep(2))
    w(_md_table_row("Generators Considered", n_gens))
    w(_md_table_row("At Q-Limit", f"{n_at_limit} ({q_limit_pct:.1f}%)"))
    w(_md_table_row("Q-Limit Violations", f"{n_viol} ({q_viol_pct:.1f}%)"))
    w("")

    if gen_q["violations"]:
        w(f"### Q-Limit Violations — {n_viol} Violations")
        w("")
        w(_md_table_row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)"))
        w(_md_table_sep(5))
        for v in gen_q["violations"]:
            w(_md_table_row(
                f"Bus{v['bus']}", v["name"],
                f"{v['q']:.4f}", f"{v['qmax']:.4f}", f"{v['qmin']:.4f}",
            ))
        w("")

    if gen_q["at_limit"]:
        max_display_q = CFG["display"]["max_q_limit"]
        q_margin = CFG["generator"]["q_at_limit_margin"]
        display_q = gen_q["at_limit"][:max_display_q]
        w(f"### Generators at Q-Limit — {n_at_limit} Units")
        w("")
        w(_md_table_row("Bus", "Name", "Q (pu)", "Qmax (pu)", "Qmin (pu)", "At Limit"))
        w(_md_table_sep(6))
        for g in display_q:
            qmax_val = float(g["qmax"])
            qmin_val = float(g["qmin"])
            q_val = float(g["q"])
            limit_label = "**Qmax**" if abs(qmax_val - q_val) < q_margin else "**Qmin**"
            w(_md_table_row(
                f"Bus{g['bus']}", g["name"],
                f"{q_val:.4f}", f"{qmax_val:.4f}", f"{qmin_val:.4f}",
                limit_label,
            ))
        if n_at_limit > max_display_q:
            w("")
            w(f"*... and {n_at_limit - max_display_q} more units at limit*")
        w("")
        w(
            "> **Note:** Generators at their reactive power limit have been switched from "
            "PV to PQ during the load flow solution, reducing local voltage regulation capability."
        )
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
    w(_md_table_row("Generated By", "`src/report/generate_aclf_report.py`"))
    w(_md_table_row("Case", display_name))
    _src_rel = case_base.relative_to(WSPACE)
    w(_md_table_row("Source Data", f"`{_src_rel}/{prefix}_DF_*.csv`"))
    w(_md_table_row("Network Info", f"`{_src_rel}/{prefix}_network_info.txt`"))
    w("")
    w("---")
    w("")
    w("> **End of AC Load Flow Report**")

    return "\n".join(report), case_base


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python ../src/report/generate_aclf_report.py <case_display_name> <result_dir> [csv_prefix]")
        print(
            "Example: python ../src/report/generate_aclf_report.py 'IEEE 118-Bus Test Case' data/ieee/result"
        )
        print(
            "Example: python ../src/report/generate_aclf_report.py 'IEEE 14-Bus System' data/ieee/result ieee14"
        )
        print(
            "Example: python ../src/report/generate_aclf_report.py 'Texas 2000-Bus System' data/psse/Texas2K/result"
        )
        sys.exit(1)

    display_name = sys.argv[1]
    result_dir = sys.argv[2]
    csv_prefix = sys.argv[3] if len(sys.argv) > 3 else None

    report, case_base = generate_aclf_report(display_name, result_dir, csv_prefix)
    print(report)

    case_base.mkdir(parents=True, exist_ok=True)
    output_file = case_base / "AC_Loadflow_Report.md"
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\nReport saved to: {output_file}")
