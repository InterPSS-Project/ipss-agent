---
name: ipss-case-load
description: Use when asked to load a power-system simulation case into the embedded InterPSS bridge — the case selected in the InterPSS tab, or a named IEEE CDF / PSS/E RAW case — and to report its active bus and branch counts, including switching the bridge to a different case, re-parsing the held case from disk ("reload"), and loading with a Groovy .gvy script applied in the same call.
metadata:
  short-description: Load a simulation case, optionally with a .gvy script
---

# InterPSS Case Load

Load a simulation case into the **embedded InterPSS bridge** and report what it holds. This is the
explicit first step of every other DSH tool: the loaded case is the "current simulation case" the
chat works on until another case replaces it.

Loading **parses the case into the model and caches it** — it does not solve anything. Follow with
`$ipss-case-aclf` when solved values are needed.

A load request may also name a **Groovy script** — "reload this case and run `x.gvy`", or a call
carrying a `.gvy` path. That is the scripted-reset form of the same step, not `interpss_case_load`:
see **Loading with a script (reload + apply)** below.

## Preferred path (DeepSeek Harness)

### Step 1 — load

```
interpss_case_load()
```

With no argument the tool resolves the case exactly like the other tools:

1. the `case` argument, when supplied;
2. the case currently selected in the InterPSS tab;
3. the case the embedded bridge already holds.

Pass `case` to switch to a specific case — required when the tab selection is not the case you mean:

```
interpss_case_load({ case: 'IEEE 118-bus' })
interpss_case_load({ case: 'data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW' })
interpss_case_load({ case: 'wspace/data/ieee/Ieee14Bus/ieee14.ieee' })
```

| `case` form | Example |
|---|---|
| Workspace-relative path | `data/ieee/Ieee118Bus/ieee118.ieee` |
| Workspace-relative, as the session shows it | `wspace/data/ieee/Ieee118Bus/ieee118.ieee` (the `wspace/` and `./wspace/` prefixes are stripped; plugin 0.3.18+) |
| Absolute path containing `/wspace/data/` | `/…/ipss-agent/wspace/data/ieee/Ieee14Bus/ieee14.ieee` |
| Preset label (case-insensitive) | `IEEE 118-bus`, `IEEE 14-bus`, `Texas 2K-bus` |

Anything else fails with `unrecognized case selector …` before the bridge is touched.

### Reading the result

| Field | Meaning |
|---|---|
| `case` | The workspace-relative case path the bridge now holds |
| `source` | Where it came from: `argument`, `selection` (the tab) or `bridge` |
| `alreadyLoaded` | `true` when the bridge already held that exact case — nothing was re-parsed |
| `busCount` / `branchCount` | Active (in-service, non-islanded) equipment in the loaded model |
| `error` | Set instead of the above when the load failed |

A large case (PSS/E 2K-bus and up) takes seconds to parse; the call is otherwise instant.

### Loading with a script (reload + apply)

`interpss_case_load` takes a **case** selector only and cannot force a re-parse: on a case the bridge
already holds it answers `alreadyLoaded: true` and touches nothing. When the request names a `.gvy`
file, or asks to **reload** the case, the step is a scripted reset instead:

```
interpss_run_gvy({ case: 'data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee',
                   script: 'ieee14_adjBus1314Q_0p89to0p90.gvy',
                   reload: true })
```

`reload: true` re-parses the case **from disk** before the script is evaluated, so one call does both
halves: a fresh model — the stored, unedited case, replacing any solved state or earlier script edit
the bridge was holding — plus the script's edit on top of it. The script is resolved inside the
resolved case's `scripts/` folder, so pass `case` whenever the tab selection is not the case that owns
the script.

Reading a call that carries a script path:

- `@wspace/data/ieee/Ieee14Bus_LargeLoadQ2/scripts/ieee14_adjBus1314Q_0p89to0p90.gvy` → case
  `data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee` (the `.ieee` / `.RAW` file in the folder **above**
  `scripts/`), script `ieee14_adjBus1314Q_0p89to0p90.gvy`.
- A bare `x.gvy` → the script in the resolved case's `scripts/` folder (argument → tab → bridge), so
  name `case` explicitly when the tab selection may differ.
- If that folder holds no case file, or several, do not guess — pass `case` explicitly or ask.

A `.gvy` path is never a valid `case` selector: `interpss_case_load` refuses it with
`unrecognized case selector …` before the bridge is touched.

**Re-parse with no edit.** `interpss_run_gvy` always requires a script, so pass a one-line read-only
probe and read the state it prints back:

```
interpss_run_gvy({ case: '…', reload: true,
  script: "println 'Q13=' + aclfnet.getBus('Bus13').loadQ + ' solved=' + aclfnet.isLfConverged()" })
```

**After the call** the model is the freshly parsed case plus the script's edit — still **unsolved**
unless the script solves it itself (some adjuster scripts run their own load flow). Follow with
`$ipss-case-aclf` when solved values are needed. The card carries the script, the case and its
`source`, the load/generation delta and the script's return value or stdout; do not restate it.

The full script contract — file vs inline source, the `wspace/script/` fixtures folder, the array
form, the 20-script limit — belongs to `$ipss-case-script`.

