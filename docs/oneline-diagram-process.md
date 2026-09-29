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
