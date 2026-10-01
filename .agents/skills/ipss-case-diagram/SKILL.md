---
name: ipss-case-diagram
description: Use when asked to draw, create, regenerate or refresh a one-line diagram for an InterPSS simulation case — "draw the one-line diagram for this case", "make a diagram like the template", "put it in the case's diagram folder" — writing <case>/diagram/<stem>-oneline.drawio plus a PNG preview from the case's ACLF result CSVs, in the style of wspace/template/oneline-diagram.drawio.
metadata:
  short-description: Generate a case one-line diagram
---

# InterPSS Case Diagram

Draw the **one-line diagram** for a simulation case — vertical bus bars, undirected branches,
two-ring transformer symbols and `Bus-N` labels — and write it into the case's own `diagram/` folder,
where the **Diagram** tab previews it.

The diagram is **generated, never hand-placed**. `wspace/script/gen_oneline_diagram.py` lays the
network out from the case's result tables, routes every branch and writes both the `.drawio` and a
raster preview. The hand-laid `wspace/template/oneline-diagram.drawio` (IEEE 14-bus) is the style
contract that generator follows. Hand placement does not scale: the IEEE 118-bus case is 118 buses
and 186 branches.

## Inputs

| Input | Role |
|---|---|
| `<case>/result/<stem>_DF_bus.csv` | buses: id, number, name, type, load, generation |
| `<case>/result/<stem>_DF_branch.csv` | lines and transformers: from–to, `IsXfmr`, `Circuit` |
| `wspace/template/oneline-diagram.drawio` | style reference — read it before changing any style |

Both CSVs are ACLF output, so a case with no `result/*_DF_bus.csv` must be solved first
(`$ipss-case-aclf`). The `<stem>` is auto-detected, so tables named `ieee118_DF_*.csv` need no flag.

## Quick start

```bash
# numpy and Pillow are both required. Take the interpreter from load_workspace_dependencies when it
# is available (its python/bin/python3); a bare system python3 has numpy but no Pillow.
PY="${DSH_PYTHON:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3}"

"$PY" wspace/script/gen_oneline_diagram.py wspace/data/ieee/Ieee118Bus \
    --title "IEEE 118-Bus One-Line Diagram"
```

The run prints the output path, the page size, bus/branch/edge counts and any overlapping
footprints, then reads the file back and prints its self-check. A non-zero exit means the self-check
failed.

## Workflow

1. **Resolve the case folder.** The case the chat is working on is the one in the InterPSS tab or
   held by the bridge (`$ipss-case-load` prints it, e.g. `data/ieee/Ieee118Bus/ieee118.ieee`), so the
   folder to pass is `wspace/data/ieee/Ieee118Bus` — the folder that holds the case file and
   `result/`. Pass it explicitly rather than guessing.
2. **Check the inputs.** `<case>/result/<stem>_DF_bus.csv` and `_DF_branch.csv` must exist; if they do
   not, solve the case with `$ipss-case-aclf` and re-run. The diagram's subtitle carries the counts
   from those tables.
3. **Generate.** Run the script with `--title`. For a case whose layout you dislike, try another
   `--seed` — same topology, another valid layout.
4. **Report** the `.drawio` path (in the case's `diagram/` folder) and that the **Diagram** tab
   renders the selected case's diagram with bus/branch tooltips (the InterPSS tab's old **Diagram**
   button is gone as of 0.6.9). Do not restate the geometry numbers unless asked.

## What gets drawn

| Element | Detail |
|---|---|
| Buses | one vertical bar per bus (6 x 52) with its `Bus-N` label above |
| Branches | one line per `_DF_branch` row, undirected; parallel circuits bow slightly apart |
| Transformers | `IsXfmr = true` rows as two interlocking rings in one group cell, inline on the branch and clear of every bar and label |
| Loads / generators | not drawn — the template shows topology only |
| Voltage | not drawn: every bar uses the template's single grey. The subtitle names the levels only when the data supports it: the IEEE `Vn` name suffix, else the bus table's `NomVolt` when that is a real voltage, else nothing |
| Orientation | the case's first bus (**Bus 1**) is the top-left-most bus: the layout is rotated, then eased, until every other bar is right of and below it |
| Header | title, subtitle (counts and voltage levels), and a symbol legend box |

