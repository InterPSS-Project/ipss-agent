---
name: ipss-drawio-adjust
description: >-
  Hand-adjust an existing InterPSS one-line .drawio — move bus bars to match a
  classic/reference layout, keep each bus's generator and load symbols attached,
  place gens on the bus side with fewer branch connections, rewire transformer
  stub edges to ring outer edges, and convert straight bus–bus branches to
  stubbed H–diag–H multilines. Use when the user asks to adjust bus locations,
  flip gen side away from crowded branches, uncross same-side branch anchors by
  peer Y (including XF stubs), fix transformer connections, apply branch
  multilines, align a diagram to a reference one-line (e.g. IEEE 39), or edit
  ieee*-oneline*.drawio without regenerating from the force/lattice layout.
metadata:
  short-description: Hand-adjust case one-line drawio layout
---

# InterPSS Draw.io Adjust

Hand-edit an **existing** case one-line `.drawio` (bus positions, equipment
symbols including gen side, transformer stubs, bus–bus branch routing). Do
**not** regenerate with `gen_oneline_diagram.py` — that overwrites hand layout.
For a fresh diagram from result CSVs, use `$ipss-case-diagram` instead.

## When to use

- “Move buses to match this classic IEEE 39 diagram”
- “Keep gen/load together when moving the bus”
- “Put the gen on the side with fewer branch connections”
- “Transformer connections are wrong / lines go through the rings”
- “Convert straight branches to stubbed multilines” / H–diag–H routing
- “Branches cross at the bus — fix anchor points” / uncross same-side exits
- Any edit to `<case>/diagram/*-oneline*.drawio` that must preserve topology
  and equipment symbols

## Cell id contract (do not rename)

| Kind | Ids | Notes |
|---|---|---|
| Bus bar | `busN` | 4×52 vertical bar, fill `#666666` |
| Label | `nmN` | value exactly `Bus-N`, 46×18 above the bar |
| Generator | `ggN` / `genN` + lead `sgN` | default left; flip to **lighter** L/R branch side |
| Load | `lgN` / `ldN` + lead `slN` | load on the **right** of the bar |
| Transformer | `xfgK` group, rings `xfK` / `xfKb` | two 16×16 ellipses, overlap 8 |
| Branch / stub | `eM` | `endArrow=none`; xf stubs are bus→ring |

Preview tooltips require `busN` + `Bus-N`. Equipment leads are edges
`source=busN` → `target=genN|ldN`.

## Constants (match the generator)

```
BUS_W, BUS_H = 4, 52
LABEL_W, LABEL_H, LABEL_GAP = 46, 18, 2
SYM_STEM, GEN_R, GEN_FRAC = 6, 6.5, 0.34
LOAD_W, LOAD_H, LOAD_DROP, LOAD_FRAC = 6.5, 13, 9, 0.55
XF_R, XF_OVERLAP = 16, 8
BRANCH_STUB = 16          # px horizontal lead-out / lead-in
BRANCH_ALIGN_EPS = 8      # dx or dy below this → leave as single segment
```

Relative to bus bar top-left `(x, y)`:

| Part | Position |
|---|---|
| Label | `(x - (LABEL_W-BUS_W)/2, y - LABEL_GAP - LABEL_H)` |
| Gen group (left) | `(x - SYM_STEM - 2*GEN_R, y + BUS_H*GEN_FRAC - GEN_R)` |
| Gen group (right) | `(x + BUS_W + SYM_STEM, y + BUS_H*GEN_FRAC - GEN_R)` |
| Load group | `(x + BUS_W + SYM_STEM - LOAD_W/2, y + BUS_H*LOAD_FRAC + LOAD_DROP)` |
| Load lead waypoint | `(x + BUS_W + SYM_STEM, y + BUS_H*LOAD_FRAC)` |

Gen lead `sgN` ports: left → `exitX=0;exitY=GEN_FRAC;entryX=1;entryY=0.5`;
right → `exitX=1;exitY=GEN_FRAC;entryX=0;entryY=0.5`.

## Workflow

### 1. Move buses (keep gen/load/label together)

1. Decide target `(x, y)` for every `busN` (classic schematic, user sketch, etc.).
2. For each bus, set geometry of `busN`, `nmN`, and if present `ggN` / `lgN`
   from the formulas above — **recompute**, do not only translate by delta if
   the relative offsets might already be wrong.
