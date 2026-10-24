---
name: ipss-drawio-adjust
description: >-
  Hand-adjust an existing InterPSS one-line .drawio — move bus bars to match a
  classic/reference layout, keep each bus's generator and load symbols attached,
  and rewire transformer stub edges to ring outer edges. Use when the user asks
  to adjust bus locations, fix transformer connections, align a diagram to a
  reference one-line (e.g. IEEE 39), or edit ieee*-oneline*.drawio without
  regenerating from the force/lattice layout.
metadata:
  short-description: Hand-adjust case one-line drawio layout
---

# InterPSS Draw.io Adjust

Hand-edit an **existing** case one-line `.drawio` (bus positions, equipment
symbols, transformer stubs). Do **not** regenerate with
`gen_oneline_diagram.py` — that overwrites hand layout. For a fresh diagram from
result CSVs, use `$ipss-case-diagram` instead.

## When to use

- “Move buses to match this classic IEEE 39 diagram”
- “Keep gen/load together when moving the bus”
- “Transformer connections are wrong / lines go through the rings”
- Any edit to `<case>/diagram/*-oneline*.drawio` that must preserve topology
  and equipment symbols

## Cell id contract (do not rename)

| Kind | Ids | Notes |
|---|---|---|
| Bus bar | `busN` | 4×52 vertical bar, fill `#666666` |
| Label | `nmN` | value exactly `Bus-N`, 46×18 above the bar |
| Generator | `ggN` / `genN` + lead `sgN` | gen on the **left** of the bar |
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
```

Relative to bus bar top-left `(x, y)`:

| Part | Position |
|---|---|
| Label | `(x - (LABEL_W-BUS_W)/2, y - LABEL_GAP - LABEL_H)` |
| Gen group | `(x - SYM_STEM - 2*GEN_R, y + BUS_H*GEN_FRAC - GEN_R)` |
| Load group | `(x + BUS_W + SYM_STEM - LOAD_W/2, y + BUS_H*LOAD_FRAC + LOAD_DROP)` |
| Load lead waypoint | `(x + BUS_W + SYM_STEM, y + BUS_H*LOAD_FRAC)` |

## Workflow

### 1. Move buses (keep gen/load/label together)

1. Decide target `(x, y)` for every `busN` (classic schematic, user sketch, etc.).
2. For each bus, set geometry of `busN`, `nmN`, and if present `ggN` / `lgN`
   from the formulas above — **recompute**, do not only translate by delta if
   the relative offsets might already be wrong.
3. Refresh `slN` waypoints; clear stale `eM` branch waypoints.
4. Keep footprints clear: ≈52×72 boxes must not overlap (self-check
   `overlapping bus footprints`).
5. Expand `pageWidth` / `pageHeight` / `bg` if content grows.

Hand-laid classic layouts often fail the generated-diagram rule “Bus-1 is
top-left-most” — that is expected; do not force Bus-1 into the corner if the
reference schematic places it elsewhere.

### 2. Fix transformer connections

Stubs must attach to **ring outer edges**, never the centre
(`entryX=0.5;entryY=0.5` makes the line look like it passes through the OO).

Follow `gen_oneline_diagram.plan()`:

1. Place `xfgK` on the trunk midpoint between the two bus bar centres.
   Orientation: horizontal if `|dx| ≥ |dy|`, else vertical.
   - Horizontal group: `24×16`, rings at `(0,0)` and `(8,0)`
   - Vertical group: `16×24`, rings at `(0,0)` and `(0,8)`
2. Joints and entries:
   - Horizontal: left `(gx, cy)` entry `(0, 0.5)`; right `(gx+gw, cy)` entry `(1, 0.5)`
   - Vertical: top `(cx, gy)` entry `(0.5, 0)`; bottom `(cx, gy+gh)` entry `(0.5, 1)`
3. Bus nearer the first joint (`g0`) connects to `xfK`; the other to `xfKb`.
4. Bus exit faces the joint (L/R/T/B). Prefer head-on exits that match the
   entry side. Use a short orthogonal waypoint at exit height, then jog to the
   joint if needed.
5. Clear of equipment:
   - Gen is on the **left** (~frac 0.34) → leftward xf exit use ~`exitY=0.82`
   - Load is on the **right** (~frac 0.55) → rightward xf exit use ~`exitY=0.28`
6. Keep both stub edges as `source=busN` `target=xfK|xfKb` (never the group).

### 3. Verify and preview

```bash
PY="${DSH_PYTHON:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3}"

"$PY" src/main/py/diagram/gen_oneline_diagram.py <case_dir> \
  --check <case>/diagram/<stem>-oneline-symbols.drawio \
  --symbols both

# Authoritative raster (sandbox needs --no-sandbox)
/Applications/draw.io.app/Contents/MacOS/draw.io --no-sandbox --export --format png \
  --output <case>/diagram/<stem>-oneline-symbols-preview.png \
  <case>/diagram/<stem>-oneline-symbols.drawio
```

Crop the PNG around problem buses to confirm stubs hit ring edges and do not
merge with gen/load leads.

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

## Do / don’t

| Do | Don’t |
|---|---|
| Edit the case’s existing `.drawio` in place | Re-run the generator over a hand layout |
| Move `ggN`/`lgN`/`nmN` with `busN` | Leave gen/load at old coordinates |
| Entry on ring **outer** edge | `entryX=0.5;entryY=0.5` on xf rings |
| Keep `busN` / `Bus-N` / `xfg` group ownership | Rename ids or ungroup xf rings |
| Export PNG after substantive edits | Rely only on the Pillow generator preview |

## Related

- `$ipss-case-diagram` — generate a new diagram from ACLF result tables
- `src/main/py/diagram/gen_oneline_diagram.py` — style contract and self-check
- `wspace/template/oneline-diagram.drawio` — hand-laid IEEE 14 style reference
