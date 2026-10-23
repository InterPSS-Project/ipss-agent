# Release V0.7.7

**Date:** 2026-10-10  
**Range:** `Release-V0.7.0` → `0.7.7` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.7.0 → 0.7.7**

This patch closes the **0.7** line’s OptAdj ↔ Diagram gap: branch tooltips now show post-redispatch
loadings from the OptAdj result CSVs, and Host `readCsv` finally allows those families so the lines
can load. Along the way the line gained BPA Dat case files, full CA solver knobs, and the
`interpss_case_optadj` chat tool with mode-suffixed result pairs.

## Highlights

- **Diagram OptAdj loadings work (0.7.7):** hover a branch for `Basecase OptAdj Loading(%)` /
  `Contingency OptAdj Loading(%)` from `*_DF_optadj_branch.csv` / `*_DF_optadj_N1_branch.csv`
  (`loadingAfterPct`). 0.7.6 wired the client; 0.7.7 opened the Host allow-list
- **Generator redispatch from Chat (0.7.4+):** `$ipss-case-optadj` / `interpss_case_optadj` —
  SSA scan → LP → re-check; N-1 writes its own `_N1_` CSV pair (0.7.5)
- **BPA Dat cases (0.7.1):** Simu Case format choice and path validation accept `.dat` / `.DAT`
- **CA advanced solver settings (0.7.2):** the dialog and `interpss_run_ca` drive the full
  `DclfContingencyConfig`, not only the overload threshold

## Version trail (0.7.0 → 0.7.7)

| Ver | What landed |
| --- | --- |
| 0.7.0 | Version line only — Host/Client byte-identical to 0.6.37 Diagram line |
| 0.7.1 | BPA Dat (`.dat` / `.DAT`) in the Simu Case picker and Host path rules |
| 0.7.2 | CA dialog + tool drive the full DC contingency solver config |
| 0.7.3 | Plug-in CA mirror aligned with `runner/config` Java package move |
| 0.7.4 | Chat tool `interpss_case_optadj` + `OptAdjRunner` + result CSVs |
| 0.7.5 | N-1 OptAdj writes `_DF_optadj_N1_{gen,branch}.csv` (no overwrite of basecase) |
| 0.7.6 | Diagram branch tooltip OptAdj lines (client + `checkResult` discovery) |
| **0.7.7** | Host `readCsv` allow-list includes OptAdj families — tooltips actually populate |

## Verified

- Client guard: **352 checks** (was 316 at 0.7.0). §11 runs each Host half’s `readCsv` pattern
  over the seven result families the Diagram tab looks up
- Real OptAdj tables on IEEE39: `ieee39_DF_optadj_branch.csv` / `ieee39_DF_optadj_N1_branch.csv`
  page through `readCsv`; a junk family is still rejected
- Package: `deepseek-ai-dsh-interpss-0.7.7.tgz`

## Docs & setup

- [oneline_diagram_user_guide.md](../user_guide/oneline_diagram_user_guide.md) /
  [oneline-diagram-process.md](../oneline-diagram-process.md) — OptAdj tooltip binding
- [dsh_plugin_user_guide.md](../user_guide/dsh_plugin_user_guide.md) — recommend **0.7.7**
- [gen_opt_adjustment.md](../gen_opt_adjustment.md) /
  [loadflow-adjustment-user-guide.md](../user_guide/loadflow-adjustment-user-guide.md) — OptAdj ↔ Diagram
- [architecture.md](../architecture.md) — OptAdj result file names in the standard table
- [interpss-tools.md](../interpss-tools.md): current version **0.7.7**; changelog 0.7.0 → 0.7.7
- [persistent-plugin-rebuild.md](../persistent-plugin-rebuild.md): pack/verify on **0.7.7**
- `InstallDSHPlugin.md` and plugin README pin **0.7.7**

## Install

```bash
dsh plugin --profile desktop add <abs path>/interpss-persistent/deepseek-ai-dsh-interpss-0.7.7.tgz
```

Host change: **restart the app** after installing 0.7.7 (the OptAdj allow-list lives in the Host).
Client half for the tooltip lines arrived in 0.7.6 — refresh the page if you skipped that build.
