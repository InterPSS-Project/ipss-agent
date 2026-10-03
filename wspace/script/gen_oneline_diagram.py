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

That force pipeline is proven to ~118 buses (465 cells) and collapses past it: at
2000 buses its scale search finds no clean separation, the corner-pinning pass then
inflates one axis without bound, and the transformer symbol search has no room left
(measured on Texas 2K: a 4000 x 4907300 px page with 2193 overlapping footprints and
127 self-check failures). Cases above FORCE_MAX_BUSES take the **lattice** path
(`--layout`), which constructs separation instead of searching for it -- and gives each
half of the job to the machinery that is good at it:

  1. partition the graph into connected clusters of at most CLUSTER_MAX buses (BFS
     growth, deterministic), and lay each cluster out with layout_buses itself -- the
     pipeline above, on ~48 buses, so a branch inside a cluster stays short,
  2. order the clusters by adjacency (BFS over the cluster graph) and pack their blocks
     into shelves, two cells of gutter apart,
  3. give every bus its own cell of its block's lattice, which is what makes the
     no-overlap rule, the page bound and the top-left anchor hold by construction
     (two cells are 90 x 110 px, i.e. 1.73 x 1.53 footprints apart),
  4. reserve every transformer symbol a gap between four cells, so it is placed clear of
     every bar and label rather than searched for,
  5. draw the branches before the bars, so the bars mask the wires and the hop search
     (which cannot scale to 3000 long branches) is not needed.

`--open` hands the finished diagram to the draw.io editor through the draw.io MCP server
(`wspace/script/drawio_mcp.py`), which also round-trips hand edits back into the file.

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
import subprocess
import sys
import time
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

# --- placement strategy (layout_buses vs layout_buses_lattice) --------------
# The force pipeline below searches for a separation: it scales, relaxes and repairs until
# `crowded()` reports zero. Past a few hundred footprints there is no scale that separates
# them, and when the search fails the failure is silent -- the repair loop gives up after 80
# rounds and the run only *prints* the overlap count (measured on Texas 2K, 2000 buses:
# 4000 x 4907300 px, 2193 overlapping footprints, 127 self-check failures, ~8 minutes). The
# lattice path constructs the separation instead, so there is nothing to fail.
FORCE_MAX_BUSES = 250   # `--layout auto` uses the lattice above this
CLUSTER_MAX = 48        # buses per cluster: a size the force pipeline is proven at, and fast
CLUSTER_SLACK = 1.15    # cells per cluster member inside a block
CELL_W, CELL_H = 90.0, 110.0    # lattice pitch = BOX_W + 38, BOX_H + 38 (10 px grid multiples)
LATTICE_SLACK = 1.25    # cells allocated per bus, so the nearest-free search always has room
GUTTER = 1              # empty cells between two clusters' blocks (separation + symbol room)


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
    deg = None
    if attract > 0.0:                        # `A` is only needed for the neighbour term
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


# --- large cases: cluster the graph, then place every bus on its own cell --
def cluster_buses(adj, n, size=CLUSTER_MAX):
    """BFS-growth partition into clusters of at most `size` buses.

    Deterministic: the seed is the lowest-numbered unvisited bus and each node's neighbours are
    visited in index order, so one case always yields the same clusters. Growing in BFS order
    keeps every cluster a connected neighbourhood of the graph, which is what lets the per-cluster
    layout below put graph neighbours close together -- the property the whole path is judged on.
    """
    seen = [False] * n
    clusters = []
    for seed in range(n):
        if seen[seed]:
            continue
        seen[seed] = True
        group = [seed]
        queue = deque([seed])
        while queue and len(group) < size:
            u = queue.popleft()
            for v in sorted(adj[u]):
                if seen[v]:
                    continue
                seen[v] = True
                group.append(v)
                queue.append(v)
                if len(group) >= size:
                    break
        clusters.append(sorted(group))
    return clusters


