#!/usr/bin/env python3
"""Generate a draw.io one-line diagram for an InterPSS case.

The diagram follows the visual language of wspace/template/oneline-diagram.drawio:

  * vertical bus bars (6 x 52) with a `Bus-N` label above the bar,
  * thin undirected black branches (no arrowheads, no edge annotations),
  * transformers drawn as two overlapping 16 x 16 rings (OO) on the branch,
  * a legend box on white paper.

That template is hand-laid for 14 buses; this script computes the layout, so it
covers cases far too large to place by hand (IEEE 118: 118 buses / 186
branches):

  1. all-pairs hop distances from the branch list,
  2. stress majorization (SMACOF) with target distances proportional to the hop
     distance -- graph distance becomes geometry, so a branch stays short,
  3. scale search + collision relaxation over each bus footprint (bar + label),
     so no two buses or labels overlap and the drawing stays as tight as it can,
  4. grid snap, then edge routing: straight by default, a short local "hop"
     around a bus bar only when the straight line would cut through one.

Deliverable, plus a raster preview built from the same geometry:

  <stem>-oneline.drawio         the diagram (draw.io / the InterPSS preview)
  <stem>-oneline-preview.png    approximate Pillow render for a quick look

Bus cells are `busN` and bus labels read `Bus-N` -- the two spellings the
InterPSS plugin's diagram preview resolves to a bus tooltip. A branch is either
one edge between two bus cells or two stub edges chained through a transformer
group cell, which is how the plugin pairs a transformer with its branch.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict, deque

import numpy as np

# --- template geometry ------------------------------------------------------
BUS_W, BUS_H = 6.0, 52.0
LABEL_W, LABEL_H = 46.0, 18.0
LABEL_GAP = 2.0
BOX_W = 52.0
BOX_H = LABEL_H + LABEL_GAP + BUS_H          # 72, exactly label + gap + bar
GRID = 10.0
BAND_H = 170.0                                # title/legend band above the network
XF_R = 16.0                                   # one transformer ring
XF_OVERLAP = 8.0                              # ring centre offset (rings interlock)
LINE_W = 1.5
BAR_FILL, BAR_STROKE = "#666666", "#333333"      # the template's single bar grey
BAR_STYLE = "rounded=0;fillColor={fill};strokeColor={stroke};"
EDGE_STYLE = "endArrow=none;html=1;rounded=0;strokeColor=#000000;strokeWidth=%g;" % LINE_W
XF_STYLE = "ellipse;fillColor=none;strokeColor=#000000;strokeWidth=%g;aspect=fixed;" % LINE_W
LABEL_STYLE = ("rounded=0;fillColor=#FFFFFF;strokeColor=none;html=1;align=center;verticalAlign=middle;"
               "fontSize=11;fontStyle=1;fontColor=#000000;")
TEXT_STYLE = "text;html=1;fontSize=%d;%sfontColor=%s;align=%s;verticalAlign=%s;"

# Every bus bar uses the template's single grey. The `Vn` suffix the IEEE names
# carry (`Olive V1`, `Rivrsde V2`, `Pinevlle V3`) is read only as text, for the
# subtitle -- never as a colour.
VOLT_BY_SUFFIX = {"V1": "345 kV", "V2": "138 kV", "V3": "161 kV"}


# --- case model -------------------------------------------------------------
class Bus:
    __slots__ = ("bus_id", "num", "name", "volt", "fill", "stroke", "btype",
                 "load_p", "gen_p", "xy", "bar_xy", "label_xy")

    def __init__(self, bus_id, num, name, volt, fill, stroke, btype, load_p, gen_p):
        self.bus_id, self.num, self.name = bus_id, num, name
        self.volt, self.fill, self.stroke = volt, fill, stroke
        self.btype, self.load_p, self.gen_p = btype, load_p, gen_p
        self.xy = (0.0, 0.0)
        self.bar_xy = (0.0, 0.0)
        self.label_xy = (0.0, 0.0)

    @property
    def key(self):
        return self.bus_id.lower()

    @property
    def bar_center(self):
        return (self.bar_xy[0] + BUS_W / 2.0, self.bar_xy[1] + BUS_H / 2.0)


class Branch:
    __slots__ = ("index", "fbus", "tbus", "is_xfmr", "circuit", "name")

    def __init__(self, index, fbus, tbus, is_xfmr, circuit, name):
        self.index, self.fbus, self.tbus = index, fbus, tbus
        self.is_xfmr, self.circuit, self.name = is_xfmr, circuit, name


def read_case(case_dir):
    res = os.path.join(case_dir, "result")
    buses_csv = branch_csv = None
    for fn in sorted(os.listdir(res)):
        if fn.endswith("_DF_bus.csv"):
            buses_csv = os.path.join(res, fn)
        elif fn.endswith("_DF_branch.csv"):
            branch_csv = os.path.join(res, fn)
    if buses_csv is None or branch_csv is None:
        sys.exit("no *_DF_bus.csv / *_DF_branch.csv under %s -- run ACLF first" % res)
    stem = os.path.basename(buses_csv)[: -len("_DF_bus.csv")]

    buses, by_id, nominal, anchor = [], {}, [], None
    with open(buses_csv, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            name = row["Name"].strip()
            tail = re.search(r"\b(V\d)\s*$", name)
            volt = VOLT_BY_SUFFIX.get(tail.group(1), "") if tail else ""
            b = Bus(row["ID"], int(row["Number"]), name, volt, BAR_FILL, BAR_STROKE,
                    row.get("BusType", ""), float(row.get("LoadP") or 0.0),
                    float(row.get("GenP") or 0.0))
            buses.append(b)
            by_id[b.key] = b
            nominal.append(row.get("NomVolt") or "")
            if anchor is None:
                anchor = b                       # the case's first bus -- the layout's upper-left
    if not any(b.volt for b in buses):
        # No `Vn` suffix in the names: fall back to the bus table's nominal voltage, which
        # some cases report in volts (132000 -> 132 kV) and others as a placeholder that is
        # not a voltage at all (the IEEE 118 tables say 1000). Only values from 10 kV up
        # are believed, and an unknown case simply carries no voltage text.
        for b, raw in zip(buses, nominal):
            try:
                v = float(raw)
            except (TypeError, ValueError):
                continue
            if v >= 10000.0:
                b.volt = "%g kV" % (v / 1000.0)
    buses.sort(key=lambda b: b.num)

    branches = []
    with open(branch_csv, newline="", encoding="utf-8-sig") as fh:
        for i, row in enumerate(csv.DictReader(fh)):
            f, t = by_id.get(row["FromBusID"].lower()), by_id.get(row["ToBusID"].lower())
            if f is None or t is None or f is t:
                continue
            branches.append(Branch(i, f, t, row["IsXfmr"].strip().lower() == "true",
                                   row.get("Circuit", "").strip(), row["ID"]))
    return stem, buses, branches, anchor


# --- layout (box units: one bus footprint = 1 x 1) --------------------------
TARGET = 1.22          # what the relaxation aims for: footprint + 22% gap
HARD = 1.02            # what must hold: footprints (and labels) never overlap


def hop_distances(n, adj):
    D = np.full((n, n), 1e9)
    for s in range(n):
        D[s, s] = 0.0
        seen = [False] * n
        seen[s] = True
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj[u]:
                if not seen[v]:
                    seen[v] = True
                    D[s, v] = D[s, u] + 1.0
                    q.append(v)
    return D


def stress_layout(D, n, iters=600, seed=11):
    """SMACOF with target distances = hop distance, so neighbours end up close."""
    Dd = D.copy()
    far = D >= 1e8
    if far.any():
        Dd[far] = D[~far].max() * 1.4
    W = np.zeros((n, n))
    nz = Dd > 0
    W[nz] = 1.0 / np.square(Dd[nz])
    Lp = np.linalg.pinv(np.diag(W.sum(1)) - W)
    ang = 2.0 * math.pi * np.arange(n) / max(1, n)
    rnd = np.random.RandomState(seed)
    X = np.c_[np.cos(ang), np.sin(ang)] * (0.5 + rnd.rand(n, 1))
    for _ in range(iters):
        diff = X[:, None, :] - X[None, :, :]
        d = np.sqrt((diff ** 2).sum(-1))
        np.fill_diagonal(d, 1.0)
        d = np.maximum(d, 1e-9)
        X = Lp @ ((W * Dd / d)[:, :, None] * diff).sum(1)
    return X - X.mean(0)


def relaxation(U, A, iters, target, hardness=0.6, attract=0.0):
    """Pull neighbours together (optional), then push crowded footprints apart."""
    deg = A.sum(1)
    deg[deg == 0] = 1.0
    for _ in range(iters):
        if attract > 0.0:
            U = U + attract * ((A @ U) / deg[:, None] - U)
        dx = U[:, None, 0] - U[None, :, 0]
        dy = U[:, None, 1] - U[None, :, 1]
        ox, oy = target - np.abs(dx), target - np.abs(dy)
        m = (ox > 0) & (oy > 0)
        np.fill_diagonal(m, False)
        if not m.any():
            continue
        px = np.where(m & (ox < oy), np.where(dx >= 0, 1.0, -1.0) * ox * 0.5 * hardness, 0.0)
        py = np.where(m & (ox >= oy), np.where(dy >= 0, 1.0, -1.0) * oy * 0.5 * hardness, 0.0)
        U = U + np.c_[px.sum(1), py.sum(1)]
    return U


def crowded(U, target=TARGET):
    dx = U[:, None, 0] - U[None, :, 0]
    dy = U[:, None, 1] - U[None, :, 1]
    m = (np.abs(dx) < target * 0.999) & (np.abs(dy) < target * 0.999)
    np.fill_diagonal(m, False)
    return int(m.sum() // 2)


def layout_buses(buses, branches, aspect=1.32, seed=11, anchor=None):
    n = len(buses)
    idx = {b.key: i for i, b in enumerate(buses)}
    adj = [set() for _ in range(n)]
    for br in branches:
        i, j = idx[br.fbus.key], idx[br.tbus.key]
        adj[i].add(j)
        adj[j].add(i)
    A = np.zeros((n, n))
    for i in range(n):
        for j in adj[i]:
            A[i, j] = 1.0
    U0 = stress_layout(hop_distances(n, adj), n, seed=seed)

    def fit(k, attract, budget=400):
        V = relaxation(U0 * k, A, budget, TARGET, hardness=0.6, attract=attract)
        return crowded(V, HARD) == 0, V

    # Smallest global scale that stays clean, with the strongest neighbour
    # attraction that still separates: attraction is what keeps branches short,
    # since the collision repair alone stretches connected buses apart.
    best = None
    for attract in (0.025, 0.015, 0.0):
        lo, hi = 0.4, 4.0
        ok, V = fit(hi, attract)
        for _ in range(4):
            if ok:
                break
            hi *= 1.4
            ok, V = fit(hi, attract)
        if not ok:
            continue
        best = V
        for _ in range(11):
            mid = (lo + hi) / 2.0
            ok, W = fit(mid, attract)
            if ok:
                hi, best = mid, W
            else:
                lo = mid
        break
    if best is None:
        sys.exit("layout did not separate for any attraction setting")

    # reshape towards a page-friendly aspect ratio (area-preserving, then repair)
    for _ in range(8):
        w = np.ptp(best[:, 0]) * BOX_W
        h = np.ptp(best[:, 1]) * BOX_H
        if w <= 0 or h <= 0 or abs(w / h - aspect) / aspect < 0.06:
            break
        p = min(max(math.sqrt(aspect / (w / h)), 0.70), 1.60)
        q = min(max(1.0 / p, 0.55), 1.40)
        cand = relaxation(best * np.array([p, q]), A, 300, TARGET, hardness=0.6)
        if crowded(cand, HARD) > 0:
            break
        best = cand

    # Orientation: the case's first bus (Bus 1) anchors the UPPER-LEFT corner. A rigid
    # rotation about the centroid does that without touching any distance, so the layout
    # and its collision-free property are exactly the ones the steps above produced; the
    # angle is swept and scored on how close the anchor lands to the corner, with a mild
    # penalty for drifting away from a page-friendly aspect ratio.
    anchor_idx = next((i for i, b in enumerate(buses) if b is anchor), 0)
    pivot = best.mean(0)
    best_score = None
    for deg in range(0, 360, 5):
        a = math.radians(deg)
        ca, sa = math.cos(a), math.sin(a)
        rel = best - pivot
        Y = np.c_[rel[:, 0] * ca - rel[:, 1] * sa, rel[:, 0] * sa + rel[:, 1] * ca] + pivot
        w, h = np.ptp(Y[:, 0]), np.ptp(Y[:, 1])
        if w <= 0 or h <= 0:
            continue
        corner = (1.0 - (Y[anchor_idx, 0] - Y[:, 0].min()) / w) + \
                 (1.0 - (Y[anchor_idx, 1] - Y[:, 1].min()) / h)
        pen = abs(math.log((w * BOX_W) / (h * BOX_H) / aspect))
        score = corner - 0.15 * pen
        if best_score is None or score > best_score:
            best, best_score = Y, score

    # The rigid sweep alone can only reach the best hull corner, so a pinned pass follows:
    # any bus still above or left of the anchor is eased into the anchor's lower-right
    # quadrant, one footprint clear of it, with the collision repair keeping the result
    # clean. Afterwards the anchor really is the top-left-most bus, so the page offset below
    # drops it into the corner. If a case refuses to settle, say so.
    settled, best_state, best_bad = False, best, None
    for _ in range(200):
        left = np.maximum(best[anchor_idx, 0] - best[:, 0], 0.0)
        up = np.maximum(best[anchor_idx, 1] - best[:, 1], 0.0)
        left[anchor_idx] = up[anchor_idx] = 0.0
        bad = max(left.max(), up.max())
        if bad <= 0.0:
            settled, best_state = True, best
            break
        if best_bad is None or bad < best_bad:
            best_state, best_bad = best, bad
        best = best + np.c_[left + (left > 0) * TARGET, up + (up > 0) * TARGET]
        best = relaxation(best, A, 12, TARGET, hardness=0.75)
    best = best_state
    if not settled:
        print("note: the first bus could not be made the top-left-most bus on this case "
              "(closest attempt leaves %.0f px)" % best_bad, file=sys.stderr)

    # to pixels, snap to the drawing grid, repair whatever rounding collided
    X = np.round(best * np.array([BOX_W, BOX_H]) / GRID) * GRID
    for _ in range(80):
        if crowded(X / np.array([BOX_W, BOX_H]), HARD) == 0:
            break
        X = np.round(relaxation(X / np.array([BOX_W, BOX_H]), A, 8, TARGET, hardness=1.0)
                     * np.array([BOX_W, BOX_H]) / GRID) * GRID
    X -= X.min(0)
    X[:, 0] += BOX_W / 2 + 40.0
    X[:, 1] += BOX_H / 2 + BAND_H
    for b, (x, y) in zip(buses, X):
        b.xy = (float(x), float(y))
        b.bar_xy = (float(x) - BUS_W / 2, float(y) - BOX_H / 2 + LABEL_H + LABEL_GAP)
        b.label_xy = (float(x) - LABEL_W / 2, float(y) - BOX_H / 2)
    return buses


# --- geometry helpers -------------------------------------------------------
def bar_rect(bus, pad=0.0):
    x, y = bus.bar_xy
    return (x - pad, y - pad, x + BUS_W + pad, y + BUS_H + pad)


def label_rect(bus, pad=0.0):
    x, y = bus.label_xy
    return (x - pad, y - pad, x + LABEL_W + pad, y + LABEL_H + pad)


def boxes_hit(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def seg_rect_span(p, q, rect):
    """Parametric (t0, t1) of the overlapping part of p->q with rect, or None."""
    x0, y0, x1, y1 = rect
    dx, dy = q[0] - p[0], q[1] - p[1]
    t0, t1 = 0.0, 1.0
    for num, den in ((p[0] - x0, -dx), (x1 - p[0], dx), (p[1] - y0, -dy), (y1 - p[1], dy)):
        if abs(den) < 1e-12:
            if num < 0:
                return None
            continue
        t = num / den
        if den < 0:
            if t > t1:
                return None
            t0 = max(t0, t)
        else:
            if t < t0:
                return None
            t1 = min(t1, t)
    return (t0, t1) if t0 <= t1 else None


def seg_rect_hit(p, q, rect):
    return seg_rect_span(p, q, rect) is not None


def poly_hits(points, rect):
    return any(seg_rect_hit(points[k], points[k + 1], rect) for k in range(len(points) - 1))


def route(p0, p1, hard, soft=(), clearance=7.0):
    """Straight, or a short local hop around the obstacle that blocks it."""
    blocked = [r for r in hard if seg_rect_hit(p0, p1, r)]
    if not blocked:
        return (p0, p1), False
    L = math.dist(p0, p1)
    if L < 1e-6:
        return (p0, p1), False
    ux, uy = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
    nx, ny = -uy, ux
    order = []
    for r in blocked:
        span = seg_rect_span(p0, p1, r)
        if span is not None:
            order.append((abs((span[0] + span[1]) / 2.0 - 0.5), r, span))
    order.sort(key=lambda t: t[0])
    for _, rect, (t0, t1) in order[:3]:
        half = abs(nx) * (rect[2] - rect[0]) / 2.0 + abs(ny) * (rect[3] - rect[1]) / 2.0
        cxm, cym = (rect[0] + rect[2]) / 2.0, (rect[1] + rect[3]) / 2.0
        side = 1.0 if ((cxm - p0[0]) * nx + (cym - p0[1]) * ny) < 0 else -1.0
        for off in (half + clearance, half + clearance + 14.0):
            for sgn in (side, -side):
                o = off * sgn
                a = (p0[0] + ux * max(0.0, t0 * L - clearance) + nx * o,
                     p0[1] + uy * max(0.0, t0 * L - clearance) + ny * o)
                b = (p0[0] + ux * min(L, t1 * L + clearance) + nx * o,
                     p0[1] + uy * min(L, t1 * L + clearance) + ny * o)
                pts = (p0, a, b, p1)
                if not any(poly_hits(pts, r) for r in hard) and \
                   not any(poly_hits(pts, r) for r in soft):
                    return pts, True
    return (p0, p1), False


# --- geometry plan ----------------------------------------------------------
def plan(buses, branches):
    """Bus geometry, transformer symbols and every routed edge, once."""
    bar_obs = {b.key: bar_rect(b, 3.0) for b in buses}
    lab_obs = {b.key: label_rect(b, 1.0) for b in buses}

    ends = {}
    for br in branches:
        a, b = br.fbus.bar_center, br.tbus.bar_center
        ends[br.index] = [(br.fbus, side_of(br.fbus, b)), (br.tbus, side_of(br.tbus, a))]
    groups = defaultdict(list)
    for br in branches:
        for e, (bus, side) in enumerate(ends[br.index]):
            groups[(bus.key, side)].append((br.index, e))
    fracs = {}
    for (bkey, side), items in groups.items():
        far = lambda bi, e: ends[bi][1 - e][0]           # the bus at the other end
        items.sort(key=lambda ie: far(*ie).xy[1] if side in ("L", "R") else far(*ie).xy[0])
        for pos, (bi, e) in enumerate(items):
            fracs[(bi, e)] = 0.5 if len(items) == 1 else 0.14 + 0.72 * pos / (len(items) - 1)

    def anchor(bus, side, frac):
        x, y = bus.bar_xy
        return {"R": (x + BUS_W, y + BUS_H * frac), "L": (x, y + BUS_H * frac),
                "T": (x + BUS_W * frac, y), "B": (x + BUS_W * frac, y + BUS_H)}[side]

    # A transformer symbol sits ON the branch trunk -- the line between the two bus taps.
    # Candidate spots are ordered outward from the trunk's middle (along it first, then
    # stepping aside perpendicular), so the symbol stays inline whenever it can. Labels
    # paint last, so a symbol that overlaps one loses part of a ring: the search avoids
    # bars AND labels, and only falls back to the least-crowded spot when nothing is free.
    symbols, placed, warnings = [], [], []
    for k, br in enumerate([b for b in branches if b.is_xfmr]):
        (ba, sa), (bb, sb) = ends[br.index]
        p0 = anchor(ba, sa, fracs[(br.index, 0)])
        p1 = anchor(bb, sb, fracs[(br.index, 1)])
        tdx, tdy = p1[0] - p0[0], p1[1] - p0[1]
        tlen = math.hypot(tdx, tdy) or 1.0
        tdx, tdy = tdx / tlen, tdy / tlen
        horizontal = abs(tdx) >= abs(tdy)
        gw, gh = ((2 * XF_R - XF_OVERLAP, XF_R) if horizontal else (XF_R, 2 * XF_R - XF_OVERLAP))
        near = (min(p0[0], p1[0]) - 150, min(p0[1], p1[1]) - 150,
                max(p0[0], p1[0]) + 150, max(p0[1], p1[1]) + 150)
        obstacles = [r for r in list(bar_obs.values()) + list(lab_obs.values())
                     if boxes_hit(near, r)]
        perp = (-tdy, tdx)
        cands = sorted(((o, ti / 40.0)
                        for o in [x * 10.0 for x in range(0, 11)] + [-x * 10.0 for x in range(1, 11)]
                        for ti in range(0, 41)),
                       key=lambda ot: (abs(ot[0]), abs(ot[1] - 0.5)))
        spot, best, best_cost = None, None, None
        for off, t in cands:
            cx = p0[0] + tdx * tlen * t + perp[0] * off
            cy = p0[1] + tdy * tlen * t + perp[1] * off
            box = (cx - gw / 2 - 5, cy - gh / 2 - 5, cx + gw / 2 + 5, cy + gh / 2 + 5)
            hits = sum(1 for r in obstacles if boxes_hit(box, r)) + \
                   3 * sum(1 for q in placed if boxes_hit(box, q))
            if hits == 0:
                spot = (cx, cy)
                break
            if best_cost is None or hits < best_cost:
                best, best_cost = (cx, cy), hits
        if spot is None:
            spot = best if best is not None else ((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0)
            warnings.append("transformer %d-%d: no clear spot on the branch; placed at the "
                            "least-crowded one" % (ba.num, bb.num))
        cx, cy = spot
        gx, gy = cx - gw / 2, cy - gh / 2
        placed.append((gx - 6, gy - 6, gx + gw + 6, gy + gh + 6))
        symbols.append({"br": br, "horizontal": horizontal, "gx": gx, "gy": gy,
                        "gw": gw, "gh": gh, "group": "xfg%d" % (k + 1),
                        "ids": ("xf%d" % (k + 1), "xf%db" % (k + 1))})
    xf_box = {s["br"].index: (s["gx"] - 4, s["gy"] - 4, s["gx"] + s["gw"] + 4, s["gy"] + s["gh"] + 4)
              for s in symbols}


    pair_count, pair_seen = defaultdict(int), defaultdict(int)
    for br in branches:
        if not br.is_xfmr:
            pair_count[tuple(sorted((br.fbus.key, br.tbus.key)))] += 1

    edges, detours = [], 0
    for br in branches:
        (ba, sa), (bb, sb) = ends[br.index]
        p0 = anchor(ba, sa, fracs[(br.index, 0)])
        p1 = anchor(bb, sb, fracs[(br.index, 1)])
        hard = [r for k, r in bar_obs.items() if k not in (ba.key, bb.key)] + list(xf_box.values())
        soft = [r for k, r in lab_obs.items() if k not in (ba.key, bb.key)]
        if br.is_xfmr:
            sym = next(s for s in symbols if s["br"] is br)
            cx, cy = sym["gx"] + sym["gw"] / 2, sym["gy"] + sym["gh"] / 2
            if sym["horizontal"]:
                g0, g1 = (sym["gx"], cy), (sym["gx"] + sym["gw"], cy)
                entry0, entry1 = (0.0, 0.5), (1.0, 0.5)
                near_g0 = p0[0] <= p1[0]
            else:
                g0, g1 = (cx, sym["gy"]), (cx, sym["gy"] + sym["gh"])
                entry0, entry1 = (0.5, 0.0), (0.5, 1.0)
                near_g0 = p0[1] <= p1[1]
            if near_g0:
                stubs = ((p0, sa, fracs[(br.index, 0)], "bus%d" % ba.num, sym["ids"][0], g0, entry0),
                         (p1, sb, fracs[(br.index, 1)], "bus%d" % bb.num, sym["ids"][1], g1, entry1))
            else:
                stubs = ((p0, sa, fracs[(br.index, 0)], "bus%d" % ba.num, sym["ids"][1], g1, entry1),
                         (p1, sb, fracs[(br.index, 1)], "bus%d" % bb.num, sym["ids"][0], g0, entry0))
            for origin, side, frac, src, tgt, joint, entry in stubs:
                pts, det = route(origin, joint, hard, soft)
                detours += 1 if det else 0
                edges.append({"id": None, "src": src, "tgt": tgt, "points": pts,
                              "exit": frac, "exitSide": side, "entry": entry, "xfmr": br.index})
            continue
        pts, det = route(p0, p1, hard, soft)
        detours += 1 if det else 0
        key = tuple(sorted((ba.key, bb.key)))
        if pair_count[key] > 1:                     # parallel circuits side by side
            k = pair_seen[key]
            pair_seen[key] += 1
            off = (k - (pair_count[key] - 1) / 2.0) * 6.0
            L = math.dist(p0, p1) or 1.0
            nx, ny = -(p1[1] - p0[1]) / L, (p1[0] - p0[0]) / L
            mid = ((p0[0] + p1[0]) / 2.0 + nx * off, (p0[1] + p1[1]) / 2.0 + ny * off)
            pts = (pts[0], mid, pts[-1])
        edges.append({"id": None, "src": "bus%d" % ba.num, "tgt": "bus%d" % bb.num, "points": pts,
                      "exit": fracs[(br.index, 0)], "exitSide": sa, "entry": fracs[(br.index, 1)],
                      "entrySide": sb, "xfmr": None})
    for i, e in enumerate(edges):
        e["id"] = "e%d" % (i + 1)
    return symbols, edges, detours, warnings


def side_of(bus, other_xy):
    dx, dy = other_xy[0] - bus.xy[0], other_xy[1] - bus.xy[1]
    if abs(dx) >= abs(dy):
        return "R" if dx >= 0 else "L"
    return "B" if dy >= 0 else "T"


SIDE_FRAC = {"R": (1.0, None), "L": (0.0, None), "T": (None, 0.0), "B": (None, 1.0)}


def endpoint_style(side, frac, kind):
    fx, fy = SIDE_FRAC[side]
    if fx is None:
        return "%sX=%g;%sY=%g;" % (kind, frac, kind, fy)
    return "%sX=%g;%sY=%g;" % (kind, fx, kind, frac)


# --- writers ----------------------------------------------------------------
def esc(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;"))


def write_drawio(path, stem, title, subtitle, buses, symbols, edges, page_w, page_h):
    P = []
    add = P.append
    add('<mxfile host="65bd71144e">\n')
    add('    <diagram id="%s-oneline" name="%s">\n' % (stem, esc(title)))
    add('        <mxGraphModel dx="1802" dy="501" grid="1" gridSize="10" guides="1" tooltips="1" '
        'connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="%d" pageHeight="%d" '
        'background="#ffffff" math="0" shadow="0">\n' % (page_w, page_h))
    add('            <root>\n                <mxCell id="0"/>\n                <mxCell id="1" parent="0"/>\n')
    add('                <mxCell id="bg" value="" style="rounded=0;fillColor=#FFFFFF;strokeColor=none;locked=1;" parent="1" vertex="1">\n'
        '                    <mxGeometry width="%g" height="%g" as="geometry"/>\n                </mxCell>\n' % (page_w, page_h))
    add('                <mxCell id="title" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="40" y="20" width="800" height="30" as="geometry"/>\n                </mxCell>\n'
        % (esc(title), TEXT_STYLE % (20, "fontStyle=1;", "#000000", "left", "middle")))
    add('                <mxCell id="subtitle" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="40" y="52" width="1000" height="18" as="geometry"/>\n                </mxCell>\n'
        % (esc(subtitle), TEXT_STYLE % (11, "", "#666666", "left", "middle")))
    lx, ly, lw, lh = page_w - 370.0, 20.0, 330.0, 66.0
    add('                <mxCell id="legend" value="" style="rounded=0;fillColor=#F7F7F7;strokeColor=#CCCCCC;" parent="1" vertex="1">\n'
        '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n' % (lx, ly, lw, lh))
    add('                <mxCell id="legendText" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
        % (esc("\u2503 vertical bus      \u2500 branch      \u25cb\u25cb transformer\n"
               "Bus-N  id only (in the app, hover a bar, a label or a branch)"),
           TEXT_STYLE % (10, "", "#000000", "left", "top") + "spacing=6;", lx, ly, lw, lh))
    for b in buses:
        add('                <mxCell id="bus%d" value="" style="%s" parent="1" vertex="1">\n'
            '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
            % (b.num, BAR_STYLE.format(fill=b.fill, stroke=b.stroke),
               b.bar_xy[0], b.bar_xy[1], BUS_W, BUS_H))
    for e in edges:
        style = EDGE_STYLE + endpoint_style(e["exitSide"], e["exit"], "exit")
        if e["xfmr"] is None:
            style += endpoint_style(e["entrySide"], e["entry"], "entry")
        else:
            style += "entryX=%g;entryY=%g;" % (e["entry"][0], e["entry"][1])
        way = "".join('<mxPoint x="%g" y="%g"/>' % (p[0], p[1]) for p in e["points"][1:-1])
        add('                <mxCell id="%s" value="" style="%s" parent="1" source="%s" target="%s" edge="1">\n'
            '                    <mxGeometry relative="1" as="geometry">%s</mxGeometry>\n                </mxCell>\n'
            % (e["id"], style, e["src"], e["tgt"],
               ('<Array as="points">%s</Array>' % way) if way else ""))
    for s in symbols:
        add('                <mxCell id="%s" value="" style="group" vertex="1" connectable="0" parent="1">\n'
            '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
            % (s["group"], s["gx"], s["gy"], s["gw"], s["gh"]))
        offs = [(0.0, 0.0), (XF_OVERLAP, 0.0)] if s["horizontal"] else [(0.0, 0.0), (0.0, XF_OVERLAP)]
        for cid, (ox, oy) in zip(s["ids"], offs):
            add('                <mxCell id="%s" value="" style="%s" parent="%s" vertex="1">\n'
                '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
                % (cid, XF_STYLE, s["group"], ox, oy, XF_R, XF_R))
    for b in buses:                      # labels last: their paper box covers wires
        add('                <mxCell id="nm%d" value="Bus-%d" style="%s" parent="1" vertex="1">\n'
            '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
            % (b.num, b.num, LABEL_STYLE, b.label_xy[0], b.label_xy[1], LABEL_W, LABEL_H))
    add('            </root>\n        </mxGraphModel>\n    </diagram>\n</mxfile>\n')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(P))


def _font(size, bold=False):
    from PIL import ImageFont
    for p in (("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold
               else "/System/Library/Fonts/Supplemental/Arial.ttf"),
              "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def write_png(path, title, subtitle, buses, symbols, edges, page_w, page_h, scale=1.0):
    from PIL import Image, ImageDraw
    S = scale
    img = Image.new("RGB", (max(1, int(page_w * S)), max(1, int(page_h * S))), "white")
    d = ImageDraw.Draw(img)
    w = max(1, int(round(LINE_W * S)))
    for e in edges:
        d.line([(p[0] * S, p[1] * S) for p in e["points"]], fill="#000000", width=w)
    for s in symbols:
        offs = [(0.0, 0.0), (XF_OVERLAP, 0.0)] if s["horizontal"] else [(0.0, 0.0), (0.0, XF_OVERLAP)]
        for ox, oy in offs:
            x, y = s["gx"] + ox, s["gy"] + oy
            d.ellipse([x * S, y * S, (x + XF_R) * S, (y + XF_R) * S], outline="#000000", width=w)
    f = _font(max(7, int(11 * S)), bold=True)
    for b in buses:
        x, y = b.bar_xy
        d.rectangle([x * S, y * S, (x + BUS_W) * S, (y + BUS_H) * S], fill=b.fill, outline=b.stroke)
        lx, ly = b.label_xy
        d.rectangle([lx * S, ly * S, (lx + LABEL_W) * S, (ly + LABEL_H) * S], fill="white")
        d.text(((lx + LABEL_W / 2) * S, (ly + LABEL_H / 2) * S), "Bus-%d" % b.num,
               font=f, fill="#000000", anchor="mm")
    d.text((40 * S, 34 * S), title, font=_font(max(11, int(20 * S)), True), fill="#000000", anchor="lm")
    d.text((40 * S, 60 * S), subtitle, font=_font(max(8, int(11 * S))), fill="#666666", anchor="lm")
    img.save(path)


# --- validation -------------------------------------------------------------
def validate(path, buses, branches, quiet=False, anchor=None):
    """Read the deliverable back the way the InterPSS diagram preview does."""
    problems = []
    cells = ET.parse(path).getroot().findall(".//mxCell")
    by_id = {c.get("id"): c for c in cells}
    if len(by_id) != len(cells):
        problems.append("duplicate cell ids")
    if len(cells) > 2000:
        problems.append("more than 2000 cells: %d" % len(cells))
    for c in cells:
        for end in (c.get("source"), c.get("target")):
            if end is not None and end not in by_id:
                problems.append("%s references missing cell %s" % (c.get("id"), end))
    parent = {c.get("id"): c.get("parent") for c in cells}
    edges = [c for c in cells if c.get("edge") == "1"]
    for e in edges:
        if "endArrow=none" not in (e.get("style") or ""):
            problems.append("edge %s has an arrowhead" % e.get("id"))
    bus_cells = {"bus%d" % b.num for b in buses}
    labels = {}
    for c in cells:
        m = re.fullmatch(r"Bus-(\d+)", (c.get("value") or "").strip())
        if m:
            labels["bus" + m.group(1)] = c.get("id")
    for b in buses:
        if "bus%d" % b.num not in by_id:
            problems.append("missing bus cell bus%d" % b.num)
        if "bus%d" % b.num not in labels:
            problems.append("bus%d has no `Bus-%d` label" % (b.num, b.num))

    def ends_of(e):
        s = {(e.get("source") or "").lower(), (e.get("target") or "").lower()}
        return sorted(s & bus_cells)

    pairs = set()
    for e in edges:
        ends = ends_of(e)
        if len(ends) == 2:
            pairs.add("|".join(ends))
            continue
        if len(ends) != 1:
            continue
        other = e.get("target") if re.fullmatch(r"bus\d+", e.get("source") or "", re.I) else e.get("source")
        grp = parent.get(other)
        union = set()
        for c in edges:
            if parent.get(c.get("source")) == grp or parent.get(c.get("target")) == grp:
                union |= set(ends_of(c))
        if len(union) == 2:
            pairs.add("|".join(sorted(union)))
        else:
            problems.append("edge %s does not resolve to a bus pair" % e.get("id"))
    want = {"|".join(sorted(("bus%d" % br.fbus.num, "bus%d" % br.tbus.num))) for br in branches}
    if want - pairs:
        problems.append("%d branch pairs missing (e.g. %s)" % (len(want - pairs), sorted(want - pairs)[:3]))
    if pairs - want:
        problems.append("%d pairs with no branch (e.g. %s)" % (len(pairs - want), sorted(pairs - want)[:3]))
    rings = [c for c in cells if "ellipse" in (c.get("style") or "")]
    n_xf = sum(1 for br in branches if br.is_xfmr)
    if len(rings) != 2 * n_xf:
        problems.append("expected %d transformer rings, found %d" % (2 * n_xf, len(rings)))

    # A transformer symbol must clear every bar and label: labels are painted last, so a symbol
    # that overlaps one loses part of a ring (the "broken open arc" defect).
    def box_of(cell):
        g = cell.find("mxGeometry")
        if g is None:
            return None
        x, y = float(g.get("x") or 0.0), float(g.get("y") or 0.0)
        w, h = float(g.get("width") or 0.0), float(g.get("height") or 0.0)
        cur = cell
        for _ in range(8):
            p = by_id.get(cur.get("parent"))
            if p is None or p is cur:
                break
            pg = p.find("mxGeometry")
            if pg is None:
                break
            x += float(pg.get("x") or 0.0)
            y += float(pg.get("y") or 0.0)
            cur = p
        return (x, y, x + w, y + h)

    solid = {c.get("id"): box_of(c) for c in cells
             if re.fullmatch(r"bus\d+", c.get("id") or "", re.I)
             or re.fullmatch(r"Bus-\d+", (c.get("value") or "").strip())}
    # The case's first bus anchors the upper-left corner: no other bar may sit above or left
    # of it (the layout step that guarantees this can be seen in layout_buses()).
    bars = {int(m.group(1)): box_of(c) for c in cells
            for m in [re.fullmatch(r"bus(\d+)", c.get("id") or "", re.I)] if m}
    if anchor is not None and bars.get(anchor.num) is not None:
        ax, ay = bars[anchor.num][0], bars[anchor.num][1]
        offenders = sorted(n for n, g in bars.items()
                           if n != anchor.num and g is not None
                           and (g[0] < ax - 0.51 or g[1] < ay - 0.51))
        if offenders:
            problems.append("the first bus (%d) is not the top-left-most bus: %d sit above/left "
                            "(e.g. %s)" % (anchor.num, len(offenders), offenders[:3]))
    for g in (c for c in cells if (c.get("style") or "") == "group"):
        gb = box_of(g)
        if gb is None:
            continue
        for cid, r in solid.items():
            if r is not None and boxes_hit(gb, r):
                problems.append("transformer %s overlaps %s" % (g.get("id"), cid))
    if not quiet:
        print("check %s: %d cells, %d edges, %d bus pairs, %d transformer rings, %d labels"
              % (os.path.basename(path), len(cells), len(edges), len(pairs), len(rings), len(labels)))
        for p in problems:
            print("  FAIL %s" % p)
        if not problems:
            print("  PASS -- bus/branch hover ids, arrows, transformers and page all hold")
    return not problems


# --- main -------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_dir", help="case folder holding result/<stem>_DF_bus.csv")
    ap.add_argument("--out", help="output .drawio (default <case_dir>/diagram/<stem>-oneline.drawio)")
    ap.add_argument("--title", help="diagram title")
    ap.add_argument("--png", help="preview PNG (default alongside the .drawio)")
    ap.add_argument("--no-png", action="store_true", help="skip the preview PNG")
    ap.add_argument("--scale", type=float, default=1.0, help="preview PNG scale")
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--check", metavar="DRAWIO", help="only validate an existing diagram")
    args = ap.parse_args()

    stem, buses, branches, anchor = read_case(args.case_dir)
    if args.check:
        sys.exit(0 if validate(args.check, buses, branches, anchor=anchor) else 1)
    buses = layout_buses(buses, branches, seed=args.seed, anchor=anchor)
    symbols, edges, detours, warnings = plan(buses, branches)
    page_w = math.ceil((max(b.xy[0] for b in buses) + BOX_W / 2 + 60.0) / 100.0) * 100.0
    page_h = math.ceil((max(b.xy[1] for b in buses) + BOX_H / 2 + 60.0) / 100.0) * 100.0
    title = args.title or "%s One-Line Diagram" % stem
    volts = " / ".join(sorted({b.volt for b in buses if b.volt}))
    subtitle = ("%d buses, %d branches (%d transformers)%s - axes are layout, not geography"
                % (len(buses), len(branches), sum(1 for br in branches if br.is_xfmr),
                   (", voltage levels " + volts) if volts else ""))
    out = args.out or os.path.join(args.case_dir, "diagram", "%s-oneline.drawio" % stem)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    write_drawio(out, stem, title, subtitle, buses, symbols, edges, page_w, page_h)
    for w in warnings:
        print("note: %s" % w)
    print("wrote %s (%gx%g, %d buses, %d branches, %d edges, %d hopped, %d overlapping footprints)"
          % (out, page_w, page_h, len(buses), len(branches), len(edges), detours,
             crowded(np.array([b.xy for b in buses]) / np.array([BOX_W, BOX_H]), HARD)))
    ok = validate(out, buses, branches, anchor=anchor)
    if not args.no_png:
        png = args.png or os.path.splitext(out)[0] + "-preview.png"
        write_png(png, title, subtitle, buses, symbols, edges, page_w, page_h, args.scale)
        print("wrote %s" % png)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
