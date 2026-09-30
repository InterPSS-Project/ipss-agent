# One-Line Diagrams — Process Summary

## Goal

Produce a power-grid **one-line diagram** in draw.io for an InterPSS case — vertical bus bars,
undirected branches, two-ring transformer symbols, `Bus-N` labels — and save it as a `.drawio`
under the case's `diagram/` folder, where the **Diagram** tab previews it.

## Where the diagrams live

| Diagram | File | How it was made |
|---------|------|-----------------|
| Style reference | `wspace/template/oneline-diagram.drawio` | hand-laid IEEE 14-bus diagram, the visual contract for everything else |
| Hand-laid cases | `wspace/data/ieee/Ieee14Bus/diagram/ieee14-oneline.drawio`, `wspace/data/ieee/Ieee14Bus_LargeLoadQ/diagram/ieee14-oneline*.drawio` | authored/edited in draw.io over the draw.io MCP, then repaired and saved page by page |
| Generated cases | `wspace/data/ieee/Ieee118Bus/diagram/ieee118-oneline.drawio` | `wspace/script/gen_oneline_diagram.py` |

Hand layout does not scale — the IEEE 118-bus case is 118 buses / 186 branches — so anything past a
small teaching case takes the generated path below. Both paths produce the same shapes, sizes,
palette and cell conventions.

## Inputs

| Input | Role |
|-------|------|
| `<case>/result/<stem>_DF_bus.csv` | buses: id, number, name, type, load, generation |
| `<case>/result/<stem>_DF_branch.csv` | lines and transformers: from–to, `IsXfmr`, `Circuit` |
| `wspace/template/oneline-diagram.drawio` | style reference (geometry, styles, legend wording) |

The two CSVs are written by an AC load flow, so run `$ipss-case-aclf` on the case first.

## Path A — hand-laid reference (IEEE 14-bus)

1. **Ingest** the bus/branch CSVs; sketch the topology (HV buses 1–5, 7, 8 on top; LV 6, 9–14 below).
2. **Emit** `mxGraphModel` XML: vertical bus bars, branches, transformer symbols.
3. **Preview** in draw.io; export a PNG for review when geometry matters.
4. **Iterate** on layout, labels and overlaps from review feedback.
5. **Author/repair** with the official draw.io MCP (`@drawio/mcp` 1.6.1 — `open_drawio_xml` plus `list_pages` / `get_page` /
   `set_page`, and `wspace/script/drawio_mcp.py` drives the same server from a shell); the community `next-ai-draw-io` connector was dropped early on.
6. **Deliver** the `.drawio` into the case's `diagram/` folder.

This path is cell-by-cell XML editing with the draw.io MCP as the editor. It is how the template's
per-corridor routing and staggered taps were tuned, and why the template is worth copying rather
than reinventing.

## Path B — generated diagrams (current)

```bash
# Needs numpy + Pillow. The harness's bundled runtime has both (its path is the one
# `load_workspace_dependencies` reports, e.g.
#   ~/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3);
# a bare `python3` on this Mac has numpy but no Pillow, so pass --no-png there.
"$PY" wspace/script/gen_oneline_diagram.py wspace/data/ieee/Ieee118Bus \
    --title "IEEE 118-Bus One-Line Diagram"
```

| Step | Detail |
|------|--------|
| Layout | all-pairs hop distances from the branch list -> stress majorization (SMACOF); a scale search with neighbour attraction and footprint collision repair compacts it; the drawing is reshaped towards a page-friendly aspect, oriented so the case's first bus sits at the upper-left corner, and snapped to a 10 px grid |
| Footprint | one bus = bar 6x52 with its `Bus-N` label above; the repair keeps footprints from overlapping, so no two bars or labels collide |
| Branches | straight black lines with staggered taps per bar side; a short local hop around a bar only when a straight line would cut through one |
| Transformers | `IsXfmr` branches -> two interlocking 16x16 rings inside **one** `style=group` cell, placed on the branch trunk -- along it first, then stepped aside -- so the pair stays inline and clear of every bar and label, chained by two stub edges |
| Annotations | none: no bus data, no branch P/Q, no voltage colours |
| Outputs | `<case>/diagram/<stem>-oneline.drawio` and `<stem>-oneline-preview.png` (a Pillow re-render of the same geometry) |
| Self-check | the run reads the file back and checks `busN` ids, `Bus-N` labels, no arrowheads, one ring pair per transformer clear of every bar and label, the first bus at the upper-left corner, and that every branch resolves to a hover pair — the way the plugin's preview reads it |
| Flags | `--out`, `--title`, `--png` / `--no-png`, `--scale`, `--seed`, `--open` (hand the result to the draw.io editor); `--check FILE` re-runs just the self-check |

