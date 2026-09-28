# Release V0.5.0

**Date:** 2026-09-28  
**Range:** `Release-V0.4.0` → `0.5.0` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.4.0 → 0.5.0**

This release makes DC contingency analysis a chat tool, makes the CA over-loading threshold a real
setting, turns the Groovy adapter into the agent's own (`*Dsh*`) processor with a sensitivity binding,
and lets a script be a `.gvy` file, inline source, an array, or a workspace fixture. It also packages
a load-Q → voltage-band workflow (`$ipss-case-aclf-adjust`) with IEEE14 fixtures, and fixes dialog
config saves in an app-hosted profile.

## Highlights

- New chat tool `interpss_run_ca` (CA dialog bypassed) with its card, result explorer and `ipss-case-ca` skill
- **Over Loading Threshold(%)** replaces the hard-coded 90 %: dialog field, `overloadThreshold`
  argument, `config/ca_run.json` key — and it round-trips
- `interpss_run_gvy` accepts inline Groovy, an **array** of scripts, and the workspace `script/` folder
- Groovy adapter is now `org.interpss.agent.script.gvy.BaseDshGvyScriptProcessor` /
  `AclfNetDshGvyScriptProcessor`, binding `aclfnet` **and** `senAlgo` (dV/dQ, GSF, transfer factors)
- New skill **`$ipss-case-aclf-adjust`**: measure `dV/dQ`, size load Q for a voltage band, apply via
  Groovy, confirm with ACLF (single-bus and coupled multi-bus forms)
- Case fixtures `Ieee14Bus_LargeLoadQ` / `Ieee14Bus_LargeLoadQ2` with Bus14 and Bus13+Bus14 scripts
- Case configs live under `<case folder>/config/` (`aclf_run.json`, `ca_run.json`)
- Dialog config saves work in an app-hosted profile where the DSH `fs` fence refuses the workspace path

## Chat tools & agent skills

- `interpss_run_ca`: contingency / monitored-branch inputs resolve argument → `config/ca_run.json` →
  case-folder discovery → Java N-1 defaults; card with an **Explore result → Contingency** row (0.4.2)
- Result explorers sort: `readCsv` takes `sortColumn`/`sortDesc`, clickable ▲/▼ headers (0.4.3), and the
  tab's own tables follow (0.4.4)
- `overloadThreshold` on the tool, validated (`0 < t <= 1000`) and **merged per key** over the resolved
  case config (0.4.6/0.4.7) — `interpss_run_ca({ overloadThreshold: 80 })` keeps the case's contingency
  and monitored sets
- `interpss_run_gvy`: inline source (0.4.9), arrays applied in order with per-step `steps`/`applied`
  and stop-at-first-failure (0.4.11), workspace `wspace/script/*.gvy` fixtures read by the Host (0.4.12)
- Script failures report the line **in the caller's own script** (the `GVY_IMPORTS` block is subtracted)
- `$ipss-case-load`: reload-from-disk and apply a `.gvy` in one call; script-path `@…` can resolve the
  case from the folder above `scripts/`
- `$ipss-case-script`: documents inline / array / workspace forms and the `senAlgo` query surface
- **`$ipss-case-aclf-adjust`**: packaged load-Q voltage adjustment workflow (see user guide)
- Skills: `ipss-case-ca`, plus updates across `ipss-case-load`, `ipss-case-script`, `ipss-case-aclf`

## UI / plugin

- CA dialog: **Over Loading Threshold(%)** field above the case line, seeded from `getCaOptions`,
  validated before OK; `saveCaOptions` persists all five keys (0.4.6–0.4.8)
- `config/` relocation: `aclf_run.json` and `ca_run.json` move under `<case folder>/config/`, and every
  dialog / RPC / tool path follows (0.4.5)
- Dialog config writes survive an app-hosted profile (0.4.13) and write through the caller's absolute
  path when the fenced service refuses (0.4.14): `writeConfigText` keeps the DSH `fs` service where it
  is allowed and falls back to the plugin's own `node:fs`

## Java / bridge

- `CaRunConfig` carries `overloadThreshold` (validated, default 90) into
  `ContingencyRunner.runOnNet(...)` → the DCLF analyser's overload threshold, replacing the constant
- The agent Groovy adapter pair (`BaseDshGvyScriptProcessor`, `AclfNetDshGvyScriptProcessor`) with
  `GVY_IMPORTS` (Complex, `DclfAlgoObjectFactory`, `SenAnalysisType`, `ContingencyBranchOutageType`) and
  the `senAlgo` binding; `GvyScriptRunner.runSourceOnNet` is the inline entry point
- Tests: CA threshold (config + runner), inline script evaluation, caller-relative failure lines,
  `inlineLabel`, workspace and array resolution

## Sample cases & scripts

- `wspace/data/ieee/Ieee14Bus_LargeLoadQ/` — Bus14 large reactive load; `ieee14_dvdq_Bus14.gvy`,
  `ieee14_adjBus14Q_0p89to0p90.gvy`
- `wspace/data/ieee/Ieee14Bus_LargeLoadQ2/` — Bus13 + Bus14 past the nose point; `ieee14_qv_adjust.gvy`
  (and related matrix / apply scripts)
- Workspace fixtures under `wspace/script/`: `ieee14_calDv_dQ.gvy`, `ieee14_calGSF.gvy`,
  `ieee14_calLODF.gvy`, `ieee14_calWGenTFacotr.gvy`

## Docs & setup

- `docs/interpss-tools.md`: tool contracts through 0.5.0, the case-script vs workspace-script rule, and
  the `senAlgo` query examples
- New: `docs/load-q-adjustment.md` (method) and `docs/user_guide/loadflow-adjustment-user-guide.md`
  (how-to) for the dV/dQ load-Q workflow
- `docs/groovy-script-adapter-architecture.md` rewritten for the agent `*Dsh*` classes
- `InstallDSHPlugin.md`, README, user guide and plugin README: install prompts, `$ipss-case-aclf-adjust`,
  threshold, `config/` layout and the new script forms
- Obsolete InterPSS command markdown under `.claude/commands` pruned where superseded by skills

## Housekeeping

- Bumped package to **0.5.0**; shipped `deepseek-ai-dsh-interpss-0.5.0.tgz`
- Superseded dialog-save fixes 0.4.13 / 0.4.14 are included in this artifact (one restart applies both)
- Intermediate tarballs pruned from the repo (0.4.4, 0.4.8, 0.4.9, 0.4.10, 0.4.14)

## Stats

- **~31 commits** since `Release-V0.4.0`
- **72 files** changed, **+4528** / **−813** lines
