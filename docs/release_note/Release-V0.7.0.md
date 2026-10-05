# Release V0.7.0

**Date:** 2026-10-05  
**Range:** `Release-V0.6.33` → `0.7.0` (`dsh-dev`)  
**Package:** `@deepseek-ai/dsh-interpss` **0.6.33 → 0.7.0**

This release opens the **0.7.0** line. The version number is the release: no Host or Client file
changed between **0.6.37** and **0.7.0**, so everything here is the 0.6.34 → 0.6.37 body of work on
the Diagram tab — the view toggle and its raw-XML Source view removed, branch search that accepts the
bus-id spelling the drawing itself shows, a green search highlight, and a search that brings what it
selected to the middle of the view.

## Highlights

- **One view, always rendered** (0.6.34): the `R` / `S` letters and the Source view are gone; the
  toolbar reads **− · [level ▾] · + · 🔍 · ▼** beside the flags summary. The raw `.drawio` is still
  read — it is what gets parsed — it just has no surface any more
- **Branch search in the drawing's own spelling** (0.6.35): `Bus-1 -> Bus-2` now resolves, in any
  case or spacing and on either end (`bus1->bus2`, `Bus-1/2`, `1 -> Bus-2`), to exactly the bars and
  branches `1->2` reaches — and the reply names the buses as `Bus-N` whichever spelling was typed
- **The search highlight is green** (0.6.36): `DRAWIO_MATCH_FILL` is `#2EA043`, a mid-luminance green
  that stays legible on the light and the dark canvas, instead of the accent blue the birdseye's
  viewport frame still wears (now its own constant, `DRAWIO_BIRDSEYE_FRAME`)
- **A search centres the view** (0.6.37): **OK** / Enter moves the window onto the union of the hit
  boxes at the zoom you are already at, clamped to the paper by the birdseye's own clamp; a fitted
  view, a query that found nothing and a scene that is not there all leave the view untouched
- Version line: package, tarball and Desktop profile pin move to **0.7.0** together

## Version trail (0.6.34 → 0.7.0)

| Ver | What landed |
| --- | --- |
| 0.6.34 | `R` / `S` view toggle and the Source view **removed**; the tab always draws the rendered scene; guard relocates the toolbar row on the Search button |
| 0.6.35 | **Bus-id branch search**: `Bus-1 -> Bus-2`, with the prefix's hyphen and all spacing optional; the dialog's case-specific placeholder and help lead with the id form |
| 0.6.36 | Search highlight **blue → green** (`#2EA043`); birdseye frame split out as `DRAWIO_BIRDSEYE_FRAME` (kept blue); two stale R/S lines in the README and the user guide corrected |
| 0.6.37 | **OK centres the view** on the union of the hit boxes, keeping the zoom, clamped to the paper; no move at Fit, on no match, or without a scene |
| **0.7.0** | Version line only — Host and Client byte-identical to 0.6.37 |

## UI / plugin

- Toolbar: **− · [level ▾] · + · 🔍 · ▼** plus the flags summary; **draw.io** and **⚙** stay in the
  tab's upper-right corner. There is no view control of any spelling, and the picker's `Fit` entry is
  the whole-page view (0.6.34)
- Search dialog: bus number, `Bus-N`, part of a case bus name, `A-B` pair, or `Bus-A -> Bus-B`; the
  placeholder and help are built from the case in front of it (0.6.25), now leading with the id form
- A search paints the bar, its `Bus-N` text and the branch line (a thicker line) green, outranks the
  flag colours, and (0.6.37) brings the match to the middle of the view
- The InterPSS report view's own **Rendered** / **Source** buttons are a different control and are
  unaffected by 0.6.34

## Verified

- Client guard: **ALL CHECKS PASSED, 316 checks** (was 308 at 0.6.34). §16 pins ten id spellings, the
  id/number equivalence, the id-spelled reply, the highlight colour and the centring numbers; §18
  proves the birdseye frame does not follow the match colour; §12 renders the dialogs and the tab
- Real-case check on the 118-bus diagram (`Ieee118Bus`, 259 cells): every id spelling resolves to the
  same bars and branches as the number form, and at a 4× window `Bus-40`, `Bus-99` and `Bus-118`
  centre exactly while `Bus-1` and `Bus-1 -> Bus-2` are clamped to the paper's left edge with the hit
  still inside the window
- Artifacts: source, `deepseek-ai-dsh-interpss-0.7.0.tgz` and the installed profile copy are
  byte-identical; `lib/index.js` (the Host) is unchanged; `java-bridge-darwin-arm64` resolves

## Docs & setup

- [oneline_diagram_user_guide.md](../user_guide/oneline_diagram_user_guide.md) /
  [dsh_plugin_user_guide.md](../user_guide/dsh_plugin_user_guide.md): **0.7.0** Diagram toolbar
  (no `R`/`S`), bus-id search, green highlight, centre-on-OK
- [loadflow-adjustment-user-guide.md](../user_guide/loadflow-adjustment-user-guide.md) /
  [load-q-adjustment.md](../load-q-adjustment.md) / `$ipss-case-aclf-adjust` /
  `$ipss-case-load`: shipped **[0.90, 0.91]** scripts (`*0p90to0p91*`)
- [interpss-tools.md](../interpss-tools.md): current version **0.7.0**; changelog 0.6.34 → 0.7.0
- [persistent-plugin-rebuild.md](../persistent-plugin-rebuild.md): pack/verify examples on **0.7.0**
- `InstallDSHPlugin.md`, plugin README, and root README pin / link **0.7.0**

## Housekeeping

- Bumped the package to **0.7.0**; shipped `deepseek-ai-dsh-interpss-0.7.0.tgz`, the line's
  distributable. As with previous lines, only the per-minor-line tarballs are kept in the repository
  (0.2.3, 0.3.16, 0.4.0, 0.5.0, 0.6.16, 0.6.33, now 0.7.0); the 0.6.34 → 0.6.37 patch tarballs were
  discarded once 0.7.0 existed
- `config/net_diagram.json` in this workspace has **`Show_birdseye_view: false`** (a workspace
  preference, not a code change): the birdseye, and with it the frame colour question, is off here

## Stats

- **3 commits** after `Release-V0.6.33` (0.6.34, 0.6.35–0.6.36 together, 0.6.37); the 0.7.0 bump is
  the working-tree change
- Diagram code changed only in `interpss-dynamic/client-body.js` and its two derived copies
  (**+107 / −32** in the body, **+103 / −30** in the guard across the range); the **Host was
  untouched** by every one of these releases
- Client guard: **308 → 316 checks**