3. Refresh `slN` waypoints; clear stale `eM` branch waypoints (or re-run §3 /
   §3b after moves). Finish with §4 once branch/XF ports are known.
4. Keep footprints clear: ≈52×72 boxes must not overlap (self-check
   `overlapping bus footprints`).
5. Fit the page (§1b) whenever content grows past the current sheet.

Hand-laid classic layouts often fail the generated-diagram rule “Bus-1 is
top-left-most” — that is expected; do not force Bus-1 into the corner if the
reference schematic places it elsewhere.

### 1b. Fit page to content

After moves / gen flips, elements can sit past the visible sheet even when
`pageWidth` / `pageHeight` look large enough — the locked `bg` rectangle from
the generator is often still the old size (e.g. 900×800) and draw.io shows
content outside that white page as off-sheet.

1. Compute content bbox from parent=`1` vertices (skip `bg`), equipment groups
   (`ggN` / `lgN` / `xfgK`), and edge waypoints.
2. Set both to the same size (ceil to 100 px, ≥60 px margin past max x/y):
   - `mxGraphModel` `pageWidth` / `pageHeight`
   - `bg` geometry `width` / `height` (keep x/y at origin)
3. Widen `title` / `subtitle` to about `pageWidth - 80` so the header tracks
   the sheet.

Never update only `pageWidth`/`pageHeight` and leave `bg` stale.

### 2. Fix transformer connections

Stubs must attach to **ring outer edges**, never the centre or an **inner** face
of the OO. A line that appears to run straight through both rings usually means
the bus↔ring pairing is **swapped** (stub enters the near side of the far ring),
not only `entryX=0.5;entryY=0.5`.

Follow `gen_oneline_diagram.plan()`:

1. Place `xfgK` on the trunk midpoint between the two bus bar centres.
   Orientation: horizontal if `|dx| ≥ |dy|`, else vertical.
   - Horizontal group: `24×16`, rings at `(0,0)` = `xfK` and `(8,0)` = `xfKb`
   - Vertical group: `16×24`, rings at `(0,0)` = `xfK` and `(0,8)` = `xfKb`
2. Joints and **outer** entries (fixed to ring geometry):
   - Horizontal: `g0` left `(gx, cy)` → `xfK` entry `(0, 0.5)`;
     `g1` right `(gx+gw, cy)` → `xfKb` entry `(1, 0.5)`
   - Vertical: `g0` top `(cx, gy)` → `xfK` entry `(0.5, 0)`;
     `g1` bottom `(cx, gy+gh)` → `xfKb` entry `(0.5, 1)`
3. **Ring assignment by proximity** (do not keep the generator’s original
   `bus→xfK` / `bus→xfKb` labels if they disagree):
   - Bus nearer `g0` → `target=xfK`, entry `e0`
   - Bus nearer `g1` → `target=xfKb`, entry `e1`  
   Verify after edits: horizontal stubs only use entries `(0,0.5)` / `(1,0.5)`;
   vertical only `(0.5,0)` / `(0.5,1)`.
4. Bus exit is **head-on** to the group orientation (not free L/R/T/B by
   joint delta): horizontal XF → exit L or R; vertical XF → exit T or B.
   Clear of equipment (re-check after §4 if gen side flips):
   - Gen on the **left** (~frac 0.34) → leftward xf exit use ~`exitY=0.82`
   - Gen on the **right** (~frac 0.34) → rightward xf exit use ~`exitY=0.82`
   - Load on the **right** (~frac 0.55) → rightward xf exit use ~`exitY=0.28`
5. Waypoints: one approach point just outside the ring outer edge along the
   entry normal. Add a short leave-from-bus waypoint only when bus exit and
   joint are not already collinear (IEEE 39 `xfg3` 6–31 is collinear → one WP).
6. Keep both stub edges as `source=busN` `target=xfK|xfKb` (never the group).

### 3. Stubbed bus–bus branch multilines (H–diag–H)

Convert straight (or degenerate single-waypoint) **bus→bus** edges to the
stubbed diagonal style already used on hand-tuned edges (e.g. IEEE 39 `e6` /
`e27`):

```
bus A side port → short horizontal stub → diagonal trunk → short horizontal stub → bus B side port
```

**In scope:** `eM` with `source=bus*` and `target=bus*`.  
**Out of scope:** transformer stubs (`bus→xf*`), gen/load leads (`sgN` / `slN`),
bus / XF / symbol positions. Do **not** change the generator unless asked.

