#!/usr/bin/env python3
"""Shared helpers for ipss.agent Markdown report generators.

This module centralises the pieces that the NERC TPL-001-5 report and the
ACLF report both need:

* Configuration loading and merged defaults (``CFG`` / ``BASE_KVA``).
* Case-directory resolution and CSV / network-info loading.
* P0-relevant analyses (voltage, branch loading, generator Q-limits).
* Small Markdown table helpers.

The module is intentionally import-safe: it does **not** read ``sys.argv``
or look at any CLI arguments at import time. Report scripts are expected to
parse their own CLI and pass values through function parameters.
"""

from __future__ import annotations

import csv
import json
from math import sqrt
from pathlib import Path

from paths import project_root

# --- Locations ---------------------------------------------------------------

PROJECT_ROOT = project_root()
WSPACE = PROJECT_ROOT / "wspace"
RESULT_DIR = WSPACE / "result"

# --- Configuration -----------------------------------------------------------

_DEFAULT_CFG = {
    "base_mva": 100000,
    "voltage": {
        "p0": {"v_min": 0.95, "v_max": 1.05, "v_marginal_low": 0.98, "v_marginal_high": 1.02},
        "p1_p7": {"v_min": 0.90, "v_max": 1.05},
        "bands": {"severe_low": 0.90, "violation_low": 0.95, "marginal_low": 0.98,
                   "marginal_high": 1.02, "violation_high": 1.05},
        "fp_tol": 0.001,
    },
    "thermal": {"overload_pct": 100, "heavy_pct": 80, "moderate_pct": 50, "severe_pct": 120},
    "generator": {"q_at_limit_margin": 0.015, "q_fp_tol": 0.001, "min_gen_output_mw": 0.01},
    "display": {"max_heavily_loaded": 10, "max_moderate_loaded": 10, "max_q_limit": 20,
                "max_contingency_overloads": 20, "max_critical_elements": 10,
                "max_parallel_sample": 10, "marginal_sample_count": 10},
}


def _deep_update(base, override):
    """Recursively update ``base`` dict in-place with values from ``override``."""
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_update(base[k], v)
        else:
            base[k] = v


def load_tpl_config():
    """Load report thresholds from ``config/gen_report.json``, with fallbacks.

    Partial configs are merged on top of ``_DEFAULT_CFG`` so callers can override
    individual values without restating the entire schema.
    """
    config_path = PROJECT_ROOT / "config" / "gen_report.json"
    if config_path.exists():
        with open(config_path, 'r') as f:
            cfg = json.load(f)
        merged = dict(_DEFAULT_CFG)
        _deep_update(merged, cfg)
        return merged
    return dict(_DEFAULT_CFG)


CFG = load_tpl_config()
BASE_KVA = CFG["base_mva"]


# --- Case / CSV discovery ----------------------------------------------------

def resolve_case_base(result_dir: str) -> Path:
    """Directory containing ``*_DF_bus.csv``.

    Accepts an absolute path, a path relative to ``wspace/`` (e.g.
    ``data/ieee/Ieee118Bus/result``), or a subfolder name under ``wspace/result/``
    (legacy layout).
    """
    p = Path(result_dir)
    candidates = [p] if p.is_absolute() else [WSPACE / result_dir, RESULT_DIR / result_dir]
    tried = []
    for base in candidates:
        resolved = base.resolve()
        tried.append(str(resolved))
        if resolved.is_dir() and any(resolved.glob("*_DF_bus.csv")):
            return resolved
    raise FileNotFoundError(
        f"No *_DF_bus.csv found for result_dir={result_dir!r}. Tried: {', '.join(tried)}"
    )


def load_csv(filename, case_base: Path):
    """Load a CSV file from ``case_base`` and return a list of dict rows."""
    filepath = case_base / filename
    with open(filepath, 'r') as f:
        return list(csv.DictReader(f))


def load_csv_optional(filename, case_base: Path):
    """Load a CSV file if it exists, else return ``None``."""
    filepath = case_base / filename
    if filepath.exists():
        with open(filepath, 'r') as f:
            return list(csv.DictReader(f))
    return None