Result for the reference case: `wspace/data/ieee/Ieee118Bus/diagram/ieee118-oneline.drawio` —
1900 x 1700, 465 cells, 118 bus bars, 186 branches (177 lines + 9 transformer symbols), 195 edges,
no overlapping footprints. The generator is case-agnostic and was also exercised on
`wspace/data/ieee/Ieee14Bus`.

### Native draw.io desktop app

The desktop app (`/Applications/draw.io.app`, 31.5.3) renders these files natively — the authoritative
picture, unlike the Pillow preview. Open one by hand, or headless-export it:

```bash
open -a draw.io wspace/data/ieee/Ieee118Bus/diagram/ieee118-oneline.drawio        # GUI

/Applications/draw.io.app/Contents/MacOS/draw.io --no-sandbox \
    --export --format png --scale 2 --output /tmp/ieee118.png \
    "$PWD/wspace/data/ieee/Ieee118Bus/diagram/ieee118-oneline.drawio"             # headless
```

`--no-sandbox` is required when the export runs inside this harness: the harness's own file sandbox
otherwise blocks the Electron/Chromium sandbox ("Failed to initialize sandbox. Operation not
permitted") and the renderer dies. The input path should be absolute. `--format svg|pdf` works too
(`--crop` trims to the drawing). `gen_oneline_diagram.py <case> --app-export [PNG]` runs that export
for you after the self-check (default `<stem>-oneline-drawio.png`; `--app PATH` if the install lives
elsewhere).

Rendering the real app is worth it: it immediately showed two defects the Pillow preview cannot —
the legend's line break disappeared (draw.io collapses a literal newline in an `html=1` label, so the
break must be an escaped `<br>`), and on a narrow page the legend box painted over the title while
the overflowing header cells made the exporter widen the page (600 -> 1041 units). Both are fixed:
header cells are now sized to the page, and the legend stacks under the subtitle when the title
column would be thinner than 340 units.

### Hand-off and round-trip through the draw.io MCP

The generated file can be opened in — and edited back from — the draw.io editor through the official
draw.io MCP server. `@drawio/mcp` 1.6.1 is pinned at `$DSH_HOME/mcp-servers/drawio`, and DSH mounts it
from the profile's `mcp-drawio` row (`@deepseek-ai/dsh-mcp-client`, stdio, `/opt/homebrew/bin/node`),
where its tools appear as `mcp__drawio__<tool>` (tools only — the server declares no MCP resources).
Profile rows are composed when the app starts, so a session that began before the row was added has
none of them until DSH restarts.

**Wiring, and the trap it hides.** In `~/.dsh/profiles/desktop/cordis.patch.yml` a *new* row must be
inserted — a bare `- id:` patch targets an existing row, and a target that matches no row is warned
about and skipped, silently, restart after restart:

```yaml
- insert:
    - id: mcp-drawio
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: drawio
        transport: stdio
        command: /opt/homebrew/bin/node
        args:
          - /Users/mzhou/.dsh/mcp-servers/drawio/node_modules/@drawio/mcp/src/index.js
```

Two read-only checks confirm it, both available to an agent through `cordis_inspect_query`:
`Config.listConfigs` with `{name: "@deepseek-ai/dsh-mcp-client"}` should return one entry — its id is
`include:mcp-drawio`, not `mcp-drawio`, so querying the bare patch id reports "unknown entry id" even
when the row is healthy — and `Tool.listTools` should list the seven `mcp__drawio__*` tools.

| Tool | Role |
|------|------|
| `open_drawio_xml` | Open a diagram in the browser editor — also what `--open` calls |
| `list_pages` / `get_page` / `set_page` | Read or replace one page of a local `.drawio` file |
| `open_drawio_csv` / `open_drawio_mermaid` | draw.io's importers, which auto-lay generic diagrams |
| `search_shapes` | draw.io shape-library search (it does include `mxgraph.electrical.*`) |

