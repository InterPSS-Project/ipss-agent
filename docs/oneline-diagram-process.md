# IEEE 14-Bus One-Line Diagram — Process Summary

## Goal

Build an IEEE 14-bus power-grid **one-line diagram** in draw.io from bus/branch CSV data, matching a classic template layout, then iterate on layout/label rules and save a usable `.drawio` file.

## Inputs

| Input | Role |
|-------|------|
| Bus CSV | Bus list / IDs |
| Branch CSV | Lines and transformers (from–to) |
| Template JPEG | Classic IEEE 14 one-line reference layout |

## Tools used

1. **Community connector (later removed):** `next-ai-draw-io` — create/edit/export session in draw.io (`user-drawio`).
2. **Official Draw.io MCP (kept):** `@drawio/mcp` as `user-drawio-official` — `list_pages` / `get_page` / `set_page`, open XML/CSV/Mermaid in the editor.
3. Box workspace files under `/workspace/` (e.g. `ieee14-oneline.drawio`), then copy to the Mac via `CopyFromBox` → `Downloads/`.
4. **In-app preview (since plugin 0.6.1):** the InterPSS tab's **Diagram** button lists the
   `.drawio` files in the **selected case's `diagram/` folder** (`wspace/data/ieee/Ieee14Bus/diagram/`)
   and renders the selected one as inline SVG in a modal, with a **Source** toggle for the raw XML —
   no browser round-trip and no MCP call. Since **0.6.6** the button is enabled only when that folder
   holds at least one `.drawio`, and a case with exactly one opens it directly without the picker.
   The renderer is approximate by design (rounded rectangles, ellipses,
   text labels, orthogonal edges); open the file in draw.io when exact geometry matters. Since
   **0.6.2** the preview also pans (drag), zooms about the cursor (wheel, 0.1x–12x) and fits the
   whole diagram (**Fit**), with a live zoom percentage in the header. Since **0.6.5** it also
   follows the **app theme**: the model's grayscale palette (paper, ink, mid greys) is
   re-expressed as theme tokens, so in the dark theme the diagram is light-on-dark instead of a
   white slab. Since **0.6.7** hovering a **bus** (its bar or its `Bus-N` label) or a **branch**
   (a line, either half of a transformer chain, or the transformer symbol) shows the same
   tooltip the Bus connection diagram shows, from the same builders — the case's result tables
   are the source, and a case with no results says so instead of showing an empty panel. See
   [persistent-plugin-rebuild.md](persistent-plugin-rebuild.md) for the
   implementation notes.

## Workflow

1. **Ingest** bus and branch CSVs; sketch topology (HV buses 1–5, 7, 8 on top; LV 6, 9–14 below).
2. **Generate** draw.io `mxGraphModel` XML: vertical bus bars, orthogonal branches, transformer symbols.
3. **Load / preview** in draw.io; export PNG for review when needed.
4. **Iterate** from user feedback (layout, labels, overlaps).
5. **Switch MCP:** install official `@drawio/mcp`, remove `next-ai-draw-io`.
6. **Repair & finalize** with official tools: fix malformed XML, wrap as mxfile, clear label–wire overlaps, `set_page` to save.
7. **Deliver** `.drawio` (and optional geometry PNG preview); copy to `Downloads/ieee14-oneline.drawio` on the Mac.

## Diagram rules (final)

| Rule | Detail |
|------|--------|
| Bus shape | Vertical bars, ~**6 × 52** |
| Labels | **ID only** (`Bus-1` … `Bus-14`); **above** the bar; white label background so wires don’t cut text |
| Branches | No overlapping corridors; staggered taps + orthogonal routing |
| Annotations | **No** branch P+jQ (or similar) text on edges |
| Transformers | **Vertical** stacked ○○ on vertical spans: 4–9, 5–6, 7–9; **horizontal** ○○: 4–7, 7–8 |

## Issues found and fixed

| Issue | Fix |
|-------|-----|
| Horizontal buses (early) | Switched to vertical bus bars |
| Overlapping branches | Staggered tap heights and waypoints |
| Wrong XF orientation | Vertical vs horizontal by span direction |
| Cluttered edge labels | Removed branch annotations |
| Full bus data on labels | Reduced to `Bus-N` only |
| Wire through label (e.g. Bus-4) | Labels above bars + white fill; reroute corridors (e.g. e5, e6, e16, e17); nudge Bus-4/5/6/9 |
| Malformed XML (extra `</mxCell>` on labels) | Repair tags; wrap as `<mxfile>` / page `IEEE 14-Bus` |
| Bus size | Scaled to ~75% → 6×52 |
| Transformer rings rendered as a broken open arc | Each symbol is two 16×16 ellipses whose centres are 8px apart (50% overlap). The second ellipse's opaque `fillColor=#FFFFFF` painted over the first one's inner arc, so the top ring showed as a partial arc — in the preview and in draw.io alike, since the file is what says `#FFFFFF`. Both rings are now `fillColor=none`, so they interlock with both outlines complete |
| Two stray edges from a transformer to the page background | `id=2` and `id=8` wired `xf10b → bg` (the 900×760 background rect) with `edgeStyle=none` and no `endArrow=none`, so they drew long diagonals across the drawing ending in an arrowhead — a one-line diagram is undirected. Both edges deleted; the file now has 25 edges and no arrowheads |

## Outputs

| File | Location |
|------|----------|
| Editable diagram | `/workspace/ieee14-oneline.drawio` (also `Downloads/ieee14-oneline.drawio` on Mac) |
| Geometry preview PNG | `/workspace/ieee14-oneline-fixed.png` (approximate; open `.drawio` for authoritative view) |

## Connector note

- **Use:** official Draw.io MCP (`drawio-official` / `@drawio/mcp`).
- **Removed:** community `next-ai-draw-io` (`user-drawio`).

## Limitations

- PNG/SVG previews may be geometry approximations, not native diagrams.net export.
- Dense LV area (buses 6 / 11 / 13) still has tight parallel corridors; labels should clear wires after the final pass.