def parse_network_info(case_base: Path, prefix: str) -> dict | None:
    """Parse ``<prefix>_network_info.txt`` into a structured dictionary.

    The file produced by ``../src/main/py/ipss_cmd.py`` (run from ``wspace/``) has two sections:

        =====Aclf Network Information:=====
        Number of Active Buses: 2000
        Number of Active Branches: 3220
        ...
        ===== Loadflow Run Information:=====
        Loadflow converged: true
        Max mismatch: 0.0000

    Returns a dict with ``'aclf_network'`` (dict of key→value strings) and
    ``'loadflow_run'`` (dict of key→value strings), or ``None`` if the file
    is absent.
    """
    filepath = case_base / f"{prefix}_network_info.txt"
    if not filepath.exists():
        return None

    sections: dict[str, dict[str, str]] = {}
    current_section = None

    with open(filepath, 'r') as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("=====") and stripped.endswith("====="):
                current_section = stripped.strip("=").strip().rstrip(":")
                sections[current_section] = {}
            elif ":" in stripped and current_section is not None:
                key, _, value = stripped.partition(":")
                sections[current_section][key.strip()] = value.strip()

    return {
        "aclf_network": sections.get("Aclf Network Information", {}),
        "loadflow_run": sections.get("Loadflow Run Information", {}),
    }


# --- Analysis helpers --------------------------------------------------------

def _bus_in_service(bus):
    """True if the bus is in service in the AC model (``InService`` in the bus CSV).

    Out-of-service buses are excluded from voltage compliance; they often carry
    ``0.0 pu`` in result exports and must not drive ``v_min`` / violation counts.
    """
    raw = bus.get('InService')
    if raw is None or str(raw).strip() == "":
        return True
    return str(raw).strip().lower() in ("true", "1", "yes", "y", "t")


def analyze_voltage_profile(buses, cfg=None):
    """Analyze bus voltage profile for in-service buses only.

    Args:
        buses: List of bus dicts from the bus CSV.
        cfg: Optional thresholds dict (uses module-level ``CFG`` if ``None``).

    Returns a dict with voltage stats, violation lists, and band distribution.
    """
    if cfg is None:
        cfg = CFG
    v_cfg = cfg["voltage"]["p0"]
    v_min_limit = v_cfg["v_min"]
    v_max_limit = v_cfg["v_max"]
    v_marg_low = v_cfg["v_marginal_low"]
    v_marg_high = v_cfg.get("v_marginal_high", v_max_limit)
    bands_cfg = cfg["voltage"]["bands"]

    in_service = [b for b in buses if _bus_in_service(b)]
    inactive_excluded = len(buses) - len(in_service)

    violations_low = []
    violations_high = []
    low_voltage_warn = []
    high_voltage_warn = []

    bands = {
        "severe_low": [],
        "violation_low": [],
        "marginal": [],
        "nominal": [],
        "high_ok": [],
        "violation_high": [],
    }
    band_names = ["severe_low", "violation_low", "marginal", "nominal", "high_ok", "violation_high"]

    v_min = float("inf")
    v_max = float("-inf")
    v_min_bus = v_max_bus = ""

    if not in_service:
        return {
            "v_min": 1.0, "v_max": 1.0,
            "v_min_bus": "N/A (no in-service buses)",
            "v_max_bus": "N/A (no in-service buses)",
            "violations_low": [], "violations_high": [],
            "low_voltage_warn": [], "high_voltage_warn": [],
            "bands": {b: [] for b in band_names},
            "passed": True,
            "inactive_excluded": inactive_excluded,
            "buses_analyzed": 0,
        }

    for bus in in_service:
        v = float(bus["VoltMag"])
        name = bus["Name"].strip()
        bid = bus["Number"]

        if v < v_min:
            v_min = v
            v_min_bus = f"Bus{bid} ({name})"
        if v > v_max:
            v_max = v
            v_max_bus = f"Bus{bid} ({name})"

        fp_tol = cfg["voltage"].get("fp_tol", 0.001)

        if v < v_min_limit - fp_tol:
            violations_low.append((bid, name, v))
        elif v < v_marg_low:
            low_voltage_warn.append((bid, name, v))
        elif v > v_max_limit + fp_tol:
            violations_high.append((bid, name, v))
        elif v > v_marg_high:
            high_voltage_warn.append((bid, name, v))

        sv = bands_cfg.get("severe_low", 0.90)
        vl = bands_cfg.get("violation_low", v_min_limit)
        ml = bands_cfg.get("marginal_low", v_marg_low)
        mh = bands_cfg.get("marginal_high", v_marg_high)
        vh = bands_cfg.get("violation_high", v_max_limit)

        if v < sv - fp_tol:
            bands["severe_low"].append((bid, name, v))
        elif v < vl - fp_tol:
            bands["violation_low"].append((bid, name, v))
        elif v < ml:
            bands["marginal"].append((bid, name, v))
        elif v <= mh:
            bands["nominal"].append((bid, name, v))
        elif v <= vh + fp_tol:
            bands["high_ok"].append((bid, name, v))
        else:
            bands["violation_high"].append((bid, name, v))

    return {
        "v_min": v_min,
        "v_max": v_max,
        "v_min_bus": v_min_bus,
        "v_max_bus": v_max_bus,
        "violations_low": violations_low,
        "violations_high": violations_high,
        "low_voltage_warn": low_voltage_warn,
        "high_voltage_warn": high_voltage_warn,
        "bands": bands,
        "passed": len(violations_low) == 0 and len(violations_high) == 0,
        "inactive_excluded": inactive_excluded,
        "buses_analyzed": len(in_service),
    }