`wspace/script/drawio_mcp.py` speaks the same stdio protocol, so the round-trip also works from a host
without the MCP tools (Codex, Claude Code, a plain shell): `list`, `get [--out PATH]`,
`set --page N --content FILE|-`, `open`, `shapes`. Measured on a generated 14-bus diagram:
`get_page` leaves the file byte-identical, a `set_page` of the same page returns identical page XML,
and `--check` still passes on the MCP-written file (75 cells, 25 edges, 5 transformer groups).
`set_page` re-serialises the file, so its byte length changes even when the diagram does not.

`gen_oneline_diagram.py <case> --open` does generate -> self-check -> open in one step. Keep the
CSV/Mermaid importers and the ELK `postLayout` out of this path: they auto-place generic shapes and
drop the bus bars, the transformer `group` cells and the `busN` / `Bus-N` ids that the app's
bus/branch tooltips resolve against.

## Diagram rules (final)

| Rule | Detail |
|------|--------|
| Bus shape | vertical bar **6 x 52**, fill `#666666`, stroke `#333333` — the same grey for every bus, whatever its voltage |
| Labels | `Bus-N` only (no name, no data), centred **above** its bar, drawn as a white-filled rect so the paper box masks any wire beneath the text |
| Branches | thin black (`strokeWidth 1.5`), **undirected** (`endArrow=none`), no edge text, staggered taps so parallel lines leave a bar at different heights |
| Transformers | two interlocking 16 x 16 rings (`fillColor=none`, centres 8 px apart) inside one `style=group` cell, sitting inline on the branch |
| Routing | straight by default; a short local hop around a bar only when a straight line would cross one. Explicit waypoints, no `edgeStyle` — so draw.io and the in-app preview draw the same polyline |
| Orientation | the case's **first bus (Bus 1)** sits in the **upper-left corner**: it is the leftmost *and* topmost bar, every other bus is right of and below it |
| Page | white background rect over the page, title and subtitle top-left, legend box top-right listing only the symbols |
| Voltage | not drawn. The subtitle names the levels only when the data supports it: the IEEE `Vn` name suffix when present (`V1` 345 kV, `V2` 138 kV, `V3` 161 kV), else the bus table's `NomVolt` when that is a real voltage (`132000` -> 132 kV), else no voltage text at all |

## How the app reads a diagram

- **Bus cells** are `busN` (lowercase) and their labels read `Bus-N`; either resolves to the bus, and
  the host matches the id against the result tables' spelling (`bus118` -> `Bus118`).
- **A branch** is one edge between two bus cells, or two stub edges chained through the transformer's
  `group` cell — the group is what pairs both rings *and* both stubs with the same branch, so
  hovering any part of a transformer gives one tooltip.
- **Hit areas**: the drawn geometry is far too thin to hover (a 6 px bar, a 1.5 px line), so the
  preview adds a padded transparent rect or a wide invisible stroke twin per interactive cell.
- **Preview** (the **Diagram** tab, plugin 0.6.8+; 0.6.1–0.6.8 also had a **Diagram** button
  on the InterPSS tab that opened the same preview in a modal — 0.6.9 removed button and modal,
  so the tab is the only surface): lists the selected case's `diagram/*.drawio`, renders inline
  SVG with a **Source** toggle, pans/zooms/fits, follows the app theme (near-grey colours are
  re-expressed as theme tokens; a deliberately coloured element keeps its colour), and
  shows bus/branch tooltips built from the case's result tables. It renders the subset these
  diagrams use — rounded rects, ellipses, text, groups, polylines through waypoints — and
  caps a scene at 2000 cells. The **Diagram** tab (order 2, beside InterPSS) draws it full-size
  and follows whichever case
  the InterPSS tab has selected. Implementation notes:
  [persistent-plugin-rebuild.md](persistent-plugin-rebuild.md).

## Issues found and fixed

