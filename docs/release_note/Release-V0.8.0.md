# Release V0.8.0

**Date:** 2026-11-09  
**Range:** `Release-V0.7.15` → `0.8.0` (`master`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.7.15 → 0.8.0**

This line ships UI polish and Host reliability after 0.7.15: Diagram gear dialog matches the CA
settings family, a shared JVM survives plugin reloads, an **InterPSS Workspace** Start-page browser
for `wspace/`, and ACLF/CA log toggles with a CA build stamp. **0.8.0** itself is a version bump
only (behaviour = 0.7.28); the CA stamp reads `v0.8.0` so a page still showing `v0.7.28` is stale.

## Highlights

- **Diagram gear = CA settings family (0.7.16):** same title/heading/label/button scale as the Run
  Contingency Analysis dialog (`cfgDialogShell`); Search/Filter stay compact. Repo ships only
  `interpss-persistent` (`interpss-dynamic` removed)
- **One JVM across plugin reloads (0.7.17):** bridge lives on `globalThis` under
  `Symbol.for('@deepseek-ai/dsh-interpss/bridge')` so a hot-swap no longer hits
  `Failed to create JavaVM: VM already created`
- **InterPSS Workspace (0.7.18–0.7.21):** Start-page card → page tab listing session `wspace/`
  (RemoteResult unwrap, absolute root, hide dotfiles / `script(s)` / `template`, folder glyphs)
- **ACLF/CA logs (0.7.22–0.7.28):** Host forwards ACLF stdout/stderr; CA panel gets its own log
  control; CA completion row carries build stamp + **Show CA Log**; result panel uses separate
  **Show ACLF Log** / **Show CA Log** (ACLF left, CA right)
- **0.8.0:** packaging / stamp bump only — install `deepseek-ai-dsh-interpss-0.8.0.tgz` and
  hard-reload (or restart) until the CA line shows `· v0.8.0`

## Version trail (0.7.16 → 0.8.0)

| Ver | What landed |
| --- | --- |
| 0.7.16 | Diagram gear dialog settings-family type scale; drop `interpss-dynamic` |
| 0.7.17 | Shared JVM / bridge across Host module reloads |
| 0.7.18 | InterPSS Workspace Start card + page tab |
| 0.7.19 | Unwrap `workspaceFiles.list` RemoteResult; absolute `<cwd>/wspace` |
| 0.7.20 | Root label **InterPSS Workspace**; hide `.` / script / template dirs |
| 0.7.21 | Folder glyph on directory rows |
| 0.7.22 | ACLF panel shows real JVM stdout/stderr |
| 0.7.23 | CA panel **Show log info** |
| 0.7.24 | CA completion stamp `· v0.7.24` |
| 0.7.25 | Stamp + log control on one completion row |
| 0.7.26 | Separate **Show CA log info** / **Show ACLF log info** |
| 0.7.27 | ACLF control left, CA right |
| 0.7.28 | Labels → **Show ACLF Log** / **Show CA Log** |
| **0.8.0** | Version / CA stamp bump (`v0.8.0`); no further behaviour change |

## UI / Host

- Diagram **⚙** dialog: 16 px title, 15/600 headings, 14 px labels, CA-style Cancel/OK
- Hot-reload safe Host: adopt existing JVM or hint restart on orphaned VM
- Workspace browser: directories-first lazy list; click file → `dsh-resource://…/wspace/…`
- Result panel log toggles are per-run (CA vs ACLF); auto-loaded prior ACLF still omits the log

## Packaging

- Single plugin tree: `interpss-persistent/` (client body in `src/client-body.js`)
- Guard: **414 checks** at 0.8.0 (was **410** at 0.7.15; briefly **408** after dropping dynamic)

## Docs & setup

- [dsh_plugin_user_guide.md](../user_guide/dsh_plugin_user_guide.md) — InterPSS Workspace, log
  labels, recommend **0.8.0**
- [interpss-tools.md](../interpss-tools.md): changelog through **0.8.0**; current version banner
  **0.8.0**
- `InstallDSHPlugin.md` / plugin README / root README pin **0.8.0**

## Verified

- Client guard: **414 checks**
- Package: `deepseek-ai-dsh-interpss-0.8.0.tgz` (kept alongside `0.7.15`, `0.7.7`, `0.6.33`)

## Install

```bash
dsh plugin --profile desktop add <abs path>/interpss-persistent/deepseek-ai-dsh-interpss-0.8.0.tgz
```

Host changes (0.7.17, 0.7.22): **restart the app**. Client-only work (Workspace, dialogs, log UI,
0.8.0 stamp): hard-reload the page after install; confirm CA completion shows `· v0.8.0`.

## Stats

- **17 commits** since `Release-V0.7.15`
- **30 files** changed, **+7764** / **−15544** lines (includes drop of `interpss-dynamic` and diagram refreshes)
