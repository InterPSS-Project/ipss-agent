# InterPSS One-Line Diagram User Guide

View and generate **one-line diagrams** for the current InterPSS simulation case in DeepSeek Harness: the **Diagram** tab previews `.drawio` files under the case’s `diagram/` folder; Chat (or the generator script) creates those files from ACLF result CSVs.

![InterPSS Diagram tab](../image/ipss-dsh-diagram.png)

This guide is the practical how-to for the DSH plugin. For the InterPSS tab and Chat overview, see [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md). For generator layout rules and the draw.io MCP round-trip, see [oneline-diagram-process.md](../oneline-diagram-process.md). The generate path is packaged as `$ipss-case-diagram`.

---



## When to use this


| Situation | Approach |
| --------- | -------- |
| Case already has a `.drawio` under `diagram/` | Open the **Diagram** tab and inspect / zoom / edit |
| Case has ACLF results but no diagram yet | Ask Chat to draw it (`$ipss-case-diagram`), or run the generator script |
| Layout looks wrong after generation | Re-run with another `--seed`, or open the file in draw.io and edit |
| You need the authoritative PNG | Use the Diagram tab’s draw.io button (desktop app), not only the Pillow preview |


---



## Prerequisites

- DeepSeek Harness with the InterPSS plugin installed (Diagram tab: **0.6.8+**; draw.io button: **0.6.12+**, improved **0.6.15+**, configurable launcher **0.6.16+**) — see [InstallDSHPlugin.md](../../InstallDSHPlugin.md)
- An **iPSS Agent** workspace (same activation gate as the InterPSS tab)
- A selected / loaded simulation case under `wspace/data/**`
- For **generation**: converged ACLF outputs `<case>/result/<stem>_DF_bus.csv` and `_DF_branch.csv` (run ACLF first if missing)
- Optional: the local **draw.io** desktop app to edit from the Diagram tab. Which executable is launched comes from [`config/ipss_plugin_env.json`](../../config/ipss_plugin_env.json) — `open -a draw.io` on macOS by default, with a Windows and a Linux path shipped as well (see [Configure the draw.io launcher](#configure-the-drawio-launcher-0616))

---



## Diagram tab (view and interact)

The tab bar reads **Chat · InterPSS · Diagram · Trajectory**. The **Diagram** tab draws the one-line diagram of whichever case the InterPSS tab has selected.

![InterPSS Diagram in context](../image/ipss-dsh-chat-diagram.png)

### Open and load

1. Select a case in the **InterPSS** tab (preset or custom path); the Diagram tab follows that selection.
2. Switch to **Diagram**. It reads that case’s `diagram/` folder:
   - **one** `.drawio` — opened straight away;
   - **several** — a picker to switch between them (remembers the last one you viewed);
   - **none** — the tab says so; generate a diagram first (see [Generate a one-line diagram](#generate-a-one-line-diagram)).
3. Loading another case from Chat (`interpss_case_load`) moves the Diagram tab with it — it always draws the **current** simulation case, so the two tabs cannot disagree.

### Toolbar and interaction

Toolbar (plugin **0.6.11+**): **Rendered · Source · − · 100% · + · Fit**, plus the **draw.io** button at the right end (**0.6.12+**).

| Action | Effect |
| ------ | ------ |
| **hover** a bus bar (or its `Bus-N` label) or a branch | Same tooltip style as the InterPSS connection diagram; without a converged result: `no result data — run ACLF` |
| **scroll** / **drag** | Zoom about the cursor / pan |
| **Fit** | Reset view to the page |
| **Source** | Raw draw.io XML |
| **draw.io** button (upper-right, **0.6.15+**) | Opens the current file in the local draw.io desktop app, using the launcher configured in `config/ipss_plugin_env.json` (**0.6.16+**; `open -a draw.io` on macOS by default). Status text appears to the left of the button (`Launched draw.io…` or the Host error). Restart `dsh web` after a Host change so the button works. |

(Plugin history in brief: **0.6.8** added the tab; **0.6.9** removed the InterPSS tab’s old **Diagram** dialog button; **0.6.10** gave the drawing more space; **0.6.11** dropped the zoom/pan hint text; **0.6.12** added the draw.io button; **0.6.15** moved it to the tab’s upper-right corner; **0.6.16** made the desktop-app path configuration.)

### Configure the draw.io launcher (0.6.16+)

The button does not hard-code a desktop app: it reads an ordered launcher list from the project’s
[`config/ipss_plugin_env.json`](../../config/ipss_plugin_env.json) (beside `config/aclf_run.json`),
so the same plugin serves macOS, Windows and Linux. The shipped file already names a draw.io
executable for each OS:

| Platform | Shipped launchers (in order) |
| -------- | ---------------------------- |
| macOS | `open -a draw.io` → `/Applications/draw.io.app/Contents/MacOS/draw.io` |
| Windows | `C:\Program Files\draw.io\draw.io.exe` → `cmd.exe /c start ""` |
| Linux | `drawio` → `/opt/drawio/drawio` → `xdg-open` |
| any | untagged `open` / `xdg-open`, tried last as file-association fallbacks |

- `exe` is the executable (a bare name is looked up on `PATH`, or give an absolute path such as
  `D:\Apps\draw.io\draw.io.exe`), `args` are prepended before the file path, `label` is what the
  status text reports, and the optional `platform` tag (`darwin` / `win32` / `linux`; `macos`,
  `windows` and `posix` are accepted) limits an entry to one OS.
- Entries for **this** machine’s platform are tried first, then the untagged ones; entries for
  another OS are skipped, so one committed file works everywhere. **Put your own install at the
  top** of the list if it lives somewhere unusual.
- Every entry resolves its executable before it is spawned, so a path that is not installed is
  skipped with a message rather than failing the click, and all the failures are reported together
  in the button’s error.
- A missing file is fine (the built-in defaults are exactly the shipped list). A file that exists
  but is malformed falls back to those defaults and says so in the error text, so a typo does not
  look like a broken button.
- Changing the file needs no plugin restart — it is read per click (only the 0.6.16 **code** needs
  one app restart to arrive).

---



## Generate a one-line diagram

Diagrams are **generated, not hand-placed**, for cases larger than a small teaching example. The generator (`wspace/script/gen_oneline_diagram.py`) lays out buses and branches from ACLF CSVs in the style of `wspace/template/oneline-diagram.drawio`, then writes:

- `<case>/diagram/<stem>-oneline.drawio` — what the Diagram tab opens
- `<stem>-oneline-preview.png` — optional Pillow preview (approximate)

### From Chat (recommended)

With the case selected (or named) and ACLF results present:

```text
Draw the one-line diagram for the current case
```

or:

```text
/ipss-case-diagram
```

The agent runs `$ipss-case-diagram`, which resolves the case folder, checks for `*_DF_bus.csv` / `*_DF_branch.csv`, runs the generator, and reports the `.drawio` path. Switch to the **Diagram** tab to view it.

If results are missing first:

```text
Run ACLF on the selected case, then draw the one-line diagram
```

### From the shell

Use the harness Python that has **numpy** and **Pillow** (a bare system `python3` often lacks Pillow):

```bash
PY="${DSH_PYTHON:-$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3}"

"$PY" wspace/script/gen_oneline_diagram.py wspace/data/ieee/Ieee118Bus \
    --title "IEEE 118-Bus One-Line Diagram"
```

Useful flags:

| Flag | Detail |
| ---- | ------ |
| `--title TEXT` | Page title and diagram name |
| `--seed N` | Another valid layout for the same topology (default `11`) |
| `--no-png` | Skip the Pillow preview |
| `--check FILE` | Validate an existing diagram; write nothing |
| `--open` | After a passing self-check, open in the draw.io editor (MCP) |

A non-zero exit means the self-check failed (ids, transformers, Bus-1 corner rule, etc.).

### What gets drawn


| Element | Detail |
| ------- | ------ |
| Buses | Vertical bar per bus with `Bus-N` label above |
| Branches | One undirected line per branch row; parallel circuits slightly apart |
| Transformers | Two interlocking rings on `IsXfmr` branches |
| Loads / generators / voltage colours | Not drawn — topology only |
| Header | Title, subtitle (counts / voltage levels when available), legend |


Regenerating **replaces** the `.drawio`. Hand edits in draw.io are lost on the next generator run unless you save under a different name.

---



## Typical workflows

### View an existing diagram

```text
1. Load / select the case in the InterPSS tab
2. Open the Diagram tab
3. Hover buses/branches; zoom / Fit as needed
4. Optionally open draw.io to edit
```

### Generate then inspect

```text
Load IEEE 118-bus
Run ACLF on the selected case
Draw the one-line diagram for the current case
```

Then open the **Diagram** tab (or click the draw.io button to edit in the desktop app).

### Edit and keep a custom copy

1. Generate (or open) the case diagram.
2. Use the Diagram tab’s **draw.io** button, edit, and save.
3. If you may regenerate later, **Save As** another name under the same `diagram/` folder (for example `ieee118-oneline-annotated.drawio`) so the picker can switch between files.

---



## Tips and troubleshooting


| Symptom | What to check |
| ------- | ------------- |
| Diagram tab says there is no diagram | No `.drawio` under `<case>/diagram/` — run `$ipss-case-diagram` (after ACLF) |
| Preview shows nothing / wrong case | File must sit in the **selected** case’s `diagram/` folder; only `.drawio` is listed (PNG is ignored) |
| Tooltips say `no result data — run ACLF` | Run ACLF so bus/branch result CSVs exist for the case |
| Generator: `no *_DF_bus.csv / *_DF_branch.csv` | Solve ACLF first (`$ipss-case-aclf`), then re-run |
| `ModuleNotFoundError: No module named 'PIL'` | Use the harness Python path above, or pass `--no-png` |
| draw.io button does nothing / Host error | Install draw.io desktop app; point `exe` at your install in `config/ipss_plugin_env.json` (0.6.16+); restart `dsh web` after plugin Host updates (0.6.12+) |
| Bus tooltips broken after hand edit | Keep cell ids `busN` and labels exactly `Bus-N`; keep each transformer’s two rings under one `style=group` cell |
| Layout still ugly after generate | Try another `--seed`; for tiny teaching cases, prefer hand layout in draw.io |
| Hand edits disappeared | Regenerating overwrites the default `<stem>-oneline.drawio` — use a separate filename |


---



## Related

- [dsh_plugin_user_guide.md](dsh_plugin_user_guide.md) — InterPSS tab, Diagram tab entry point, Chat tools
- [oneline-diagram-process.md](../oneline-diagram-process.md) — layout pipeline, template contract, draw.io MCP
- [batch_chat_user_guide.md](batch_chat_user_guide.md) — batch `/ipss-sim` style runs
- Skills: `$ipss-case-diagram` (generate), `$ipss-case-aclf` (result CSVs), `$ipss-case-load`
- Template: `wspace/template/oneline-diagram.drawio`
- Generator: `wspace/script/gen_oneline_diagram.py`