## Style rules (the template contract)

| Rule | Detail |
|---|---|
| Bus shape | vertical bar **6 x 52**, fill `#666666`, stroke `#333333` — the same grey for every bus |
| Labels | `Bus-N` only (no name, no data), centred **above** its bar, drawn as a white-filled rect so the paper box masks any wire beneath the text |
| Branches | black `strokeWidth 1.5`, `endArrow=none`, no edge text; staggered taps so parallel lines leave a bar at different heights |
| Transformers | two 16 x 16 ellipses, `fillColor=none`, centres 8 px apart, inside **one** `style=group` cell, sitting inline on the branch |
| Routing | straight by default; one short local hop around a bar only when a straight line would cross one. Explicit waypoints and no `edgeStyle`, so draw.io and the app preview draw the same polyline |
| Annotations | none: no bus data, no branch P/Q, no voltage colours |

## Keeping the app preview working

- Bus bar cell ids must stay `busN` (lowercase) and their labels must read exactly `Bus-N`, or the
  preview loses the bus tooltip (`Bus-118` -> `bus118` -> the table's `Bus118`).
- Each transformer's two rings must stay children of their own `style=group` cell: the preview pairs
  the two stub edges through that group, so hovering any part of a transformer gives one branch
  tooltip.
- Every edge needs `endArrow=none` (a one-line diagram is undirected) and an explicit `strokeColor`.
- Keep the file uncompressed XML under `<mxfile>`, and under 2000 cells (the preview's cap; the
  118-bus diagram uses 465).

## Flags

| Flag | Detail |
|---|---|
| `--out PATH` | write elsewhere (default `<case>/diagram/<stem>-oneline.drawio`) |
| `--title TEXT` | page title and diagram name |
| `--no-png` | skip the PNG preview — the only part that needs Pillow |
| `--png PATH` | write the preview elsewhere |
| `--scale N` | preview scale factor (default 1.0; use 2 for a closer look) |
| `--seed N` | layout seed (default 11) |
| `--check FILE` | validate an existing diagram against the same case, writing nothing |
| `--open` | after a passing self-check, hand the diagram to the draw.io editor through the draw.io MCP server |
| `--app-export [PNG]` | render it with the local draw.io **desktop app** (authoritative output; default `<stem>-oneline-drawio.png`). `--app PATH` points at another install |

## Self-check

Every run reads the diagram back the way the plugin's preview does and verifies: a `busN` cell and a
`Bus-N` label for every bus, no arrowheads, exactly two rings per transformer with the right parent
group, **no transformer symbol overlapping a bar or a label** (labels paint last, so such a symbol
renders as a clipped ring), **the first bus at the upper-left corner**, every branch resolving to a
bus pair, and a sane cell count and page. It
prints `PASS` or the failing lines and sets the exit code. `--check FILE` re-runs exactly that
against an existing file.

## Hand-off and round-trip with the draw.io MCP

The same diagram can be opened in — and pulled back from — the draw.io editor through the official
draw.io MCP server (`@drawio/mcp` 1.6.1, pinned at `$DSH_HOME/mcp-servers/drawio`):

| Route | When |
|---|---|
| `mcp__drawio__*` tools | Preferred. DSH mounts the server from the profile's `mcp-drawio` row (`@deepseek-ai/dsh-mcp-client`, stdio), which must be written with `insert:` — a bare `- id:` patch targets an existing row and a target that matches no row is **skipped silently**, restart after restart. Profile rows are composed when the app starts, so a session that began before the row was added has none of them |
| `python3 wspace/script/drawio_mcp.py …` | A host without the MCP tools (Codex, Claude Code, a plain shell). Same server, same tools: `list`, `get`, `set`, `open`, `shapes` |
| `gen_oneline_diagram.py <case> --open` | Generate, self-check and open the editor in one step |

The **desktop app** is a separate route, no MCP involved: `open -a draw.io <file>` to look at it, or
headless `/Applications/draw.io.app/Contents/MacOS/draw.io --no-sandbox --export --format png` — the
`--no-sandbox` is required inside this harness, whose own sandbox otherwise kills the renderer. Its
output is authoritative where the Pillow preview is an approximation, and it is what caught the
legend's collapsed line break and its overlap with the title on narrow pages.

Diagnostics when the tools are missing, both read-only via `cordis_inspect_query`: `Config.listConfigs`
with `{name: "@deepseek-ai/dsh-mcp-client"}` returns one entry when the row is live — note its id is
`include:mcp-drawio`, so querying the bare patch id says "unknown entry id" even on a healthy row —
and `Tool.listTools` lists the seven `mcp__drawio__*` tools. The server exposes tools only, no MCP
resources.

- `open` (`open_drawio_xml`) shows the page in the browser editor. It is the interactive step, never
  a substitute for the layout work.
- `get` / `set` (`get_page` / `set_page`) round-trip **one page of a local `.drawio`**. `get` is a
  pure read; `set` re-serialises the file, so its bytes change while ids, parents and geometry do
  not. **After a `set`, re-run the self-check** (`--check FILE`).
- Never route these diagrams through `open_drawio_csv`, `open_drawio_mermaid` or `postLayout: elk`:
  they auto-place generic shapes, which drops the bus bars, the transformer `group` cells and the
  `busN` / `Bus-N` ids the preview's tooltips resolve against.
- `shapes` searches the draw.io library — it does carry electrical stencils (`mxgraph.electrical.*`)
  if a symbol ever needs replacing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no *_DF_bus.csv / *_DF_branch.csv under … -- run ACLF first` | Solve the case (`$ipss-case-aclf`), then re-run |
| `ModuleNotFoundError: No module named 'PIL'` | Use the harness interpreter shown above, or pass `--no-png` |
| `layout did not separate for any attraction setting` | Rare; retry with another `--seed` and report it rather than hand-editing coordinates |
| Self-check prints `FAIL …` | Report the failing line: an id/parent convention above was broken, a transformer symbol could not be placed clear of a bar/label, or the first bus is not the top-left-most (the run also prints a `note:` line for the last two) |
| `--check` reports the Bus 1 corner rule on a hand-*laid* file | Expected: the hand-laid IEEE 14-bus template predates the rule. It is a generated-diagram convention |
| The diagram is for the wrong case | `case_dir` is what decides — pass it explicitly |
| The preview shows nothing | The `.drawio` must sit in the **selected** case's `diagram/` folder, and the **Diagram** tab lists `.drawio` files only (the PNG is ignored) |

## Limitations

- **Axes are layout, not geography.** Hop distance drives position, so neighbouring buses are a few
  branches apart, not a few miles.
- **Wires still cross.** 186 branches over 118 bars cannot be crossing-free; the geometry (bars,
  labels, transformer symbols) is collision-free, the routes are not.
- **The preview is approximate** — no orthogonal auto-routing, no arrowheads, one font size — and a
  fitted 1900 x 1700 page makes 11 px labels small until you zoom. Open the file in draw.io when
  exact geometry matters.
- **The PNG is not a diagrams.net export**; it is a Pillow re-render of the same geometry, for a
  quick look.
- **Regenerating replaces the file.** Hand edits to a generated `.drawio` are lost on the next run.

## Related

- `$ipss-case-aclf` — writes the `*_DF_*.csv` the diagram is drawn from
- `$ipss-case-load` — load or switch the case the diagram is for
- `$ipss-case-info`, `$ipss-case-summary` — the case's counts and totals, without drawing anything
- [docs/oneline-diagram-process.md](../../../docs/oneline-diagram-process.md) — the full process,
  the template's rules and the generator's layout pipeline