def cluster_order(cadj, start, count):
    """BFS over the cluster graph from `start`, so shelved blocks land near their neighbours."""
    order, seen = [], [False] * count
    queue = deque([start])
    seen[start] = True
    while queue:
        u = queue.popleft()
        order.append(u)
        for v in sorted(cadj[u]):
            if not seen[v]:
                seen[v] = True
                queue.append(v)
    for u in range(count):                       # a disconnected island still gets placed
        if not seen[u]:
            seen[u] = True
            order.append(u)
    return order


def shelf_pack(blocks, columns):
    """Lay the blocks out in shelves `columns` cells wide, tallest first; returns (cols, rows).

    A shelf's height is set by its tallest block, so putting the tall ones in first is what keeps
    the short ones from wasting the space above them. The sort is stable, so equally sized blocks
    keep the order they arrived in -- the cluster graph's BFS order, which is what puts tied
    clusters near each other; packing strictly in that order instead fills the shelves worse
    (Texas 2K: 30% full and a 9000 x 7600 page, against 43% and 8000 x 6000) and does not shorten
    the tie lines, which are the case's own long-range structure. A GUTTER of empty cells between
    blocks separates two clusters visually and gives a transformer symbol at a block's edge
    somewhere clear to sit.
    """
    x, y, shelf = 0, 0, 0
    for blk in sorted(blocks, key=lambda b: -b["rows"]):
        if x > 0 and x + blk["cols"] > columns:
            x, y, shelf = 0, y + shelf + GUTTER, 0
        blk["c0"], blk["r0"] = x, y
        x += blk["cols"] + GUTTER
        shelf = max(shelf, blk["rows"])
    cols = max([b["c0"] + b["cols"] for b in blocks] or [1])
    rows = max([b["r0"] + b["rows"] for b in blocks] or [1])
    return cols, rows


def pack_blocks(blocks, n, aspect=1.32):
    """Shelf-pack `blocks` at the width whose page lands closest to `aspect`.

    A fragmented case is mostly small blocks, where the shelf width decides whether the page is a
    ribbon or a sheet -- and that is cheap to try: the packing is O(blocks).
    """
    target = max(1, int(round(math.sqrt(n * LATTICE_SLACK * aspect * CELL_H / CELL_W) * 1.2)))
    best = None
    for scale in (0.6, 0.75, 0.9, 1.0, 1.15, 1.3, 1.5):
        for blk in blocks:
            blk["c0"] = blk["r0"] = 0
        cols, rows = shelf_pack(blocks, max(1, int(round(target * scale))))
        page = (cols * CELL_W) / float(rows * CELL_H)
        err = abs(math.log(page / aspect)) if page > 0 else 9.0
        if best is None or err < best[0]:
            best = (err, cols, rows, [dict(b) for b in blocks])
    _, cols, rows, packed = best
    blocks[:] = packed
    return cols, rows


def lattice_dims(n, aspect=1.32, slack=LATTICE_SLACK):
    """(cols, rows) for n buses, aiming the page at `aspect` = width / height."""
    cells = n * slack
    cols = max(1, int(round(math.sqrt(cells * max(0.2, aspect) * CELL_H / CELL_W))))
    rows = max(1, int(math.ceil(cells / float(cols))))
    return cols, rows