Concrete rules:

1. Parse cells; build `busN → (x, y, w, h)`.
2. Inventory each bus–bus edge:
   - **Keep** if it already has ≥2 usable waypoints and looks correct.
   - **Skip** pure H/V alignments (`|dx| < BRANCH_ALIGN_EPS` or
     `|dy| < BRANCH_ALIGN_EPS`) — leave as a single segment (clear any
     degenerate 1-point array).
   - **Rewrite** otherwise (0 waypoints or 1 degenerate point).
3. Facing sides from relative bus centres: left bus exits right (`exitX=1`);
   right bus enters left (`entryX=0`); swap when the source is on the right.
4. Prefer **side ports** only: `exitX/entryX ∈ {0,1}`. Then **uncross** (§3b).
5. Insert **two** waypoints in `<Array as="points">`:
   - WP1 ≈ `BRANCH_STUB` px past the source bar at exit height
   - WP2 ≈ `BRANCH_STUB` px before the target bar at entry height  
   Clamp stub length (~8–20 px) so the stubs do not cross each other when
   buses are close.
6. Style: keep `endArrow=none`, `rounded=0`, `strokeWidth=1.5`. **No**
   `edgeStyle=orthogonalEdgeStyle` — explicit waypoints only (Diagram-tab /
   generator contract).
7. Do not touch `xfg*` / `xf*` / `sg*` / `sl*` / labels (except XF `exitY`
   when §3b restaggers a shared face).

One-shot Python edit of the drawio XML (same family as bus-move / xf-fix
scripts) — not a generator change.

### 3b. Uncross same-side anchors (by peer Y)

When two or more attachments share one L/R face of a bus, sorting by edge id
leaves X-crossings (e.g. IEEE 39 Bus-14, Bus-10). Order ports by the **peer’s
vertical position** so the upper peer uses the upper tap.

1. Build each face `(busN, side∈{0,1})` from:
   - bus–bus `eM` exits and entries on that side
   - XF stubs `bus→xf*` with `exitX∈{0,1}` (use `xfgK` centre Y as peer Y)  
   Exclude `sgN` / `slN` and T/B XF exits (`exitX=0.5`).
2. Sort attachments on the face by peer Y ascending (top → bottom). Assign
   `exitY` / `entryY` spaced across `[0.2, 0.8]`:
   - one attachment → `0.5`
   - `n≥2` → `0.2 + 0.6 * i / (n-1)` for `i = 0 … n-1`
3. **Exit and entry on the same face share one ordering** — do not stagger
   them in separate lists (that left Bus-14 both at 0.5).
4. Rebuild H–diag–H waypoints after changing Y; for XF stubs, move the
   leave-from-bus waypoint to the new exit height (keep ring entry).

Canonical checks: Bus-14 right (15 above @0.2, 13 below @0.8); Bus-10 right
(13 above @0.2, XF→32 below @0.8).

### 4. Place gen on the lighter branch side

Put each generator on the side of `busN` with **fewer** branch attachments so
the gen does not share a crowded face with stubs (canonical: IEEE 39 Bus-38 —
branch/XF on left, gen on right).

Run **after** XF stubs (§2) and bus–bus ports (§3) so L/R counts are final.

1. Count L vs R on `busN` from bus–bus `eM` and XF stubs (`bus→xf*`). Use
   `exitX`/`entryX` ≈ 0 → left, ≈ 1 → right. **Exclude** `sgN` / `slN`.
   Top/bottom ports do not affect the L/R preference.
2. Prefer the side with the smaller count. **Tie** (including both zero): keep
   the current side (usually left).
3. Recompute `ggN` with the left or right formula above; set `sgN` ports:
   - left: `exitX=0;exitY=GEN_FRAC;entryX=1;entryY=0.5`
   - right: `exitX=1;exitY=GEN_FRAC;entryX=0;entryY=0.5`
   Clear any `sgN` waypoints.
4. If a load already occupies the preferred right side, keep gen left or stagger
   `GEN_FRAC` so symbols do not overlap.
5. If a gen flipped onto a side that already has an XF stub, re-check that
   stub’s `exitY` (§2 step 5) so it clears the gen lead.

IEEE 39 (`ieee39-oneline-generate.drawio`) outcome: flip **32–38** right
(L=1,R=0); keep **30** left (lighter); keep **31** / **39** on tie.

### 5. Verify and preview