## What loading does — and what it destroys

- The case becomes the bridge's **base case**: the object `interpss_network_info`,
  `interpss_run_aclf`, `interpss_run_gvy` and `interpss_case_summary` all read.
- It also becomes the session's **current case** (plugin 0.3.19+): the tab's **Simu Case** picker
  follows it through the `getBridgeCase` RPC, the tab prints its `✓ Loaded: N buses, M branches`
  indicator and refills its network-info panel (0.3.22+, and it survives switching between the Chat
  view and the tab, 0.3.23+), and the next no-argument tool call resolves
  to it instead of the case the tab had selected. Before 0.3.19 the picker kept showing the old case —
  pass `case` explicitly on every call when in doubt.
- It is a **no-op** (`alreadyLoaded: true`) when the bridge already holds that exact path — so
  calling it repeatedly is safe, and it will *not* reset anything.
- Loading **a different case replaces the held model**. A converged load flow and any
  `interpss_run_gvy` script edits live only on the held model, so they are gone afterwards. That,
  and the tab's **Load** button, are the reset paths:
  - same case, want a re-parse → the tab's **Load** button re-parses even when the bridge holds the
    case; from chat, `interpss_run_gvy({ script: '…', reload: true })` re-parses before evaluating;
  - `interpss_case_load` on the same case cannot force that re-parse.
- Loading does **not** write, read or invalidate the result CSVs under
  `wspace/<case dir>/result/`; those belong to a run, not to the model.
- `interpss_case_load` never solves: `Loadflow converged: false` from `$ipss-case-info` right after a
  load is the normal base-case state, not a failure.

### Replying after a call

The tool card carries the case, its `source` and the counts; do not restate them. Reply with at most
a one-line confirmation. Add prose only when the caller needs something the card cannot carry:

- the load **failed** — report the message (an unrecognized selector, a missing file, an unreadable
  case);
- it loaded an **unexpected case** — for example `source: selection` picked up a tab that changed,
  or a preset label was misread;
- a **decision** is required — the case you just replaced held unsolved script edits or a solved
  state that is now gone, or the tab selection and the loaded case disagree (say which case the next
  call will resolve to).

### Choosing the right tool

| Want | Use |
|---|---|
| Parse a case into the bridge and report its counts | `interpss_case_load` |
| Show the loaded case's network info, without solving | `interpss_network_info` |
| Solve the loaded case and write result CSVs | `interpss_run_aclf` |
| Apply a scenario edit to the loaded case | `interpss_run_gvy` |
| Re-parse the held case from disk, optionally applying a `.gvy` in the same call | `interpss_run_gvy({ script: '…', reload: true })` |
| Summarize the loaded case | `interpss_case_summary` |

The other tools load on demand, so a missing step 0 costs an extra parse, not a failure.

## Fallbacks

`IpssCmd` has **no standalone load command**: the Java CLI parses a case as part of `aclf`, `ca` or
`report`, and the DSH bridge is what holds a base case between calls. From Codex or the Claude Code
CLI:

1. **A previous run exists** — read `wspace/<case dir>/result/<stem>_network_info.txt`; its
   `Number of Active Buses` / `Branches` lines carry the stored counts (from the last run, not from a
   live model).
2. **No previous run** — produce it with the CLI, which parses and solves in one step:

   ```bash
   cd wspace
   java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf <ieee|psse> <input_path>
   ```

State clearly that such a run is its own JVM: nothing stays "loaded" for the next command, so every
CLI invocation re-parses the case.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `unrecognized case selector` | Use a `data/…` (or `wspace/data/…`) path, an absolute path containing `/wspace/data/`, or one of the three preset labels |
| `no simulation case is selected` | Nothing is in the tab and the bridge is empty — pass `case` explicitly |
| `alreadyLoaded: true` when a re-parse was wanted | The tool reuses the held model by design — it cannot re-parse. Use the tab's **Load** button, or `interpss_run_gvy({ script: '…', reload: true })`, which is also how a load is combined with a script |
| A `.gvy` path passed as `case` | A script is not a case: `interpss_case_load` answers `unrecognized case selector`. Name the case (the `.ieee` / `.RAW` above `scripts/`) and pass the script to `interpss_run_gvy` separately |
| The loaded case is not the one expected | Trust `source`: `selection` is the tab, `argument` is what you passed; pass `case` to be explicit |
| A solved state or a script edit vanished | Another case was loaded (by this tool or the tab), which replaced the held model; re-apply the edit and re-solve |
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| Very large case is slow or runs out of memory | The bridge JVM runs with `-Xmx8g` (4g before plugin 0.3.20); see `Setup.md` for heap guidance |

## Related

- `$ipss-case-info` — network info of the loaded case (base case, or solved after an ACLF run)
- `$ipss-case-aclf` — solve the loaded case and write the result files
- `$ipss-case-script` — the script contract (file vs inline source, `wspace/script/` fixtures, array
  form, inline bounds) and the reload + apply pattern used to load a case together with a script
- `$ipss-case-summary` — summarize the loaded case
- [docs/interpss-tools.md](../../../docs/interpss-tools.md) — the `interpss_case_load` tool contract and the case-resolution rules