def quantize_lattice(U, anchor_idx, cols, slack=LATTICE_SLACK, rows=None):
    """Give every point its own cell of a `cols` x rows grid, near where its layout put it.

    The layout is mapped onto the cell grid -- monotone in both axes, so the arrangement survives
    -- and each point takes the free cell nearest its mapped position, in top-left-first order so
    the displacement stays local. `anchor_idx` is then handed cell (0, 0) by swapping with whoever
    holds it: that, plus every other cell having row and column >= 0, is what makes the case's
    first bus the top-left-most bus by construction.
    """
    n = len(U)
    if rows is None:
        rows = max(1, int(math.ceil(n * slack / float(cols))))
    lo, hi = U.min(0), U.max(0)
    span = np.maximum(hi - lo, 1e-9)
    sx, sy = (cols - 1) / span[0], (rows - 1) / span[1]
    want = {i: (int(round((U[i, 1] - lo[1]) * sy)), int(round((U[i, 0] - lo[0]) * sx)))
            for i in range(n)}
    order = sorted(range(n), key=lambda i: (want[i][0], want[i][1], i))
    if 0 <= anchor_idx < n:
        order.remove(anchor_idx)
        order.insert(0, anchor_idx)
    taken, cell = {}, {}

    def candidates(r0, c0, cap=8):
        yield r0, c0
        for rad in range(1, cap + 1):
            ring = [(r0 + dr, c0 + dc)
                    for dr in range(-rad, rad + 1) for dc in range(-rad, rad + 1)
                    if max(abs(dr), abs(dc)) == rad]
            ring.sort(key=lambda rc: (rc[0] * rc[0] + rc[1] * rc[1], rc[0], rc[1]))
            for rc in ring:
                yield rc

    for i in order:
        r0 = min(max(want[i][0], 0), rows - 1)
        c0 = min(max(want[i][1], 0), cols - 1)
        spot = None
        for rc in candidates(r0, c0):
            if 0 <= rc[0] < rows and 0 <= rc[1] < cols and rc not in taken:
                spot = rc
                break
        if spot is None:                         # more points than cells: nothing sensible left
            for r in range(rows):
                for c in range(cols):
                    if (r, c) not in taken:
                        spot = (r, c)
                        break
                if spot is not None:
                    break
        taken[spot] = i
        cell[i] = spot
    if 0 <= anchor_idx < n:                      # the anchor owns the top-left cell
        here, other = cell[anchor_idx], taken.get((0, 0))
        if other is not None and other != anchor_idx:
            cell[other] = here
            taken[here] = other
        cell[anchor_idx] = (0, 0)
        taken[(0, 0)] = anchor_idx
    return cell, rows


