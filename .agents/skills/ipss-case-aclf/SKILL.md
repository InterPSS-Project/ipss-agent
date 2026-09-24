---
name: ipss-case-aclf
description: Use when asked to run an AC load flow (ACLF) for the current InterPSS simulation case — the case selected in the InterPSS tab — or for a named IEEE CDF / PSS/E RAW case, and to report convergence plus the result files the run writes.
metadata:
  short-description: Run ACLF for the selected case
---

# InterPSS AC Load Flow

Solve the **current simulation case** — the case selected in the InterPSS tab — and report whether it converged. In DeepSeek Harness this is a single tool call; other agents use [Fallbacks](#fallbacks).

## Preferred path (DeepSeek Harness)

### Step 0 — load the selected case

Start with `interpss_case_load`:

```
interpss_case_load()
```

It loads the case selected in the tab into the embedded bridge and is a **no-op** reporting `alreadyLoaded: true` when the bridge already holds it, so it is safe to call unconditionally (see `$ipss-case-load`). The ACLF tool below still loads on demand, so this step is a convention rather than a hard requirement — its value is making the load explicit before the solve.

### Step 1 — run the load flow

Call the `interpss_run_aclf` tool with **no arguments**:

```
interpss_run_aclf()
```

Do not ask the user which case to run: with no argument the tool resolves the case selected in the InterPSS tab, so selecting the case is the only setup needed (pressing **Load** in the tab first is not required).

### Case resolution order

1. the `case` argument, when supplied;
2. the case currently selected in the InterPSS tab;
3. the case the embedded InterPSS bridge already holds.

`case` accepts any of:

| Form | Example |
|---|---|
| Workspace-relative path | `data/ieee/Ieee118Bus/ieee118.ieee` |
| Absolute path containing `/wspace/data/` | `/…/ipss-agent/wspace/data/ieee/Ieee14Bus/ieee14.ieee` |
| Preset label (case-insensitive) | `IEEE 118-bus`, `IEEE 14-bus`, `Texas 2K-bus` |

Pass `case` only to solve a different case than the selected one.

### What the run does

- Reuses the model already loaded in the embedded bridge (no re-parse); otherwise loads the case first.
- Solves with the **case-folder** `aclf_run.json` when present, otherwise the project default `config/aclf_run.json` — the same two-tier rule as `ProjectPaths`. Tune `lfMethod`, `maxIterations`, tolerance and limit controls there.
- Writes, under `wspace/<case dir>/result/`:

| File | Content |
|---|---|
| `<stem>_DF_bus.csv` | Bus voltage magnitude/angle, injections |
| `<stem>_DF_branch.csv` | Branch flows |
| `<stem>_DF_gen.csv` | Generator output |
| `<stem>_DF_load.csv` | Load data |
| `<stem>_network_info.txt` | Network summary + convergence |

Large cases (PSS/E 2K-bus and up) can take minutes.

### Output

The result names the case and where it came from, then convergence and the network summary:

```
InterPSS AC load flow — data/ieee/Ieee118Bus/ieee118.ieee (source: selection)
Converged: true
Results: wspace/data/ieee/Ieee118Bus/result

=====Aclf Network Information:=====
Number of Active Buses: 118
Number of Active Branches: 186
Total Generation (MW): 3800.44
Total Load (MW): 3668.00
PV bus limit controls: 53

===== Loadflow Run Information:=====
Loadflow converged: true
Max Mismatch: dPmax :  0.00001 at Bus : Bus104,     dQmax :  0.00005 at Bus : Bus105
```

`source` is `argument`, `selection`, or `bridge`. Report the case the tool resolved; never present a different case as the current one.

### Reading the result

| Line | Meaning |
|---|---|
| `Converged: true` | Solved. On a converged case the reported generation includes losses and control adjustments, so it can differ from the base-case scheduled value |
| `Converged: false` | The solve did not converge — a **successful call with an unsuccessful solve**, not a tool error |
| `Max Mismatch` | Largest P/Q mismatch and its bus, in pu on the 100 MVA base; the residual on a converged run (typically ≤ 1e-5), the failure magnitude otherwise. The runner re-solves when a converged run still violates a bus balance — a switched-shunt step or a PV→PQ conversion applied after the last NR iteration — so a settled run reports the residual of the state it actually returns |
| `Results:` | `wspace/<case dir>/result/`, where the five files were written |

On non-convergence, do not re-run the identical call and do not report the case as solved. Report the mismatch and the bus, then either read the network info for context or tune the solver options in the case's `aclf_run.json` before trying again.

### Result explorer on the card

With plugin 0.3.2+ the settled card shows an **Explore results** row with **Bus / Branch / Gen / Load**, paging rows through the same endpoint the tab uses. Clicking a scope loads the first 100 rows, and scrolling the table to the bottom appends the next page automatically (there is no *Load more* control). A **Report** button in the same row (0.3.3+, next to Load) generates the AC Loadflow Markdown report from the run's CSVs and opens it in the file surface — point the user at it rather than regenerating the report by hand. Cards from an older plugin version carry no explorer metadata and render the result text only — that is expected, not a failed run.

### Replying after a run

The card **is** the report. It already carries the case and its `source`, the `Converged:` line, `Results:`, the network summary, and the **Explore results** row. Do not restate any of it in the assistant message — no repeated network-info block, no convergence table, no result-file listing, and nothing after the Explore results row. The `interpss_case_load` card carries the load outcome the same way: mention it only if the load failed or loaded an unexpected case.

Reply with at most a one-line confirmation that the run finished and whether it converged. Write more only when the user needs something the card does not carry:

- the solve did **not** converge and a decision is required;
- `source` contradicts what was asked (for example the tab selection changed since the last run);
- a concrete next step must be chosen — such as regenerating a report this run made stale, or running the CA step so the contingency sections match.

### Choosing the right tool

| Want | Use |
|---|---|
| Load the selected case into the bridge, without solving | `interpss_case_load` |
| Solve the case (and write result CSVs) | `interpss_run_aclf` |
| Only show the loaded/selected case's network info, without solving | `interpss_network_info` |
| Summarize the case — totals, or a top-N ranking by scope | `interpss_case_summary` (`$ipss-case-summary`) |

`interpss_network_info` reuses a converged model, so after an ACLF run it reports the solved values.

## Fallbacks

Use these when `interpss_run_aclf` is unavailable — Codex, the Claude Code CLI, or a DSH workspace where the tool reports `InterPSS is not available in this workspace`.

1. **Skill-style** — `$ipss-sim` (Codex) or `/ipss-sim` (Claude Code), ACLF-only shortcut:

   ```
   /ipss-sim Aclf only <directory_or_case> "<Loadflow Report Name>"
   ```

2. **Direct CLI** — run from `wspace/`:

   ```bash
   cd wspace
   java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf <ieee|psse> <input_path>
   ```

   It prints the config it used (`Using config file: …`) and writes the same five files under `<input_parent>/result/`.

## After a run

The run **overwrites** that case's `*_DF_*.csv` and `*_network_info.txt`. Any previously generated `NERC_TPL_001_5_Report.md`, `AC_Loadflow_Report.md`, or HTML dashboard in that folder was derived from the older CSVs and is now stale — regenerate it (`$nerc-report-html`, `$nerc-report-slides`, or the `report` CLI) when the report must match the new results. `*_DF_contingency.csv` is untouched, since it comes from a contingency run rather than ACLF.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| `no simulation case is selected` | Select a case in the InterPSS tab, or pass `case` explicitly |
| `unrecognized case selector` | Use a `data/…` path, an absolute path containing `/wspace/data/`, or one of the three preset labels |
| `Converged: false` | Tune `maxIterations` / `tolerance` / limit-control flags in the case-folder `aclf_run.json`; report the mismatch bus rather than retrying unchanged |
| Wrong case solved | Trust `source`: `selection` is the tab, `bridge` is the last case the JVM held — pass `case` to be explicit |
| Very large case is slow or runs out of memory | The bridge JVM runs with `-Xmx8g` (4g before plugin 0.3.20); see `Setup.md` for heap guidance |