def analyze_branch_loading(branches, cfg=None):
    """Analyze branch loading (MVA flow vs rating) for Rate A, B, and C.

    Uses the ``Loading%`` column from InterPSS when available (handles both
    per-unit and absolute unit ratings correctly). Falls back to per-unit
    computation when ratings are in the same unit as flows.
    """
    if cfg is None:
        cfg = CFG
    th = cfg["thermal"]
    overload_pct = th["overload_pct"]
    heavy_pct = th["heavy_pct"]
    moderate_pct = th["moderate_pct"]
    base_kva = cfg.get("base_mva", BASE_KVA)

    heavily_loaded = []
    overloaded = []
    moderate_loaded = []
    overloaded_b = []
    heavy_loaded_b = []

    branch_flows = []
    for br in branches:
        p_from = float(br['PFrom2To'])
        q_from = float(br['QFrom2To'])
        s_mva = sqrt(p_from**2 + q_from**2)
        rating_a = float(br['LimMvaA'])
        rating_b = float(br.get('LimMvaB', 0))
        rating_c = float(br.get('LimMvaC', 0))
        is_xfmr = br.get('IsXfmr', '').strip().lower() in ('true', '1', 'yes', 'y', 't')

        ipss_loading = float(br.get('Loading%', 0))

        br_name = br['Name'].strip() if br['Name'].strip() else br['ID'].strip()

        if rating_a > 0:
            if ipss_loading > 0:
                rating_mva = s_mva * base_kva / 1000 / (ipss_loading / 100)
                loading_pct = ipss_loading
            else:
                rating_mva = rating_a * base_kva / 1000
                loading_pct = (s_mva / rating_a * 100) if rating_a > 0 else 0
        else:
            rating_mva = None
            loading_pct = 0 if ipss_loading == 0 else ipss_loading

        if rating_b > 0:
            loading_pct_b = s_mva * base_kva / 1000 / rating_b * 100
        else:
            loading_pct_b = 0

        if rating_c > 0:
            loading_pct_c = s_mva * base_kva / 1000 / rating_c * 100
        else:
            loading_pct_c = 0

        branch_flows.append({
            'name': br_name,
            'from': br['FromBusName'].strip(),
            'to': br['ToBusName'].strip(),
            'circuit': br['Circuit'],
            'p_mw': p_from * base_kva / 1000,
            'q_mvar': q_from * base_kva / 1000,
            's_mva': s_mva * base_kva / 1000,
            'rating_mva': rating_mva,
            'loading_pct': loading_pct,
            'rating_mva_b': rating_b if rating_b > 0 else None,
            'loading_pct_b': loading_pct_b if rating_b > 0 else 0,
            'rating_mva_c': rating_c if rating_c > 0 else None,
            'loading_pct_c': loading_pct_c if rating_c > 0 else 0,
            'is_xfmr': is_xfmr,
        })

    branch_flows.sort(key=lambda x: x['loading_pct'] if x.get('rating_mva') else 0, reverse=True)

    for bf in branch_flows:
        pct = bf['loading_pct']
        if pct > overload_pct:
            overloaded.append(bf)
        elif pct > heavy_pct:
            heavily_loaded.append(bf)
        elif pct > moderate_pct:
            moderate_loaded.append(bf)

        pct_b = bf['loading_pct_b']
        if pct_b > overload_pct and bf['rating_mva_b'] is not None:
            overloaded_b.append(bf)
        elif pct_b > heavy_pct and bf['rating_mva_b'] is not None:
            heavy_loaded_b.append(bf)

    has_ratings = any(b['rating_mva'] is not None and b['rating_mva'] > 0 for b in branch_flows)
    has_ratings_b = any(b['rating_mva_b'] is not None for b in branch_flows)
    has_ratings_c = any(b['rating_mva_c'] is not None for b in branch_flows)
    n_xfmr = sum(1 for b in branch_flows if b['is_xfmr'])

    return {
        'top_5': branch_flows[:5],
        'heavily_loaded': heavily_loaded,
        'overloaded': overloaded,
        'moderate_loaded': moderate_loaded,
        'overloaded_b': overloaded_b,
        'heavy_loaded_b': heavy_loaded_b,
        'has_ratings': has_ratings,
        'has_ratings_b': has_ratings_b,
        'has_ratings_c': has_ratings_c,
        'branches_with_ratings': sum(1 for b in branch_flows if b['rating_mva'] is not None and b['rating_mva'] > 0),
        'branches_with_ratings_b': sum(1 for b in branch_flows if b['rating_mva_b'] is not None),
        'branches_with_ratings_c': sum(1 for b in branch_flows if b['rating_mva_c'] is not None),
        'total_branches': len(branch_flows),
        'total_transformers': n_xfmr,
        'total_lines': len(branch_flows) - n_xfmr,
    }