def layout_buses_lattice(buses, branches, aspect=1.32, seed=11, anchor=None):
    """Cluster the graph, lay each cluster out with the proven pipeline, then shelf the clusters
    onto one lattice page -- the placement for cases the force pipeline cannot separate (see
    FORCE_MAX_BUSES).

    Each half does what it is good at. `layout_buses` is what makes a *readable* drawing (short
    branches, no overlaps) and it is proven to ~118 buses, so clusters of at most CLUSTER_MAX
    buses go through it -- a branch inside a cluster stays short, which is most of them. The
    lattice is what makes 2000 footprints placeable at all: every bus takes its own cell, so
    separation, the page bound and the top-left anchor hold by construction rather than by a
    search that gives up silently. Returns `(buses, placement)`; `placement` carries the lattice
    origin, its size and each bus's cell, which `plan()` needs for the transformer gaps.
    """
    n = len(buses)
    idx = {b.key: i for i, b in enumerate(buses)}
    adj = [set() for _ in range(n)]
    for br in branches:
        i, j = idx[br.fbus.key], idx[br.tbus.key]
        if i != j:
            adj[i].add(j)
            adj[j].add(i)
    clusters = cluster_buses(adj, n)
    owner = {}
    for k, group in enumerate(clusters):
        for i in group:
            owner[i] = k

    # 1. a local continuous layout per cluster, with the pipeline the small cases are proven on
    inner = [[] for _ in clusters]
    for br in branches:
        i, j = idx[br.fbus.key], idx[br.tbus.key]
        if i != j and owner[i] == owner[j]:
            inner[owner[i]].append(br)
    for k, group in enumerate(clusters):
        if len(group) > 1:
            layout_buses([buses[i] for i in group], inner[k], seed=seed + k,
                         anchor=buses[group[0]])

    # 2. order the clusters by adjacency, then pack their blocks into shelves
    cadj = [set() for _ in clusters]
    for br in branches:
        i, j = idx[br.fbus.key], idx[br.tbus.key]
        if i != j and owner[i] != owner[j]:
            cadj[owner[i]].add(owner[j])
            cadj[owner[j]].add(owner[i])
    anchor_idx = next((i for i, b in enumerate(buses) if b is anchor), 0)
    order = cluster_order(cadj, owner[anchor_idx], len(clusters))
    blocks = [{"cluster": k, "c0": 0, "r0": 0,
               "cols": lattice_dims(len(clusters[k]), 1.0, CLUSTER_SLACK)[0],
               "rows": lattice_dims(len(clusters[k]), 1.0, CLUSTER_SLACK)[1]}
              for k in order]
    cols, rows = pack_blocks(blocks, n, aspect)

    # 3. quantize each cluster into its own block, then anchor the first bus at the top-left
    cell = {}
    for blk in blocks:
        group = clusters[blk["cluster"]]
        if len(group) == 1:
            local = {0: (0, 0)}
        else:
            U = np.array([buses[i].xy for i in group])
            local, _ = quantize_lattice(U, 0, blk["cols"], slack=1.0, rows=blk["rows"])
        for pos, i in enumerate(group):
            r, c = local[pos]
            cell[i] = (blk["r0"] + r, blk["c0"] + c)
    if 0 <= anchor_idx < n and cell.get(anchor_idx) != (0, 0):
        here = cell[anchor_idx]
        other = next((i for i, rc in cell.items() if rc == (0, 0)), None)
        if other is not None:
            cell[other] = here
        cell[anchor_idx] = (0, 0)

    x0 = 40.0 + CELL_W / 2.0                     # cell (0, 0)'s centre
    y0 = BAND_H + CELL_H / 2.0
    for i, b in enumerate(buses):
        r, c = cell[i]
        x, y = x0 + c * CELL_W, y0 + r * CELL_H
        b.xy = (float(x), float(y))
        b.bar_xy = (float(x) - BUS_W / 2, float(y) - BOX_H / 2 + LABEL_H + LABEL_GAP)
        b.label_xy = (float(x) - LABEL_W / 2, float(y) - BOX_H / 2)
    placement = {"kind": "lattice", "origin": (x0, y0), "cols": cols, "rows": rows,
                 "clusters": len(clusters), "largest_cluster": max(len(c) for c in clusters),
                 "cell": {buses[i].key: cell[i] for i in range(n)}}
    return buses, placement


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
def plan(buses, branches, hops=True, slots=None):
    """Bus geometry, transformer symbols and every routed edge, once.

    `hops=False` draws every branch straight: on the lattice path the edges are emitted before
    the bars, so the bars mask the wires instead, and the hop search -- which re-tests every bar
    for every candidate -- would not scale to 3000 long branches anyway.

    `slots` is the lattice placement (see layout_buses_lattice): each transformer symbol is then
    placed in a *reserved* gap between four bus cells, which is empty of bars and labels by
    construction, instead of being searched for along the trunk.
    """
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
    #
    # On the lattice path there is a better answer than searching: every gap where four bus
    # cells meet is 38 x 38 px, which is exactly what a padded symbol needs in either
    # orientation, and the cells around it own all the bars and labels -- so a gap is *reserved*
    # space, not a candidate. The symbol takes the free gap nearest its trunk's midpoint; the
    # trunk search below stays as the fallback for cases with more transformers than gaps.
    slot_taken = set()
    slot_stats = {"slots": 0, "fallbacks": 0}

    def slot_spot(mx, my):
        if slots is None:
            return None
        x0, y0 = slots["origin"]
        cols, rows = slots["cols"], slots["rows"]
        if cols < 2 or rows < 2:
            return None                              # no gap exists between the cells
        c0 = int(round((mx - x0) / CELL_W - 0.5))
        r0 = int(round((my - y0) / CELL_H - 0.5))
        free = []
        for rad in range(0, 5):
            for dr in range(-rad, rad + 1):
                for dc in range(-rad, rad + 1):
                    if max(abs(dr), abs(dc)) != rad:
                        continue
                    r, c = r0 + dr, c0 + dc
                    if not (0 <= r <= rows - 2 and 0 <= c <= cols - 2) or (r, c) in slot_taken:
                        continue
                    cx, cy = x0 + (c + 0.5) * CELL_W, y0 + (r + 0.5) * CELL_H
                    free.append((math.hypot(cx - mx, cy - my), r, c, cx, cy))
        if not free:
            return None
        free.sort(key=lambda t: (t[0], t[1], t[2]))
        _, r, c, cx, cy = free[0]
        slot_taken.add((r, c))
        slot_stats["slots"] += 1
        return (cx, cy)

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
        spot = slot_spot((p0[0] + p1[0]) / 2.0, (p0[1] + p1[1]) / 2.0) if slots is not None else None
        if slots is not None and spot is None:
            slot_stats["fallbacks"] += 1
        if spot is None:
            near = (min(p0[0], p1[0]) - 150, min(p0[1], p1[1]) - 150,
                    max(p0[0], p1[0]) + 150, max(p0[1], p1[1]) + 150)
            obstacles = [r for r in list(bar_obs.values()) + list(lab_obs.values())
                         if boxes_hit(near, r)]
            perp = (-tdy, tdx)
            cands = sorted(((o, ti / 40.0)
                            for o in [x * 10.0 for x in range(0, 11)]
                            + [-x * 10.0 for x in range(1, 11)]
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
        # `hops=False`: the lattice path draws every branch straight, because its edges are
        # emitted before the bars (the bars mask the wires) -- so there is no obstacle list to
        # scan and `route` short-circuits on its first line.
        hard = [] if not hops else \
            [r for k, r in bar_obs.items() if k not in (ba.key, bb.key)] + list(xf_box.values())
        soft = [] if not hops else [r for k, r in lab_obs.items() if k not in (ba.key, bb.key)]
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
    return symbols, edges, detours, warnings, slot_stats


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


def write_drawio(path, stem, title, subtitle, buses, symbols, edges, page_w, page_h,
                 edges_first=False):
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
    # Header: title and subtitle on the left, legend on the right -- but a narrow page has no
    # room for the two side by side, and draw.io paints the legend box over the title text
    # (the exporter then widens the page to fit the overflowing cells). So the legend stacks
    # under the subtitle whenever the title column would come out too thin.
    lw = min(360.0, page_w - 80.0)
    lx, ly, lh = page_w - 40.0 - lw, 20.0, 66.0
    title_w = lx - 60.0
    if title_w < 340.0:
        lx, ly, title_w = 40.0, 88.0, page_w - 80.0
    sub_w = title_w
    add('                <mxCell id="title" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="40" y="20" width="%g" height="30" as="geometry"/>\n                </mxCell>\n'
        % (esc(title), TEXT_STYLE % (20, "fontStyle=1;", "#000000", "left", "middle"), title_w))
    add('                <mxCell id="subtitle" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="40" y="52" width="%g" height="18" as="geometry"/>\n                </mxCell>\n'
        % (esc(subtitle), TEXT_STYLE % (11, "", "#666666", "left", "middle"), sub_w))
    add('                <mxCell id="legend" value="" style="rounded=0;fillColor=#F7F7F7;strokeColor=#CCCCCC;" parent="1" vertex="1">\n'
        '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n' % (lx, ly, lw, lh))
    add('                <mxCell id="legendText" value="%s" style="%s" parent="1" vertex="1">\n'
        '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
        # draw.io collapses a literal newline in an html label, so the line break is a <br>
        # (escaped here); the plugin preview turns the same <br> back into a newline.
        % (esc("\u2503 vertical bus      \u2500 branch      \u25cb\u25cb transformer<br>"
               "Bus-N  id only \u2014 hover a bar, a label or a branch"),
           TEXT_STYLE % (10, "", "#000000", "left", "top") + "spacing=6;", lx, ly, lw, lh))
    def add_buses():
        for b in buses:
            add('                <mxCell id="bus%d" value="" style="%s" parent="1" vertex="1">\n'
                '                    <mxGeometry x="%g" y="%g" width="%g" height="%g" as="geometry"/>\n                </mxCell>\n'
                % (b.num, BAR_STYLE.format(fill=b.fill, stroke=b.stroke),
                   b.bar_xy[0], b.bar_xy[1], BUS_W, BUS_H))

    def add_edges():
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

    # Who comes first decides what a crossing looks like. The force path draws the branches over
    # the bars and hops the ones that would cut through a bar (the template's convention, kept
    # byte-for-byte). The lattice path has thousands of long branches, so it draws them first:
    # the bars and the labels above them mask the wires, and no hop is needed at all.
    if edges_first:
        add_edges()
    add_buses()
    if not edges_first:
        add_edges()
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
    root = ET.parse(path).getroot()
    cells = root.findall(".//mxCell")
    by_id = {c.get("id"): c for c in cells}
    if len(by_id) != len(cells):
        problems.append("duplicate cell ids")
    if len(cells) > 20000:
        problems.append("more than 20000 cells: %d" % len(cells))
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

    # No two bus footprints may overlap. This is the defect the force pipeline can ship: its
    # repair loop gives up after 80 rounds and the run only *prints* the count (measured on a
    # 2000-bus case: 2193 overlapping footprints). The lattice path cannot produce it -- two
    # cells are 1.73 x 1.53 footprints apart -- so the rule is what keeps that true.
    # Read from the FILE, not from `buses`: --check has no layout to look at.
    centres = []
    for b in buses:
        bar, lab = solid.get("bus%d" % b.num), solid.get("nm%d" % b.num)
        if bar is None or lab is None:
            continue
        centres.append(((min(bar[0], lab[0]) + max(bar[2], lab[2])) / 2.0 / BOX_W,
                        (min(bar[1], lab[1]) + max(bar[3], lab[3])) / 2.0 / BOX_H))
    if len(centres) > 1:
        hits = crowded(np.array(centres), HARD)
        if hits:
            problems.append("%d overlapping bus footprints" % hits)

    # A page that is a ribbon or a speck is a layout defect, not a taste: the force pipeline's
    # corner-pinning pass can inflate one axis without bound (measured: 4000 x 4907300 px on the
    # same 2000-bus case, which no viewer can use). The committed diagrams are 900x760,
    # 900x900 and 1700x1600; a lattice page is ~6000x4600.
    model = root.find(".//mxGraphModel")
    if model is not None:
        pw, ph = float(model.get("pageWidth") or 0.0), float(model.get("pageHeight") or 0.0)
        if pw > 0.0 and ph > 0.0:
            ratio = pw / ph
            if ratio < 0.35 or ratio > 3.0 or max(pw, ph) > 20000.0:
                problems.append("page is not page-friendly: %gx%g" % (pw, ph))
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
    ap.add_argument("--layout", choices=("auto", "force", "lattice"), default="auto",
                    help="placement strategy: `auto` = the force pipeline up to %d buses and the "
                         "lattice above (a large case cannot be separated by the force one); "
                         "`force` = always the original pipeline; `lattice` = always one cell per "
                         "bus, branches drawn under the bars" % FORCE_MAX_BUSES)
    ap.add_argument("--check", metavar="DRAWIO", help="only validate an existing diagram")
    ap.add_argument("--app-export", metavar="PNG", nargs="?", const="", default=None,
                    help="also render the diagram with the local draw.io desktop app's CLI "
                         "(authoritative draw.io output, not the Pillow approximation); optional "
                         "output path, default <stem>-oneline-drawio.png")
    ap.add_argument("--app", default="/Applications/draw.io.app/Contents/MacOS/draw.io",
                    help="draw.io desktop executable used by --app-export")
    ap.add_argument("--open", action="store_true",
                    help="after a passing self-check, open the diagram in the draw.io editor "
                         "through the draw.io MCP server (wspace/script/drawio_mcp.py)")
    args = ap.parse_args()

    stem, buses, branches, anchor = read_case(args.case_dir)
    if args.check:
        sys.exit(0 if validate(args.check, buses, branches, anchor=anchor) else 1)
    kind = args.layout
    if kind == "auto":
        kind = "force" if len(buses) <= FORCE_MAX_BUSES else "lattice"
    started = time.time()
    if kind == "lattice":
        buses, placement = layout_buses_lattice(buses, branches, seed=args.seed, anchor=anchor)
    else:
        buses = layout_buses(buses, branches, seed=args.seed, anchor=anchor)
        placement = {"kind": "force"}
    symbols, edges, detours, warnings, slot_stats = plan(
        buses, branches, hops=kind == "force",
        slots=placement if kind == "lattice" else None)
    placed_s = time.time() - started
    page_w = math.ceil((max(b.xy[0] for b in buses) + BOX_W / 2 + 60.0) / 100.0) * 100.0
    page_h = math.ceil((max(b.xy[1] for b in buses) + BOX_H / 2 + 60.0) / 100.0) * 100.0
    title = args.title or "%s One-Line Diagram" % stem
    volts = " / ".join(sorted({b.volt for b in buses if b.volt}))
    subtitle = ("%d buses, %d branches (%d transformers)%s - axes are layout, not geography"
                % (len(buses), len(branches), sum(1 for br in branches if br.is_xfmr),
                   (", voltage levels " + volts) if volts else ""))
    out = args.out or os.path.join(args.case_dir, "diagram", "%s-oneline.drawio" % stem)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    write_drawio(out, stem, title, subtitle, buses, symbols, edges, page_w, page_h,
                 edges_first=kind == "lattice")
    for w in warnings:
        print("note: %s" % w)
    print("placed %d buses with the %s strategy in %.1fs" % (len(buses), kind, placed_s))
    if kind == "lattice":
        cell = placement["cell"]
        spans = sorted(abs(cell[br.fbus.key][0] - cell[br.tbus.key][0])
                       + abs(cell[br.fbus.key][1] - cell[br.tbus.key][1]) for br in branches)
        occ = 100.0 * len(buses) / float(placement["cols"] * placement["rows"])
        print("lattice %dx%d cells (%.0f%% full, %d reserved transformer gaps used, %d fell back "
              "to the trunk search); branch grid distance median %d, p95 %d"
              % (placement["cols"], placement["rows"], occ, slot_stats.get("slots", 0),
                 slot_stats.get("fallbacks", 0),
                 spans[len(spans) // 2] if spans else 0,
                 spans[min(len(spans) - 1, int(0.95 * len(spans)))] if spans else 0))
    print("wrote %s (%gx%g, %d buses, %d branches, %d edges, %d hopped, %d overlapping footprints)"
          % (out, page_w, page_h, len(buses), len(branches), len(edges), detours,
             crowded(np.array([b.xy for b in buses]) / np.array([BOX_W, BOX_H]), HARD)))
    ok = validate(out, buses, branches, anchor=anchor)
    if not args.no_png:
        png = args.png or os.path.splitext(out)[0] + "-preview.png"
        write_png(png, title, subtitle, buses, symbols, edges, page_w, page_h, args.scale)
        print("wrote %s" % png)
    if args.app_export is not None and ok:
        target = args.app_export or os.path.splitext(out)[0] + "-drawio.png"
        if not os.path.exists(args.app):
            print("note: no draw.io desktop app at %s -- skipping --app-export" % args.app, file=sys.stderr)
        else:
            # --no-sandbox because the export runs inside this harness's own file sandbox, which
            # blocks the Electron/Chromium one; the input path must be absolute.
            rc = subprocess.call([args.app, "--no-sandbox", "--export", "--format", "png",
                                  "--scale", "2", "--output", os.path.abspath(target),
                                  os.path.abspath(out)])
            print(("wrote %s (draw.io desktop render)" % target) if rc == 0 and os.path.exists(target)
                  else "note: the draw.io desktop export failed (exit %d)" % rc)
    if args.open and ok:
        helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), "drawio_mcp.py")
        print("handing %s to the draw.io editor through the draw.io MCP ..." % os.path.basename(out))
        if subprocess.call([sys.executable, helper, "open", out]) != 0:
            print("note: the draw.io MCP could not open the editor -- is the server installed at "
                  "$DSH_HOME/mcp-servers/drawio? see docs/oneline-diagram-process.md", file=sys.stderr)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
