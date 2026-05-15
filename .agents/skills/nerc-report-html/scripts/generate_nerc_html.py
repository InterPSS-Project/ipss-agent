#!/usr/bin/env python3
"""Generate an interactive Plotly HTML dashboard for InterPSS NERC TPL results."""

from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


BASE_MVA = 100.0


def fnum(value, default=0.0):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def bval(value):
    return str(value).strip().lower() == "true"


def roundn(value, ndigits=3):
    try:
        return round(float(value), ndigits)
    except Exception:
        return None


def slugify(text):
    text = re.sub(r"[^A-Za-z0-9]+", "_", text).strip("_")
    return text or "NERC_TPL_001_5"


def md_field(markdown, name):
    match = re.search(rf"\| \*\*{re.escape(name)}\*\* \| (.*?) \|", markdown)
    if not match:
        return ""
    return re.sub(r"[`*]", "", match.group(1)).strip()


def resolve_input(path: Path):
    if path.is_dir():
        report = path / "NERC_TPL_001_5_Report.md"
        result_dir = path
    else:
        report = path
        result_dir = path.parent
    if not report.exists():
        raise FileNotFoundError(f"Cannot find NERC report: {report}")
    return report, result_dir


def find_csv(result_dir: Path, suffix: str):
    matches = sorted(result_dir.glob(f"*{suffix}"))
    return matches[0] if matches else None


def read_csv(path):
    if not path or not path.exists():
        return []
    with path.open(newline="", errors="replace") as fh:
        return list(csv.DictReader(fh))