def analyze_generator_q_limits(gens, cfg=None):
    """Check generator reactive power limit compliance."""
    if cfg is None:
        cfg = CFG
    at_limit_margin = cfg["generator"]["q_at_limit_margin"]

    violations = []
    at_limit = []

    for gen in gens:
        q = float(gen['QGen'])
        qmax = float(gen['QMax'])
        qmin = float(gen['QMin'])
        p = float(gen['PGen'])
        bus = gen['BusNumber']
        name = gen['BusName'].strip()

        if p == 0 and qmax == 0 and qmin == 0:
            continue
        if qmax == 0 and qmin == 0:
            continue

        margin_upper = qmax - q
        margin_lower = q - qmin

        fp_tol = cfg["generator"].get("q_fp_tol", 0.001)

        if (q > qmax and q - qmax >= fp_tol) or (q < qmin and qmin - q >= fp_tol):
            violations.append({
                'bus': bus, 'name': name, 'q': q, 'qmax': qmax, 'qmin': qmin,
                'margin': margin_upper if q > qmax else margin_lower
            })
        elif (abs(margin_upper) < at_limit_margin or abs(margin_lower) < at_limit_margin
              or (q > qmax and q - qmax < fp_tol)
              or (q < qmin and qmin - q < fp_tol)):
            at_limit.append({
                'bus': bus, 'name': name, 'q': q, 'qmax': qmax, 'qmin': qmin,
            })

    return {
        'violations': violations,
        'at_limit': at_limit,
        'total_gens': sum(1 for g in gens if float(g['PGen']) != 0 or
                         (float(g['QMax']) != 0 and float(g['QMin']) != 0))
    }


# --- Markdown helpers --------------------------------------------------------

def _md_table_row(*cells):
    """Format a Markdown table row."""
    return "| " + " | ".join(str(c) for c in cells) + " |"


def _md_table_sep(ncols):
    """Format a Markdown table separator row."""
    return "|" + "|".join(" --- " for _ in range(ncols)) + "|"


def _status_badge(passed):
    """Return a pass/fail badge string."""
    return "**PASS**" if passed else "**FAIL**"