```bash
PY="${DSH_PYTHON:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3}"

"$PY" src/main/py/diagram/gen_oneline_diagram.py <case_dir> \
  --check <case>/diagram/<stem>-oneline.drawio \
  --symbols both --no-anchor

# Authoritative raster (needs full permissions / --no-sandbox)
/Applications/draw.io.app/Contents/MacOS/draw.io --no-sandbox --export --format png \
  --output <case>/diagram/<stem>-oneline-preview.png \
  --scale 2 --border 20 \
  <case>/diagram/<stem>-oneline.drawio
```

Crop the PNG around problem buses / former diagonals / flipped gens
(e.g. IEEE 39: 2–3, 16–21, 25–26, Bus-38) to confirm:

- XF stubs hit ring **outer** edges (no line through the OO); clear gen/load leads
- Bus–bus edges show short horizontal stubs at both ends, then a diagonal trunk
- Same-side taps ordered by peer Y (no local X at the bar; XF stubs included)
- Gen sits on the lighter L/R face (not stacked on the XF/branch stub side)
- All bars/symbols sit inside the page grid (`bg` size matches `pageWidth`×`pageHeight`)

`--no-anchor` is required for a hand-adjusted classic layout: the generated-diagram rule
"Bus-1 is top-left-most" does not apply once the buses follow a reference schematic.

`--check` may still report pre-existing notes on a classic layout (stray
non-`eM` edges, gen/load slightly outside the generated footprint box). That is
OK if bus tooltips (`busN` / `Bus-N`) still resolve and new routing did not
introduce arrowheads or broken sources/targets.

## IEEE 39 reference (classic New England)

Typical clusters when matching the published one-line (vertical bars, relative
placement — not geography):

| Region | Buses |
|---|---|
| Northern corridor | 30(G10)–2–25–37(G8)–26–28–29–38(G9) |
| Left spine | 1–39(G1)–9 |
| Southwest | 4–5–8–7–6–31(G2) |
| South-central | 14–15–11–12–13–10–32(G3) |
| Hub / east | 16–17–18–27; 21–22–24–23; 35(G6), 36(G7) |
| Southeast | 19–20–33(G4)–34(G5) |

Transformer pairs in the symbols file (example): 12–11, 12–13, 6–31, 10–32,
19–33, 20–34, 22–35, 23–36, 25–37, 2–30, 29–38, 19–20.

Example hand-tuned stubbed bus–bus edges to preserve unless broken: `e6`,
`e15`, `e18`, `e27`, `e28`, `e32`. Pure H/V leave alone: `e5` (4–3 vertical),
`e33` (29–26 horizontal).

Gen lighter-side flips on the generate file: `gg32`–`gg38` on the **right**;
`gg30` / `gg31` / `gg39` stay **left**.

## Do / don’t

| Do | Don’t |
|---|---|
| Edit the case’s existing `.drawio` in place | Re-run the generator over a hand layout |
| Move `ggN`/`lgN`/`nmN` with `busN` | Leave gen/load at old coordinates |
| Gen on the lighter L/R branch side | Leave gen stacked on a crowded stub face |
| Entry on ring **outer** edge; nearer `g0`→`xfK` | Inner-face / swapped rings (line through OO) |
| Grow `pageWidth`/`pageHeight` **and** `bg` together | Leave `bg` at the old generate size |
| Side ports + 2-waypoint H–diag–H on diagonals | Full Manhattan / `orthogonalEdgeStyle` on bus–bus |
| Same-face taps by peer Y (include XF stubs) | Stagger by edge id only / ignore XF on that face |
| Keep hand-tuned ≥2-waypoint polylines | Force stubs onto pure H/V collinear edges |
| Keep `busN` / `Bus-N` / `xfg` group ownership | Rename ids or ungroup xf rings |
| Export PNG after substantive edits | Rely only on the Pillow generator preview |

## Related

- `$ipss-case-diagram` — generate a new diagram from ACLF result tables
- `src/main/py/diagram/gen_oneline_diagram.py` — style contract and self-check
- `wspace/template/oneline-diagram.drawio` — hand-laid IEEE 14 style reference
- `wspace/data/ieee/ieee39/diagram/ieee39-oneline.drawio` — classic layout + stubbed branches
- `wspace/data/ieee/ieee39/diagram/ieee39-oneline-generate.drawio` — same layout + lighter-side gens (32–38 right)