| Issue | Fix |
|-------|-----|
| Horizontal buses (early 14-bus draft) | Switched to vertical bus bars |
| Overlapping branches, wires cutting labels | Staggered tap heights, waypoints, white label boxes, rerouted corridors (e.g. Bus-4 in the 14-bus file) |
| Full bus data on labels | Reduced to `Bus-N` |
| Wrong transformer orientation | Vertical vs horizontal rings by span direction |
| Malformed XML (extra `</mxCell>` on labels) | Repaired tags; whole file wrapped as `<mxfile>` with a named page |
| Bus size | Scaled to ~75% -> 6 x 52 |
| Transformer rings drawn as a broken open arc | The second ring's opaque `fillColor=#FFFFFF` painted over the first ring's inner arc. Both rings are `fillColor=none`, so they interlock with complete outlines |
| Two stray edges from a transformer to the page background | An edge wired `xf10b -> bg` with `edgeStyle=none` and no `endArrow=none` draws a diagonal across the drawing ending in an arrowhead — a one-line diagram is undirected. The IEEE 14-bus working copies carry none; the template in `wspace/template/` carried one (`id="8"`), the only edge of its 26 that set neither `endArrow=none` nor `strokeColor`. **Dropped from `oneline-diagram.drawio`** (0.6.8), so the template and the 14-bus case diagram now parse to the same 25 edges — which is the guard's §11 check |
| Collision repair left pairs exactly at the threshold, so grid snapping broke them again | Split the comfort target used by the relaxation from the hard no-overlap test used for snapping and validation |
| Force-directed spreading flattened the topology into a hairball | Layout is stress majorization on hop distances; force spreading is only used to compact it |
| Transformer symbols floated up to ~160 px off their branch | Each symbol is placed on the branch trunk and slid along that line when the spot is taken; both stubs stay straight and collinear |
| Voltage colours (tried, then removed on request) | Every bar uses the template grey; the name suffix only feeds the subtitle |
| Legend collapsed to one long line in draw.io | The legend used a literal newline in an `html=1` label; draw.io treats that as a space, so the two lines merged. The break is now an escaped `<br>`, which both draw.io and the plugin preview render as a line break |
| Legend painted over the title, page widened by 441 units | On the 600-unit pages the legend sat at `page_w - 370` and the title/subtitle cells were a fixed 800/1000 wide, so they ran under the legend and past the page edge; the exporter then widened the page to fit. Header cells are now measured against the page and the legend stacks under the subtitle when the title column would be under 340 units |
| Transformer symbol clipped by a bus label | Labels paint last, so a symbol that overlapped one lost part of a ring (the Bus-7 cluster in the 14-bus cases). Placement now searches outward from the branch trunk -- along it, then stepping aside, avoiding bars **and** labels -- and the self-check fails on any overlap that remains |
| Bus 1 landed wherever the layout put it (middle-right on the 14-bus cases) | The finished layout is rotated rigidly -- a sweep picks the angle that brings Bus 1 closest to the corner, which costs no distance -- and a pinned pass then eases any bus still above or left of it into its lower-right quadrant, so Bus 1 is the clear top-left-most bus. The self-check fails if it is not |
| Subtitle claimed a voltage the case does not have | The `Vn` suffix convention is IEEE-118-specific; cases without it (the 14-bus CDF files) fell back to a made-up `138 kV`. The subtitle now uses the suffix, else `NomVolt` when it is a real voltage, else nothing |

## Limitations

- **The self-check encodes the generated conventions**, including the Bus 1 corner rule, so running
  `--check` on the hand-laid IEEE 14-bus template reports that rule as failed — that file predates it.
- **The template is a live file.** `wspace/template/oneline-diagram.drawio` is hand-edited in
  draw.io, so it drifts from the IEEE 14-bus working copies (view offsets, attribute order, and the
  stray `xf10b -> bg` edge noted above). Treat it as the style contract, not as byte-identical to
  the case diagrams, and re-check a case diagram against it before copying conventions.
- **Axes are layout, not geography.** Hop distance drives position, so the drawing shows topology:
  two buses drawn side by side are a few branches apart, not a few miles.
- **Wires still cross.** 186 branches over 118 bars cannot be crossing-free; the *geometry* is
  collision-free (bars, labels, transformer symbols), the routes are not.
- **The preview is approximate.** No orthogonal auto-routing, no arrowheads, single font size; open
  the file in draw.io when exact geometry matters. A fitted 1900 x 1700 drawing makes 11 px labels
  small until you zoom in.
- **The preview PNG is not a diagrams.net export** — it is a Pillow re-render of the same geometry,
  for a quick look and for review before opening draw.io.
- **The Diagram tab shows one diagram at a time** (plugin 0.6.6+); extra `.drawio` files in
  `diagram/` add a picker entry, and the one last viewed is reopened. The preview PNG never
  appears, since the tab lists `.drawio` files only.