def build_data(report_path: Path, result_dir: Path):
    markdown = report_path.read_text(errors="replace")
    system = md_field(markdown, "System") or result_dir.parent.name or "InterPSS Study"
    p0_status = md_field(markdown, "P0 Status") or "UNKNOWN"
    base_mva = md_field(markdown, "Base MVA") or f"{BASE_MVA:g} MVA"
    report_date = md_field(markdown, "Report Date")
    files = {
        "bus": find_csv(result_dir, "_DF_bus.csv"),
        "branch": find_csv(result_dir, "_DF_branch.csv"),
        "gen": find_csv(result_dir, "_DF_gen.csv"),
        "load": find_csv(result_dir, "_DF_load.csv"),
        "contingency": find_csv(result_dir, "_DF_contingency.csv"),
    }

    bus_rows = []
    low_rows = []
    high_rows = []
    area_stats = defaultdict(lambda: {"buses": 0, "low": 0, "marginal": 0, "minV": 999.0, "loadP": 0.0, "genP": 0.0})
    voltage_vals = []
    for row in read_csv(files["bus"]):
        if not bval(row.get("InService")):
            continue
        v = fnum(row.get("VoltMag"))
        area = row.get("AreaName") or f"Area {row.get('AreaNum', '')}".strip()
        item = {
            "id": row.get("ID", ""),
            "num": int(fnum(row.get("Number"))),
            "name": row.get("Name", ""),
            "area": area,
            "type": row.get("BusType", ""),
            "kv": round(fnum(row.get("NomVolt")) / 1000.0, 1),
            "v": round(v, 5),
            "angle": roundn(row.get("VoltAng"), 3),
            "loadP": roundn(fnum(row.get("LoadP")) * BASE_MVA, 2),
            "loadQ": roundn(fnum(row.get("LoadQ")) * BASE_MVA, 2),
            "genP": roundn(fnum(row.get("GenP")) * BASE_MVA, 2),
            "genQ": roundn(fnum(row.get("GenQ")) * BASE_MVA, 2),
        }
        bus_rows.append(item)
        voltage_vals.append(v)
        stats = area_stats[area]
        stats["buses"] += 1
        stats["loadP"] += item["loadP"] or 0.0
        stats["genP"] += item["genP"] or 0.0
        stats["minV"] = min(stats["minV"], v)
        if v < 0.95:
            stats["low"] += 1
            low_rows.append(item)
        elif v > 1.05:
            high_rows.append(item)
        elif v < 0.98:
            stats["marginal"] += 1
    low_rows.sort(key=lambda x: x["v"])
    high_rows.sort(key=lambda x: x["v"], reverse=True)
    area_rows = [
        {
            "area": area,
            "buses": stats["buses"],
            "low": stats["low"],
            "marginal": stats["marginal"],
            "lowPct": round(100.0 * stats["low"] / stats["buses"], 2) if stats["buses"] else 0.0,
            "minV": round(stats["minV"], 5) if stats["minV"] < 999 else None,
            "loadP": round(stats["loadP"], 2),
            "genP": round(stats["genP"], 2),
        }
        for area, stats in area_stats.items()
    ]
    area_rows.sort(key=lambda x: (x["low"], x["lowPct"]), reverse=True)

    branch_high = []
    branch_plot = []
    branch_hist = []
    branch_types = Counter()
    for row in read_csv(files["branch"]):
        if not bval(row.get("InService")):
            continue
        loading = fnum(row.get("Loading%"))
        branch_hist.append(round(loading, 2))
        branch_type = "Transformer" if bval(row.get("IsXfmr")) else "Line"
        branch_types[branch_type] += 1
        item = {
            "id": row.get("ID", ""),
            "from": row.get("FromBusID", ""),
            "fromName": row.get("FromBusName", ""),
            "to": row.get("ToBusID", ""),
            "toName": row.get("ToBusName", ""),
            "type": branch_type,
            "ratingA": roundn(row.get("LimMvaA"), 2),
            "flow": roundn(row.get("Flow@FromSide"), 2),
            "loading": round(loading, 2),
            "circuit": row.get("Circuit", ""),
        }
        if loading >= 50:
            branch_plot.append(item)
        if loading >= 80:
            branch_high.append(item)
    branch_plot.sort(key=lambda x: x["loading"], reverse=True)
    branch_high.sort(key=lambda x: x["loading"], reverse=True)

    gen_rows = []
    q_rows = []
    for row in read_csv(files["gen"]):
        if not bval(row.get("InService")):
            continue
        q = fnum(row.get("QGen"))
        qmax = fnum(row.get("QMax"))
        qmin = fnum(row.get("QMin"))
        margin_max = qmax - q
        margin_min = q - qmin
        at_max = abs(margin_max) <= 1e-3 or q > qmax
        at_min = abs(margin_min) <= 1e-3 or q < qmin
        violation = max(q - qmax, qmin - q, 0.0)
        item = {
            "bus": row.get("BusID", ""),
            "busNum": int(fnum(row.get("BusNumber"))),
            "plant": row.get("BusName", ""),
            "gen": row.get("GenName") or row.get("GenID", ""),
            "area": row.get("AreaName") or f"Area {row.get('AreaNum', '')}".strip(),
            "vsched": roundn(row.get("VSched"), 4),
            "p": roundn(fnum(row.get("PGen")) * BASE_MVA, 2),
            "q": roundn(q * BASE_MVA, 2),
            "qmax": roundn(qmax * BASE_MVA, 2),
            "qmin": roundn(qmin * BASE_MVA, 2),
            "atLimit": at_max or at_min,
            "violation": round(violation * BASE_MVA, 3),
            "limitSide": "Qmax" if at_max else ("Qmin" if at_min else "Inside"),
        }
        gen_rows.append(item)
        if item["atLimit"] or item["violation"] > 0:
            q_rows.append(item)
    q_rows.sort(key=lambda x: (x["violation"], abs(x["q"] or 0)), reverse=True)

    cont_rows = []
    for row in read_csv(files["contingency"]):
        loading = fnum(row.get("LoadingPercent"))
        cont_rows.append(
            {
                "branch": row.get("BranchID", ""),
                "type": "Transformer" if bval(row.get("IsXfmr")) else "Line",
                "contingency": row.get("ContingencyName", ""),
                "outage": row.get("OutageBranchId", ""),
                "baseMW": roundn(row.get("BasecaseFlowMW"), 2),
                "postMW": roundn(row.get("PostFlowMW"), 2),
                "ratingMW": roundn(row.get("LineRatingMW"), 2),
                "loading": round(loading, 2),
            }
        )
    cont_rows.sort(key=lambda x: x["loading"], reverse=True)
    cont_over = [r for r in cont_rows if r["loading"] > 100.0]
    cont_severe = [r for r in cont_rows if r["loading"] > 120.0]

    voltage_bands = [
        {"band": "<0.90", "count": sum(1 for v in voltage_vals if v < 0.90), "status": "Extreme low"},
        {"band": "0.90-0.95", "count": sum(1 for v in voltage_vals if 0.90 <= v < 0.95), "status": "Low violation"},
        {"band": "0.95-0.98", "count": sum(1 for v in voltage_vals if 0.95 <= v < 0.98), "status": "Marginal low"},
        {"band": "0.98-1.02", "count": sum(1 for v in voltage_vals if 0.98 <= v < 1.02), "status": "Nominal"},
        {"band": "1.02-1.05", "count": sum(1 for v in voltage_vals if 1.02 <= v <= 1.05), "status": "High acceptable"},
        {"band": ">1.05", "count": sum(1 for v in voltage_vals if v > 1.05), "status": "High violation"},
    ]

    metrics = {
        "activeBuses": len(bus_rows),
        "activeBranches": len(branch_hist),
        "totalGenMW": round(sum((r["genP"] or 0.0) for r in bus_rows), 2),
        "totalLoadMW": round(sum((r["loadP"] or 0.0) for r in bus_rows), 2),
        "lowVoltage": len(low_rows),
        "highVoltage": len(high_rows),
        "marginalVoltage": sum(1 for v in voltage_vals if 0.95 <= v < 0.98),
        "baseOverloads": sum(1 for v in branch_hist if v > 100.0),
        "branchAbove80": len(branch_high),
        "generators": len(gen_rows),
        "genAtLimit": sum(1 for r in gen_rows if r["atLimit"]),
        "genViolations": sum(1 for r in gen_rows if r["violation"] > 0),
        "contingencyRows": len(cont_rows),
        "p1Overloads": len(cont_over),
        "p1Severe": len(cont_severe),
        "uniqueContingencies": len({r["contingency"] for r in cont_rows if r["contingency"]}),
    }

    missing = [name for name, path in files.items() if path is None and name != "load"]
    return {
        "report": {
            "system": system,
            "baseMva": base_mva,
            "date": report_date,
            "p0Status": p0_status,
            "source": str(result_dir),
            "note": "Dashboard plots and filter tables are derived from InterPSS CSV outputs. The compliance verdict is from the Markdown report; CSV-derived row counts may differ from report summary counts when additional filtering or grouping is applied.",
            "missing": missing,
        },
        "metrics": metrics,
        "voltageBands": voltage_bands,
        "areaRows": area_rows,
        "busScatter": bus_rows[:: max(1, len(bus_rows) // 25000)] if len(bus_rows) > 25000 else bus_rows,
        "lowVoltageRows": low_rows,
        "highVoltageRows": high_rows,
        "branchHighRows": branch_high,
        "branchPlot": branch_plot[:5000],
        "branchHist": branch_hist,
        "branchTypeCounts": dict(branch_types),
        "qRows": q_rows,
        "genRows": gen_rows[:6000],
        "contRows": cont_rows,
    }


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NERC TPL-001-5 Interactive Report</title>
  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
  <style>
    :root { --navy:#17324d; --steel:#2f6f9f; --graphite:#2b2f33; --muted:#637181; --line:#d8e0e7; --light:#f4f7fa; --amber:#c88419; --red:#b13a32; --green:#2d7a4d; }
    * { box-sizing:border-box; } body { margin:0; font-family:Arial, Helvetica, sans-serif; color:var(--graphite); background:white; }
    header { background:var(--navy); color:white; padding:26px 34px 22px; border-bottom:6px solid var(--steel); }
    header h1 { margin:0; font-size:28px; line-height:1.15; } header p { margin:10px 0 0; color:#dceaf5; font-size:14px; max-width:1080px; }
    main { padding:24px 34px 44px; max-width:1440px; margin:0 auto; }
    .toolbar { display:flex; gap:12px; flex-wrap:wrap; align-items:end; padding:14px; border:1px solid var(--line); background:var(--light); margin-bottom:20px; }
    label { display:block; font-size:11px; color:var(--muted); font-weight:700; margin-bottom:6px; text-transform:uppercase; }
    select,input { height:34px; border:1px solid #b9c5d0; padding:6px 9px; background:white; color:var(--graphite); min-width:150px; }
    button { height:34px; border:1px solid var(--navy); background:var(--navy); color:white; padding:0 12px; font-weight:700; cursor:pointer; }
    button.secondary { background:white; color:var(--navy); } .grid { display:grid; gap:16px; } .kpis { grid-template-columns:repeat(6,minmax(130px,1fr)); } .two { grid-template-columns:minmax(0,1fr) minmax(0,1fr); }
    .card { border:1px solid var(--line); background:white; padding:16px; min-width:0; } .card h2,.card h3 { margin:0 0 10px; color:var(--navy); } .card h3 { font-size:16px; }
    .kpi { border-top:5px solid var(--steel); min-height:96px; } .kpi.fail { border-top-color:var(--red); } .kpi.warn { border-top-color:var(--amber); } .kpi.pass { border-top-color:var(--green); }
    .kpi .value { font-size:26px; color:var(--navy); font-weight:800; line-height:1.1; } .kpi .label { font-size:12px; color:var(--muted); margin-top:8px; }
    .section { margin-top:28px; } .section-title { display:flex; justify-content:space-between; gap:14px; align-items:flex-end; border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:14px; }
    .section-title h2 { margin:0; color:var(--navy); font-size:22px; } .section-title p { margin:0; color:var(--muted); font-size:13px; max-width:760px; }
    .plot { width:100%; height:390px; } .plot.short { height:320px; } table { width:100%; border-collapse:collapse; font-size:12px; }
    th { text-align:left; color:white; background:var(--navy); padding:8px; position:sticky; top:0; z-index:1; } td { border-bottom:1px solid var(--line); padding:7px 8px; vertical-align:top; } tr:nth-child(even) td { background:#f7f9fb; }
    .table-wrap { max-height:430px; overflow:auto; border:1px solid var(--line); } .pill { display:inline-block; padding:3px 8px; border:1px solid var(--line); font-size:11px; color:var(--muted); margin-left:6px; }
    .notice { display:none; background:#fff8ee; border:1px solid #e7c894; color:#5f430e; padding:12px; margin-bottom:16px; }
    @media (max-width:980px) { .kpis,.two { grid-template-columns:1fr; } main { padding:18px; } header { padding:22px 18px; } .plot { height:340px; } }
  </style>
</head>
<body>
  <header><h1 id="title">NERC TPL-001-5 Interactive Report</h1><p id="subtitle"></p><p id="sourceNote"></p></header>
  <main>
    <div id="plotlyNotice" class="notice">Plotly did not load. Connect to the network or replace the CDN script with a local Plotly bundle to enable charts; tables and filters still work.</div>
    <div class="toolbar">
      <div><label>Area</label><select id="areaFilter"><option value="__all__">All areas</option></select></div>
      <div><label>Low voltage max</label><input id="voltageMax" type="number" step="0.01" value="0.95" /></div>
      <div><label>High voltage min</label><input id="voltageHighMin" type="number" step="0.01" value="1.05" /></div>
      <div><label>Branch loading min %</label><input id="branchMin" type="number" step="1" value="80" /></div>
      <div><label>P1 loading min %</label><input id="contMin" type="number" step="1" value="100" /></div>
      <div><label>Search tables</label><input id="searchBox" type="search" placeholder="Bus, area, branch, outage..." /></div>
      <button id="applyBtn">Apply filters</button><button class="secondary" id="resetBtn">Reset</button>
    </div>
    <section class="grid kpis" id="kpis"></section>
    <section class="section"><div class="section-title"><h2>Executive Assessment</h2><p>Combines the Markdown compliance report with InterPSS CSV outputs for screening and triage.</p></div><div class="grid two"><div class="card"><h3>Compliance Summary</h3><div id="compliancePlot" class="plot short"></div></div><div class="card"><h3>Area Exposure</h3><div id="areaPlot" class="plot short"></div></div></div></section>
    <section class="section"><div class="section-title"><h2>P0 Voltage Profile</h2><p>Filter by area and voltage thresholds to isolate weak low-voltage and high-voltage pockets.</p></div><div class="grid two"><div class="card"><h3>Voltage Distribution</h3><div id="voltageBandPlot" class="plot"></div></div><div class="card"><h3>Bus Voltage Scatter</h3><div id="busScatterPlot" class="plot"></div></div></div><div class="grid two" style="margin-top:16px"><div class="card"><h3>Filtered Low-Voltage Buses <span class="pill" id="busCount"></span></h3><div class="table-wrap"><table id="busTable"></table></div><button class="secondary" data-load="bus" style="margin-top:10px">Load more low-voltage buses</button></div><div class="card"><h3>Filtered High-Voltage Violation Buses <span class="pill" id="highBusCount"></span></h3><div class="table-wrap"><table id="highBusTable"></table></div><button class="secondary" data-load="highBus" style="margin-top:10px">Load more high-voltage buses</button></div></div></section>
    <section class="section"><div class="section-title"><h2>P0 Thermal Loading</h2><p>Base-case high-utilization branches for sensitivity and mitigation review.</p></div><div class="grid two"><div class="card"><h3>Branch Loading Histogram</h3><div id="branchHistPlot" class="plot"></div></div><div class="card"><h3>Top Base-Case Loading</h3><div id="branchTopPlot" class="plot"></div></div></div><div class="card" style="margin-top:16px"><h3>Filtered High-Loading Branches <span class="pill" id="branchCount"></span></h3><div class="table-wrap"><table id="branchTable"></table></div><button class="secondary" data-load="branch" style="margin-top:10px">Load more branches</button></div></section>
    <section class="section"><div class="section-title"><h2>Generator Reactive Capability</h2><p>Q-limit rows identify plants at reactive bounds or violating capability limits.</p></div><div class="grid two"><div class="card"><h3>Generator Q vs Limits</h3><div id="genQPlot" class="plot"></div></div><div class="card"><h3>Q-Limit Side</h3><div id="qSidePlot" class="plot"></div></div></div><div class="card" style="margin-top:16px"><h3>Filtered Generator Q-Limit Rows <span class="pill" id="qCount"></span></h3><div class="table-wrap"><table id="qTable"></table></div><button class="secondary" data-load="q" style="margin-top:10px">Load more generators</button></div></section>
    <section class="section"><div class="section-title"><h2>P1 Contingency Thermal Screening</h2><p>Use the loading threshold and search box to triage monitored-element/outage pairs.</p></div><div class="grid two"><div class="card"><h3>Post-Contingency Loading</h3><div id="contHistPlot" class="plot"></div></div><div class="card"><h3>Worst P1 Overloads</h3><div id="contTopPlot" class="plot"></div></div></div><div class="card" style="margin-top:16px"><h3>Filtered P1 Contingency Records <span class="pill" id="contCount"></span></h3><div class="table-wrap"><table id="contTable"></table></div><button class="secondary" data-load="cont" style="margin-top:10px">Load more contingencies</button></div></section>
  </main>
  <script id="report-data" type="application/json">__DATA__</script>
  <script>
  const DATA = JSON.parse(document.getElementById('report-data').textContent);
  const PAGE = { bus:80, highBus:80, branch:80, q:80, cont:80 };
  const colors = { navy:'#17324d', steel:'#2f6f9f', graphite:'#2b2f33', muted:'#637181', line:'#d8e0e7', light:'#f4f7fa', amber:'#c88419', red:'#b13a32', green:'#2d7a4d' };
  const plotLayout = { margin:{l:56,r:18,t:18,b:58}, paper_bgcolor:'#fff', plot_bgcolor:'#fff', font:{family:'Arial, Helvetica, sans-serif', color:colors.graphite}, xaxis:{gridcolor:'#edf1f5'}, yaxis:{gridcolor:'#edf1f5'} };
  const $ = id => document.getElementById(id);
  function fmt(n,d=0){ if(n===null||n===undefined||Number.isNaN(Number(n))) return ''; return Number(n).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d}); }
  function searchMatch(row,q){ return !q || Object.values(row).join(' ').toLowerCase().includes(q.toLowerCase()); }
  function areaOk(row){ const a=$('areaFilter').value; return a==='__all__'||row.area===a; }
  function hasPlotly(){ return !!window.Plotly; }
  function plot(id,traces,layout){
    if(!hasPlotly()) return;
    try {
      Plotly.react(id,traces,{...plotLayout,...layout},{displayModeBar:true,responsive:true});
    } catch (err) {
      console.warn('Plot update failed for '+id, err);
    }
  }
  function setTable(id,cols,rows,limit){ const table=document.getElementById(id); table.innerHTML='<thead><tr>'+cols.map(c=>`<th>${c.label}</th>`).join('')+'</tr></thead><tbody>'+rows.slice(0,limit).map(r=>'<tr>'+cols.map(c=>`<td>${c.f?c.f(r[c.key],r):(r[c.key]??'')}</td>`).join('')+'</tr>').join('')+'</tbody>'; }
  function init(){
    $('title').textContent=DATA.report.system+' | NERC TPL-001-5 Interactive Report';
    $('subtitle').textContent=`${DATA.report.baseMva} | ${DATA.report.date || 'report date unavailable'} | P0 ${DATA.report.p0Status} | Source: ${DATA.report.source}`;
    $('sourceNote').textContent=DATA.report.note+(DATA.report.missing.length?` Missing optional files: ${DATA.report.missing.join(', ')}.`:'');
    [...new Set(DATA.areaRows.map(r=>r.area))].sort().forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; $('areaFilter').appendChild(o); });
    const k=DATA.metrics;
    const kpiRows=[['P0 Status',DATA.report.p0Status,'fail'],['Active Buses',fmt(k.activeBuses),''],['Active Branches',fmt(k.activeBranches),''],['CSV Low Voltage Buses',fmt(k.lowVoltage),'fail'],['CSV High Voltage Buses',fmt(k.highVoltage),'fail'],['Gen Q Violations',fmt(k.genViolations),'fail'],['P1 Overloads',fmt(k.p1Overloads),'fail'],['Marginal Low Buses',fmt(k.marginalVoltage),'warn'],['Branches >80%',fmt(k.branchAbove80),'warn'],['Base Overloads',fmt(k.baseOverloads),k.baseOverloads?'fail':'pass'],['P1 Severe >120%',fmt(k.p1Severe),'fail'],['Total Load MW',fmt(k.totalLoadMW,1),'']];
    $('kpis').innerHTML=kpiRows.map(([label,value,cls])=>`<div class="card kpi ${cls}"><div class="value">${value}</div><div class="label">${label}</div></div>`).join('');
    if(!hasPlotly()) $('plotlyNotice').style.display='block';
    $('applyBtn').addEventListener('click',render); $('resetBtn').addEventListener('click',()=>{ $('areaFilter').value='__all__'; $('voltageMax').value='0.95'; $('voltageHighMin').value='1.05'; $('branchMin').value='80'; $('contMin').value='100'; $('searchBox').value=''; PAGE.bus=PAGE.highBus=PAGE.branch=PAGE.q=PAGE.cont=80; render(); });
    document.querySelectorAll('[data-load]').forEach(btn=>btn.addEventListener('click',()=>{ PAGE[btn.dataset.load]+=120; renderTables(); }));
    ['areaFilter','voltageMax','voltageHighMin','branchMin','contMin'].forEach(id=>document.getElementById(id).addEventListener('change',render));
    $('searchBox').addEventListener('input',()=>{ PAGE.bus=PAGE.highBus=PAGE.branch=PAGE.q=PAGE.cont=80; render(); });
    render();
  }
  function filtered(){ const q=$('searchBox').value.trim(), vmax=Number($('voltageMax').value||0.95), vhigh=Number($('voltageHighMin').value||1.05), bmin=Number($('branchMin').value||80), cmin=Number($('contMin').value||100); return { bus:DATA.lowVoltageRows.filter(r=>areaOk(r)&&r.v<=vmax&&searchMatch(r,q)), highBus:DATA.highVoltageRows.filter(r=>areaOk(r)&&r.v>=vhigh&&searchMatch(r,q)), busScatter:DATA.busScatter.filter(r=>areaOk(r)&&searchMatch(r,q)), branch:DATA.branchHighRows.filter(r=>r.loading>=bmin&&searchMatch(r,q)), q:DATA.qRows.filter(r=>areaOk(r)&&searchMatch(r,q)), gen:DATA.genRows.filter(r=>areaOk(r)&&searchMatch(r,q)), cont:DATA.contRows.filter(r=>r.loading>=cmin&&searchMatch(r,q)) }; }
  function render(){ renderTables(); renderPlots(); }
  function renderPlots(){
    const f=filtered();
    plot('compliancePlot',[{type:'bar',orientation:'h',x:[DATA.metrics.lowVoltage+DATA.metrics.highVoltage,DATA.metrics.genViolations,DATA.metrics.p1Overloads,DATA.metrics.baseOverloads],y:['P0 voltage','Gen Q','P1 thermal','P0 thermal'],marker:{color:[colors.red,colors.red,colors.red,colors.green]},hovertemplate:'%{y}: %{x:,}<extra></extra>'}],{height:320,xaxis:{title:'Findings count'},yaxis:{automargin:true}});
    const topAreas=DATA.areaRows.slice(0,15).reverse(); plot('areaPlot',[{type:'bar',orientation:'h',x:topAreas.map(r=>r.low),y:topAreas.map(r=>r.area),marker:{color:colors.red},customdata:topAreas.map(r=>[r.lowPct,r.minV]),hovertemplate:'%{y}<br>Low buses: %{x:,}<br>Low pct: %{customdata[0]}%<br>Min V: %{customdata[1]}<extra></extra>'}],{height:320,xaxis:{title:'Low-voltage buses'},yaxis:{automargin:true}});
    plot('voltageBandPlot',[{type:'bar',x:DATA.voltageBands.map(r=>r.band),y:DATA.voltageBands.map(r=>r.count),marker:{color:[colors.red,colors.red,colors.amber,colors.green,colors.steel,colors.red]},customdata:DATA.voltageBands.map(r=>r.status),hovertemplate:'%{x}<br>%{y:,} buses<br>%{customdata}<extra></extra>'}],{yaxis:{title:'Bus count'},xaxis:{title:'Voltage band'}});
    plot('busScatterPlot',[{type:'scattergl',mode:'markers',x:f.busScatter.map(r=>r.num),y:f.busScatter.map(r=>r.v),text:f.busScatter.map(r=>`${r.id} ${r.name}<br>${r.area}<br>${r.kv} kV`),marker:{size:5,color:f.busScatter.map(r=>r.v),colorscale:[[0,colors.red],[0.5,colors.amber],[1,colors.steel]],cmin:0.9,cmax:1.05,colorbar:{title:'V pu'}},hovertemplate:'%{text}<br>V=%{y:.4f}<extra></extra>'}],{yaxis:{title:'Voltage pu'},xaxis:{title:'Bus number'},shapes:[{type:'line',xref:'paper',x0:0,x1:1,y0:.95,y1:.95,line:{color:colors.red,dash:'dash'}},{type:'line',xref:'paper',x0:0,x1:1,y0:1.05,y1:1.05,line:{color:colors.red,dash:'dash'}}]});
    plot('branchHistPlot',[{type:'histogram',x:DATA.branchHist,nbinsx:50,marker:{color:colors.steel},hovertemplate:'Loading %{x:.1f}%<br>Count %{y:,}<extra></extra>'}],{xaxis:{title:'Loading %'},yaxis:{title:'Branch count'},shapes:[{type:'line',yref:'paper',y0:0,y1:1,x0:80,x1:80,line:{color:colors.amber,dash:'dash'}},{type:'line',yref:'paper',y0:0,y1:1,x0:100,x1:100,line:{color:colors.red,dash:'dash'}}]});
    const topBranch=f.branch.slice(0,15).reverse(); plot('branchTopPlot',[{type:'bar',orientation:'h',x:topBranch.map(r=>r.loading),y:topBranch.map(r=>r.id),marker:{color:colors.amber},hovertemplate:'%{y}<br>%{x:.1f}%<extra></extra>'}],{xaxis:{title:'Loading %'},yaxis:{automargin:true}});
    const genSample=f.gen.slice(0,3000); plot('genQPlot',[{type:'scattergl',mode:'markers',x:genSample.map(r=>r.qmax),y:genSample.map(r=>r.q),text:genSample.map(r=>`${r.plant} ${r.gen}<br>${r.area}`),marker:{size:6,color:genSample.map(r=>r.violation>0?2:(r.atLimit?1:0)),colorscale:[[0,colors.steel],[0.5,colors.amber],[1,colors.red]],cmin:0,cmax:2},hovertemplate:'%{text}<br>Q=%{y:.2f}<br>Qmax=%{x:.2f}<extra></extra>'}],{xaxis:{title:'Qmax MVAr'},yaxis:{title:'QGen MVAr'}});
    const qSide=['Qmax','Qmin','Inside'].map(side=>({side,count:f.q.filter(r=>r.limitSide===side).length})); plot('qSidePlot',[{type:'pie',labels:qSide.map(r=>r.side),values:qSide.map(r=>r.count),marker:{colors:[colors.red,colors.amber,colors.steel]},hole:.45,hovertemplate:'%{label}: %{value:,}<extra></extra>'}],{height:390,showlegend:true});
    plot('contHistPlot',[{type:'histogram',x:DATA.contRows.map(r=>r.loading),nbinsx:40,marker:{color:colors.red},hovertemplate:'Loading %{x:.1f}%<br>Count %{y:,}<extra></extra>'}],{xaxis:{title:'Post-contingency loading %'},yaxis:{title:'Record count'},shapes:[{type:'line',yref:'paper',y0:0,y1:1,x0:100,x1:100,line:{color:colors.red,dash:'dash'}},{type:'line',yref:'paper',y0:0,y1:1,x0:120,x1:120,line:{color:colors.amber,dash:'dash'}}]});
    const topCont=f.cont.slice(0,15).reverse(); plot('contTopPlot',[{type:'bar',orientation:'h',x:topCont.map(r=>r.loading),y:topCont.map(r=>r.branch),text:topCont.map(r=>r.outage),marker:{color:colors.red},hovertemplate:'Monitored %{y}<br>Outage %{text}<br>%{x:.1f}%<extra></extra>'}],{xaxis:{title:'Loading %'},yaxis:{automargin:true}});
  }
  function renderTables(){
    const f=filtered(); $('busCount').textContent=`${fmt(f.bus.length)} rows`; $('highBusCount').textContent=`${fmt(f.highBus.length)} rows`; $('branchCount').textContent=`${fmt(f.branch.length)} rows`; $('qCount').textContent=`${fmt(f.q.length)} rows`; $('contCount').textContent=`${fmt(f.cont.length)} rows`;
    setTable('busTable',[{label:'Bus',key:'id'},{label:'Name',key:'name'},{label:'Area',key:'area'},{label:'Type',key:'type'},{label:'kV',key:'kv'},{label:'Voltage pu',key:'v',f:v=>fmt(v,4)},{label:'Load MW',key:'loadP',f:v=>fmt(v,2)},{label:'Gen MW',key:'genP',f:v=>fmt(v,2)}],f.bus,PAGE.bus);
    setTable('highBusTable',[{label:'Bus',key:'id'},{label:'Name',key:'name'},{label:'Area',key:'area'},{label:'Type',key:'type'},{label:'kV',key:'kv'},{label:'Voltage pu',key:'v',f:v=>fmt(v,4)},{label:'Load MW',key:'loadP',f:v=>fmt(v,2)},{label:'Gen MW',key:'genP',f:v=>fmt(v,2)}],f.highBus,PAGE.highBus);
    setTable('branchTable',[{label:'Branch',key:'id'},{label:'From',key:'fromName'},{label:'To',key:'toName'},{label:'Type',key:'type'},{label:'Rate A',key:'ratingA',f:v=>fmt(v,1)},{label:'Flow',key:'flow',f:v=>fmt(v,1)},{label:'Loading %',key:'loading',f:v=>fmt(v,2)}],f.branch,PAGE.branch);
    setTable('qTable',[{label:'Plant',key:'plant'},{label:'Bus',key:'bus'},{label:'Area',key:'area'},{label:'Gen',key:'gen'},{label:'Q',key:'q',f:v=>fmt(v,2)},{label:'Qmax',key:'qmax',f:v=>fmt(v,2)},{label:'Qmin',key:'qmin',f:v=>fmt(v,2)},{label:'Side',key:'limitSide'},{label:'Violation',key:'violation',f:v=>fmt(v,3)}],f.q,PAGE.q);
    setTable('contTable',[{label:'Monitored Branch',key:'branch'},{label:'Outage',key:'outage'},{label:'Type',key:'type'},{label:'Base MW',key:'baseMW',f:v=>fmt(v,1)},{label:'Post MW',key:'postMW',f:v=>fmt(v,1)},{label:'Rating MW',key:'ratingMW',f:v=>fmt(v,1)},{label:'Loading %',key:'loading',f:v=>fmt(v,2)}],f.cont,PAGE.cont);
  }
  init();
  </script>
</body>
</html>
"""


def write_html(data, output: Path):
    payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False).replace("</script>", "<\\/script>")
    output.write_text(HTML_TEMPLATE.replace("__DATA__", payload), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Generate interactive HTML dashboard from InterPSS NERC TPL report outputs.")
    parser.add_argument("input", help="Path to NERC_TPL_001_5_Report.md or its result directory")
    parser.add_argument("--out", help="Output HTML path. Defaults beside report.")
    args = parser.parse_args()

    report_path, result_dir = resolve_input(Path(args.input).expanduser().resolve())
    data = build_data(report_path, result_dir)
    case_slug = slugify(result_dir.parent.name if result_dir.name == "result" else data["report"]["system"])
    output = Path(args.out).expanduser().resolve() if args.out else result_dir / f"{case_slug}_NERC_TPL_001_5_Interactive_Report.html"
    write_html(data, output)
    print(json.dumps({
        "output": str(output),
        "bytes": output.stat().st_size,
        "system": data["report"]["system"],
        "p0Status": data["report"]["p0Status"],
        "metrics": data["metrics"],
        "missing": data["report"]["missing"],
    }, indent=2))


if __name__ == "__main__":
    main()
