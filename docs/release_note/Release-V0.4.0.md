# Release V0.4.0

**Date:** 2026-09-24  
**Range:** `Release-V0.3.16` → `0.4.0` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.3.16 → 0.4.0**

This release adds Groovy scenario scripting for in-place network edits, bridge/chat case synchronization, workspace-relative case paths, further CA dialog polish, and a docs reorg (user guides, images, architecture).

## Highlights

- New chat tool `interpss_run_gvy` and skill `ipss-case-script` for Groovy (`.gvy`) what-if network edits
- Bridge case mirroring (`getBridgeCase`) so Chat tools and the InterPSS tab stay in sync
- Case selectors accept workspace-relative paths prefixed with `wspace/`
- Contingency Analysis dialog: clearer optional JSON / `ca_run.json` resolution and validation UX
- Default JVM heap guidance raised to `-Xmx8g` for large cases (e.g. Eastern Interconnect)
- User guides and screenshots reorganized under `docs/user_guide/` and `docs/image/`

## Chat tools & agent skills

- Added `interpss_run_gvy`: run a case `scripts/*.gvy` scenario against the held network, apply edits in place, and report what changed
- Added skills/commands: `ipss-case-script`, `ipss-case-load` (plus clarifications on `$ipss-case-load` in related skills)
- Documented script/branch edit effects on totals and counts; troubleshooting notes in `interpss-tools.md` and skills
- Sample Ieee14 scripts: `ieee14_adjBranch1_2.gvy`, `ieee14_adjBus14.gvy`
- New architecture note: `docs/groovy-script-adapter-architecture.md`

## UI / plugin

- Contingency Analysis dialog refinements (file load, validation, error handling; optional contingency / monitored-branch JSON with `ca_run.json` fallback)
- Case selector: accept `wspace/...` relative paths in addition to prior forms
- Chat ↔ InterPSS tab case mirroring via bridge (`getBridgeCase` / timer handling in dynamic host & client)
- Updated screenshots under `docs/image/` (`ipss-dsh-plugin.png`, `ipss-dsh-chat.png`, `ipss-agent-chat.png`)

## Java / bridge

- `GvyScriptRunner` + bridge support to validate and execute scripts under the case `scripts/` directory
- `CaRunConfig` and sample `ca_run.json` for Ieee118 / Texas2K
- Tests: `GvyScriptRunnerTest`, CA config/runner tests, bridge coverage for script paths

## Docs & setup

- Reorganized guides: `docs/user_guide/dsh_plugin_user_guide.md`, `docs/user_guide/batch_chat_user_guide.md`
- Expanded DSH Plugin guide (in-memory model sync, CA dialog, `interpss_case_load`, report types)
- README / Setup / IpssCmd / skills: clearer links, workflows, and **`-Xmx8g`** heap guidance
- Added `docs/release_note/Release-V0.3.16.md`; refreshed `persistent-plugin-rebuild.md` and `interpss-tools.md`

## Housekeeping

- Bumped package to **0.4.0**; shipped `deepseek-ai-dsh-interpss-0.4.0.tgz`
- Dropped obsolete early package tarballs (e.g. 0.1.2, 0.3.13); retained 0.3.16 artifact for reference

## Stats

- **~18 commits** since `Release-V0.3.16` (including merges)
- **52 files** changed, **+5102** / **−454** lines
