# Release V0.6.33

**Date:** 2026-10-03  
**Range:** `Release-V0.6.16` → `0.6.33` (`dsh-dev`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.6.16 → 0.6.33**

This release turns the Diagram tab into a study surface for large one-line diagrams: search and
filter, configurable voltage / branch-flow flags (`config/net_diagram.json`), birdseye navigation,
base-case and contingency loading in tooltips and filters, Texas 2K–scale size limits, and SVG
preview fidelity that matches draw.io’s geometry and label styles.

## Highlights

- **Search** and **Filter** on the Diagram tab (bus number / id / name, `A->B` branches; area /
  zone / |V| band / branch-loading criteria)
- Project config [`config/net_diagram.json`](../../config/net_diagram.json): bus voltage band +
  colours, base-case and contingency branch-flow thresholds + colours, birdseye on/off — edited
  from the tab’s **gear** dialog
- Render-time **flags** (buses outside the band; branches at/above flow %); `.drawio` file stays
  uncoloured
- **Birdseye** thumbnail (click/drag to navigate); zoom **picker** (25–400 % + Fit)
- Branch tooltips: **Basecase Loading(%)** and **Contingency Loading(%)**; Filter can keep only
  overloaded branches (and their end buses)
- Size ceilings raised for Texas 2K: **20000 cells**, **4 MiB** Host read cap
- Preview fidelity (**0.6.33**): honour `rounded`, `align` / `verticalAlign` / `spacing`,
  `labelBackgroundColor` so the SVG matches the draw.io app
- Sample / case diagrams: Texas2K `Texas2k-oneline.drawio`, ieee39 oneline; Ieee14 / LargeLoadQ
  diagram and load-Q script updates (0.90–0.91 band)

## Version trail (0.6.17 → 0.6.33)

| Ver | What landed |
| --- | --- |
| 0.6.17 | Toolbar view toggle → single letters **R** / **S** (tooltips keep full names) |
| 0.6.18 | Render-time red paint for buses outside 0.9–1.1 pu (file unchanged) |
| 0.6.19–0.6.20 | Cell/byte ceilings up for large cases; Host read cap settled at **4 MiB** |
| 0.6.21–0.6.22 | Zoom **picker** (25–400 %); **Fit** moves into the picker |
| 0.6.23–0.6.25 | **Search** + **Filter** dialogs; live filter message; `1001->1002` branch search; case-specific help |
| 0.6.26–0.6.27 | **Gear** → `config/net_diagram.json`; all |V| band copy reads from that file |
| 0.6.28–0.6.29 | **Birdseye** view; `Show_birdseye_view` switch in config / gear |
| 0.6.30–0.6.31 | Branch loading in tooltips; `checkResult` lists `_DF_contingency.csv`; thresholds affect paint, not data maps |
| 0.6.32 | Filter: base-case / contingency loading ≥ … (labels from `net_diagram.json`) |
| **0.6.33** | SVG fidelity: `rounded` value, label align/spacing, `labelBackgroundColor` |

## UI / plugin

- Toolbar shape (late 0.6.x): **R · S · − · [level ▾] · + · 🔍 · ▼**, with **draw.io** and **⚙** *(the `R` / `S` toggle and its Source view were removed in 0.6.34 — the tab always draws the rendered scene; the rest of this shape still holds)*
  upper-right; optional birdseye over the canvas
- Flags summary beside the toolbar; click reopens the gear dialog
- Filter combinations narrow together; loading criteria hide non-incident buses and report
  branch counts when active; disabled while the needed result CSV is missing
- Theme remapping and search highlight remain preview-only (deliberate differences vs draw.io)

## Config

Shipped defaults in `config/net_diagram.json` (workspace may tune; tip currently has birdseye off):

| Key | Role |
| --- | --- |
| `Bus_flag_lower_limit` / `Bus_flag_upper_limit` | |V| band for bus flags / filter |
| `Bus_flag_color` | Out-of-band bus colour |
| `Basecase_branch_flow_flag_percent` / `_color` | Base-case loading flag |
| `Contingency_branch_flow_flag_percent` / `_color` | Contingency loading flag |
| `Show_birdseye_view` | Birdseye thumbnail on/off |

## Cases, generator & scripts

- Texas 2K one-line under `wspace/data/psse/Texas2K/diagram/Texas2k-oneline.drawio` (refactored for
  size/clarity); ieee39 diagram added/updated
- Generator (`gen_oneline_diagram.py`) and `$ipss-case-diagram` skill updates for larger layouts
- Load-Q adjustment scripts refreshed for **0.90–0.91** pu windows (Ieee14 LargeLoadQ /
  LargeLoadQ2); related method/user-guide text in `docs/load-q-adjustment.md`

## Docs & setup

- [oneline_diagram_user_guide.md](../user_guide/oneline_diagram_user_guide.md) and
  [oneline-diagram-process.md](../oneline-diagram-process.md) cover search/filter, gear,
  birdseye, loadings, ceilings, and 0.6.33 fidelity notes
- `docs/interpss-tools.md` changelog through **0.6.33**; InstallDSHPlugin pins **0.6.33** tarball
- Plugin README Diagram feature list updated for zoom picker, search/filter, birdseye, net_diagram

## Doc consistency (this pass)

- Relative markdown links: **0 broken**
- `docs/interpss-tools.md`: “Current version” banner **0.6.16 → 0.6.33** (changelog already had 0.6.33)

## Housekeeping

- Bumped package to **0.6.33**; shipped `deepseek-ai-dsh-interpss-0.6.33.tgz`
- `.gitignore`: `__pycache__`, `*.dtmp`
- Client guard suite expanded with the new Diagram behaviours (through ~309 checks)

## Stats

- **15 commits** since `Release-V0.6.16`
- **33 files** changed, **+40368** / **−1032** lines (dominated by the Texas2K `.drawio`)
