# Release V0.7.15

**Date:** 2026-10-26  
**Range:** `Release-V0.7.7` → `0.7.15` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.7.7 → 0.7.15**

This release finishes the OptAdj config/tool surface (`sparseSenMatrix`, N-1 token rename, mode
as a call argument), ships Host hotfixes so OptAdj tools and gen CSVs actually load, then focuses
on the Diagram line: click-to-select, optional gen/load symbols from ACLF equipment tables, free-end
edge preview fidelity, and the `$ipss-drawio-adjust` hand-layout skill.

## Highlights

- **OptAdj sparse sensitivity knob (0.7.8):** `config/opt_adj_run.json` / tool `optAdjConfig` gains
  `sparseSenMatrix` (default `true`). N-1 mode token is **`genAdjCA_N-1`** (Host still maps the
  retired `genAdjCaN_1` spelling)
- **OptAdj mode is a call argument (0.7.11):** `optAdjType` leaves the six-key config file; CLI /
  bridge / tool pass it separately; leftover file keys are ignored
- **Host hotfixes:** 0.7.9 restores tool registration after a Host parse break; 0.7.10 opens
  `readCsv` / `checkResult` for `optadj_gen` / `optadj_N1_gen` so the card’s Gen adjustments work
- **Diagram click-to-select (0.7.13):** click a bus or branch for a pinned blue selection + tooltip
  (preview-only; `.drawio` unchanged)
- **Optional gen/load symbols (0.7.14):** `gen_oneline_diagram.py --symbols none|gen|load|both`
  from `*_DF_gen.csv` / `*_DF_load.csv`; preview draws draw.io `triangle` shapes
- **Free-end edge preview (0.7.15):** cell + bare `sourcePoint`/`targetPoint` stubs render like
  draw.io (hand-adjusted transformers keep both stubs)
- **`$ipss-drawio-adjust`:** hand-adjust existing case `.drawio` layouts (bus anchors, gen side,
  XF stubs, multilines) without regenerating

## Version trail (0.7.8 → 0.7.15)

| Ver | What landed |
| --- | --- |
| 0.7.8 | `sparseSenMatrix`; N-1 token → `genAdjCA_N-1` (Host aliases old `genAdjCaN_1`) |
| 0.7.9 | Hotfix: Host `lib/index.js` parse error (`loading` double-declare) — tools register again |
| 0.7.10 | Hotfix: `readCsv` / `checkResult` allow `optadj_gen` / `optadj_N1_gen` for the OptAdj card |
| 0.7.11 | `optAdjType` is a runner/tool argument, not a config-file key (six keys remain) |
| 0.7.13 | Diagram **click-to-select** highlighting (preview-only) |
| 0.7.14 | Generator `--symbols`; triangle shape support in the Diagram preview |
| **0.7.15** | Preview fidelity for free-end edges; template-based guard fixtures |

*(0.7.12 was not a documented changelog row — packaging / intermediate bumps only.)*

## OptAdj / Java

- `OptAdjRunConfig`: `scanLoadingThreshold`, `optAdjLoadingThreshold`, `contingencyMode`,
  `contingencyFile`, **`sparseSenMatrix`**, `threads` — mode via `OptAdjRunner` / bridge arg
- Canonical N-1 token: `genAdjCA_N-1` (`OptAdjRunConfig.GEN_ADJ_CA_N1`)
- Samples and `$ipss-case-optadj` updated for the rename and sparse default

## Diagram / generator

- Click selects bus/branch; Esc / empty paper clears; selection survives pan/zoom/search/filter
- `$ipss-case-diagram` / `gen_oneline_diagram.py`: `--symbols both` (etc.); symbols stay inside the
  bus footprint and stay attached when moved in draw.io
- `$ipss-drawio-adjust` for hand layout of ieee14 / ieee39 / ieee118 one-lines
- Sample diagrams refreshed (IEEE 39 / 118); birdseye default enabled in workspace
  `config/net_diagram.json`

## Docs & setup

- [loadflow-adjustment-user-guide.md](../user_guide/loadflow-adjustment-user-guide.md) /
  [gen_opt_adjustment.md](../gen_opt_adjustment.md) / `$ipss-case-optadj` — sparse knob, token rename,
  mode-as-argument
- [oneline_diagram_user_guide.md](../user_guide/oneline_diagram_user_guide.md) /
  [oneline-diagram-process.md](../oneline-diagram-process.md) — select, symbols, free-end edges
- [interpss-tools.md](../interpss-tools.md): changelog through **0.7.15**; current version banner
  **0.7.15**
- `InstallDSHPlugin.md` / plugin README / root README pin **0.7.15**

## Verified

- Client guard: **409 checks** (was **352** at 0.7.7)
- Package: `deepseek-ai-dsh-interpss-0.7.15.tgz` (kept alongside `0.7.7` and `0.6.33`)

## Install

```bash
dsh plugin --profile desktop add <abs path>/interpss-persistent/deepseek-ai-dsh-interpss-0.7.15.tgz
```

Host changes in 0.7.8–0.7.11 and 0.7.15 packaging: **restart the app**. Client-only Diagram work
(0.7.13–0.7.15 preview): refresh the page after install.

## Stats

- **33 commits** since `Release-V0.7.7`
- **52 files** changed, **+8301** / **−2377** lines
