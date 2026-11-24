# Release V0.8.12

**Date:** 2026-11-24  
**Range:** `Release-V0.8.0` → `0.8.12` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.8.0 → 0.8.12**

This line follows **0.8.0** with InterPSS Workspace ↔ Simu Case sync, dialog spacing/type-scale
polish, a CA solver refresh (`woodburyMonitorBatchSize`; retired unused DC screening knobs), and a
**Report** button on the CA result card for the NERC TPL-001-5 Markdown report.

## Highlights

- **Workspace follows Simu Case (0.8.2–0.8.4):** on mount / Refresh / case change, the InterPSS
  Workspace tab expands ancestors, scrolls to the selected case, and highlights it; a new selection
  resets the tree first
- **Dialog breathing room (0.8.5–0.8.7, 0.8.9–0.8.10):** more padding/gaps on Diagram gear and Run CA;
  CA Case line under the threshold; one shared type scale across Run ACLF / Run CA / Diagram options
- **CA engine config (0.8.8):** plugin core **1.4.7** / `ipss.core.lib` **1.4.9** — drop unused
  `dclfScreening` / `dcLoadingCutoff` / `dcFlowChangeCutoff` from the dialog (legacy JSON still
  accepted, not applied); add **`woodburyMonitorBatchSize`**
- **CA NERC Report (0.8.11–0.8.12):** **Report** on the CA card (after **Contingency**) runs
  `reportType: 'nerc'` → `NERC_TPL_001_5_Report.md`; failure text names the right report per card

## Version trail (0.8.2 → 0.8.12)

| Ver | What landed |
| --- | --- |
| 0.8.2 | Workspace reveals/highlights the selected Simu Case on mount and Refresh |
| 0.8.3 | Live follow when Simu Case changes (`selectionListeners`) |
| 0.8.4 | Case switch resets the tree, then reveals the new case |
| 0.8.5 | More padding/gaps in the one-line diagram options dialog |
| 0.8.6 | More padding/gaps in the Run CA dialog |
| 0.8.7 | Run CA dialog reorder (Case under threshold; Advanced below sections) |
| 0.8.8 | `woodburyMonitorBatchSize`; retire unused DC screening knobs from dialog/`caConfig` |
| 0.8.9 | Larger **▸ / ▾** on Advanced solver settings |
| 0.8.10 | Shared type scale for the three run dialogs |
| 0.8.11 | CA card **Report** → NERC TPL-001-5 |
| **0.8.12** | Report error line uses the card's report name |

*(0.8.1 was not a documented changelog row.)*

## CA / Java

- `CaRunConfig` / `ContingencyRunner`: `woodburyMonitorBatchSize` (default `0` = off)
- Legacy `dclfScreening` / `dcLoadingCutoff` / `dcFlowChangeCutoff` still parse from older
  `ca_run.json` but are no longer offered in the GUI or tool `caConfig`
- Bundled engine: plugin core 1.4.7, `ipss.core.lib` 1.4.9

## UI

- InterPSS Workspace highlight = current Simu Case (not the last file click)
- CA completion stamp should read `· v0.8.12` after install + hard-reload
- CA explorer row: **Contingency** · **Report** (NERC); ACLF card **Report** stays ACLF

## Docs & setup

- [dsh_plugin_user_guide.md](../user_guide/dsh_plugin_user_guide.md) — Workspace sync, CA knobs,
  CA **Report**, recommend **0.8.12**
- `$ipss-case-ca` — CA card Report button
- [interpss-tools.md](../interpss-tools.md): changelog through **0.8.12**; current version banner
  **0.8.12**
- `InstallDSHPlugin.md` / plugin README / root README pin **0.8.12**

## Verified

- Client guard: **416 checks** (was **414** at 0.8.0)
- Package: `deepseek-ai-dsh-interpss-0.8.12.tgz` (kept alongside `0.8.0`, `0.7.15`, `0.7.7`, `0.6.33`)

## Install

```bash
dsh plugin --profile desktop add <abs path>/interpss-persistent/deepseek-ai-dsh-interpss-0.8.12.tgz
```

Host / jar change in **0.8.8**: **restart the app**. Client-only work (Workspace sync, dialogs,
Report button, 0.8.12): hard-reload; confirm CA completion shows `· v0.8.12`.

## Stats

- **7 commits** since `Release-V0.8.0`
- **22 files** changed, **+386** / **−197** lines
