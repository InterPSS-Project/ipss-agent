# Release V0.7.16

**Date:** 2026-11-02  
**Range:** `0.7.15` → `0.7.16` (`dsh-dev`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.7.15 → 0.7.16**

0.7.16 is a single client-side polish release: the Diagram tab's **gear** (config) dialog joins
the settings family of the *Run Contingency Analysis* dialog, so the tab's two settings surfaces
read as one design instead of two.

## Highlights

- **One settings family.** The diagram-config dialog now uses `cfgDialogShell`: a 16 px / 600 title,
  15 px / 600 section headings, 14 px primary labels, 12 px hint and error lines, and the CA
  dialog's Cancel / brand-text OK pair — while keeping its narrower **440 px** column.
- **Search and Filter keep the compact shell** on purpose: only the two *settings* dialogs (CA and
  diagram config) share the larger type scale, so the pickers do not grow a second header.
- **Single package.** The tab UI now lives once in `interpss-persistent/src/client-body.js`;
  `lib/client.js` is built from it by `scripts/sync-persistent-client.mjs`. The legacy
  `interpss-dynamic/` prototype was removed, so there is no second copy to keep in step.

## Verified

- Client guard: **408 checks** after removing the legacy dynamic half — pins `cfgDialogShell` plus the 15 / 600 and
  14 px styles
- Package: `deepseek-ai-dsh-interpss-0.7.16.tgz` (kept alongside `0.7.15`, `0.7.7`, `0.6.33`)
- No Host change, so a **restart** loads it; a page refresh is enough for the dialog itself

## Install

```bash
dsh plugin --profile desktop add <abs path>/interpss-persistent/deepseek-ai-dsh-interpss-0.7.16.tgz
```

A Desktop-managed profile (the Electron app) installs through the plugin manager instead — see
[InstallDSHPlugin.md](../../InstallDSHPlugin.md).

## Docs

- [interpss-tools.md](../interpss-tools.md) — changelog row **0.7.16**; current version banner
  **0.7.16**
- `InstallDSHPlugin.md` / plugin README / root README pin **0.7.16**
