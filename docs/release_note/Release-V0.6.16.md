# Release V0.6.16

**Date:** 2026-10-01  
**Range:** `Release-V0.5.0` → `0.6.16` (`drawio`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.5.0 → 0.6.16**

This release adds one-line diagram viewing and generation for InterPSS cases: a dedicated
**Diagram** tab with theme-aware SVG preview, bus/branch tooltips, and a configurable
**draw.io** desktop launch button; a generator script and `$ipss-case-diagram` skill; plus
sample diagrams (IEEE 14 / 39 / 118) and user guides.

## Highlights

- New **Diagram** conversation tab (Chat · InterPSS · Diagram · Trajectory) for the selected
  case’s `diagram/*.drawio`
- Inline SVG preview: pan / zoom / fit, **Rendered / Source**, app-theme grayscale remapping,
  document-order paint, bus/branch tooltips from ACLF result tables
- **draw.io** button (upper-right) opens the current diagram in the local desktop app; launcher
  list is configurable via `config/ipss_plugin_env.json` (macOS / Windows / Linux)
- Generator `wspace/script/gen_oneline_diagram.py` + skill `$ipss-case-diagram` write
  `<case>/diagram/<stem>-oneline.drawio` (and PNG preview) from ACLF CSVs
- Diagrams are **per case** (`<case>/diagram/`), not workspace-wide
- Docs: [oneline_diagram_user_guide.md](../user_guide/oneline_diagram_user_guide.md),
  [oneline-diagram-process.md](../oneline-diagram-process.md), README / DSH plugin guide updates

## Version trail (0.5.1 → 0.6.16)

| Ver | What landed |
| --- | --- |
| 0.5.1 | Connection modal: full-precision `PFrom2To` / `QFrom2To` / `QGen` to four decimals |
| 0.6.0–0.6.2 | First Diagram preview (workspace `.drawio` list → inline SVG); pan/zoom/fit |
| 0.6.3 | Dynamic and persistent plugins re-synced (sortable CSV, CA threshold, conn decimals) |
| 0.6.4–0.6.5 | Paint-order / stroke fixes; theme-token grayscale remapping for dark mode |
| 0.6.6 | Per-case `diagram/` listing; button enabled only when a diagram exists |
| 0.6.7 | Bus/branch tooltips (same builders as the connection diagram) |
| 0.6.8 | Dedicated **Diagram** tab (full-size); follows InterPSS / bridge case selection |
| 0.6.9–0.6.11 | Remove InterPSS-tab Diagram modal; drop redundant heading / zoom-hint chrome |
| 0.6.12 | Host `openDrawio` + draw.io toolbar button (needs app restart) |
| 0.6.13–0.6.15 | Button placement: lower-right → sticky → **upper-right** header (final) |
| **0.6.16** | `config/ipss_plugin_env.json` `drawio.launchers` — platform-aware desktop path config |

## UI / plugin

- Diagram tab follows the InterPSS **Simu Case** picker and Chat `interpss_case_load` /
  `getBridgeCase` selection so tabs cannot disagree
- Single `.drawio` opens directly; several show a picker (remembers last choice across tab switches)
- Hover tooltips: bus / branch / transformer; without ACLF results: `no result data — run ACLF`
- draw.io launch: Host `openDrawio` via `subprocess`; status text beside the button; **Host change
  for 0.6.12 and 0.6.16 — restart `dsh web`**
- Launcher config (`config/ipss_plugin_env.json`): ordered `exe` / `args` / `label` / optional
  `platform` (`darwin` | `win32` | `linux`); this OS first, then untagged association fallbacks

## Generation & agent skills

- New skill `$ipss-case-diagram` / `.agents/skills/ipss-case-diagram/SKILL.md`
- `wspace/script/gen_oneline_diagram.py`: layout from `*_DF_bus.csv` / `*_DF_branch.csv`, style
  from `wspace/template/oneline-diagram.drawio`; flags `--title`, `--seed`, `--open`, `--png`, …
- `wspace/script/drawio_mcp.py` for draw.io MCP round-trip from a shell
- Sample diagrams under case `diagram/` folders: Ieee14Bus (+ LargeLoadQ variants), Ieee118Bus,
  ieee39; workspace template retained as the visual contract

## Docs & setup

- New: `docs/user_guide/oneline_diagram_user_guide.md`, `docs/oneline-diagram-process.md`
- Screenshots: `docs/image/ipss-dsh-diagram.png`, `ipss-dsh-chat-diagram.png`
- README User Guide section links Diagram + Loadflow Adjustment guides; DSH plugin guide points at
  the Diagram tab workflow
- `docs/interpss-tools.md` changelog through **0.6.16**; Install / persistent README updated for
  Diagram tab and draw.io button
- Loadflow Adjustment user guide formatting polish (carry-over from 0.5.x docs)

## Doc consistency (this pass)

- `docs/interpss-tools.md`: “Current version” banner **0.6.7 → 0.6.16** (changelog already had 0.6.16)
- README: link label `loadflow_adjustment_user_guide.md` → `loadflow-adjustment-user-guide.md`
  (matches the real hyphenated filename)
- `docs/plan/interpss_electron_app-plan.md`: relative links fixed (`../../…`, `../js-java-integration.md`)

## Housekeeping

- Bumped package to **0.6.16**; shipped `deepseek-ai-dsh-interpss-0.6.16.tgz`
- Intermediate / obsolete tarballs pruned where noted in commits (e.g. 0.5.1, 0.6.7)
- `.gitignore`: diagram PNG backups and workspace `diagram/*.png` noise
- Client sync / guard tests expanded (`scripts/test-interpss-client.mjs`,
  `scripts/sync-persistent-client.mjs`)

## Stats

- **21 commits** since `Release-V0.5.0`
- **34 files** changed, **+11211** / **−142** lines
