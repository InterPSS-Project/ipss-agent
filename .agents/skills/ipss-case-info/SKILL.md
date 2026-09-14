---
name: ipss-sim-info
description: Use when asked to show the current InterPSS simulation case's network information — active bus and branch counts, total generation and load, load-flow convergence, and maximum mismatch — for the case selected in the InterPSS tab or for a named IEEE CDF / PSS/E RAW case.
metadata:
  short-description: Show the current case's network info
---

# InterPSS Network Info

Report the network information of the **current simulation case** — the case selected in the InterPSS tab. In DeepSeek Harness this is a single tool call; other agents use [Fallbacks](#fallbacks).

## Preferred path (DeepSeek Harness)

Call the `interpss_network_info` tool with **no arguments**:

```
interpss_network_info()
```

Do not ask the user which case to use: with no argument the tool resolves the case selected in the InterPSS tab.

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

Loading the case into the embedded JVM is part of the call. A case the bridge already holds is reused rather than re-parsed, so a converged AC load flow is preserved — pass `case` only to target a different case.

### Output

The result names the case and where it came from, then the network-info text:

```
InterPSS network info — data/ieee/Ieee118Bus/ieee118.ieee (source: selection)

=====Aclf Network Information:=====
Number of Active Buses: 118
Number of Active Branches: 186
Total Generation (MW): 3805.56
Total Load (MW): 3668.00
PV bus limit controls: 53

===== Loadflow Run Information:=====
Loadflow converged: false
Max Mismatch: dPmax :  0.07201 at Bus : Bus30,     dQmax : 1.29678 at Bus : Bus30
```

`source` is `argument`, `selection`, or `bridge`, and states where the case came from. Report the case the tool resolved; never present a different case as the current one.

### Reading the result

| Line | Meaning |
|---|---|
| `Number of Active Buses` / `Branches` | In-service (non-islanded) equipment in the loaded model |
| `Total Generation (MW)` / `Total Load (MW)` | Case-wide totals from the loaded model |
| `Loadflow converged: false` | Base case only — ACLF has not been run on this case in this JVM |
| `Loadflow converged: true` | A solved case; the mismatch line is the converged residual |
| `Max Mismatch` | Largest P/Q mismatch and its bus — non-zero on an unsolved case |

A `converged: false` result is not an error and needs no retry. To report solved values, run ACLF first (see `$ipss-sim`), then ask again — the tool reuses the solved model instead of reloading the case.

## Fallbacks

Use these when `interpss_network_info` is unavailable — Codex, the Claude Code CLI, or a DSH workspace where the tool reports `InterPSS is not available in this workspace`.

1. **A previous run exists** — read the network summary written by the last ACLF run:

   ```
   wspace/<input_parent>/result/<case_stem>_network_info.txt
   ```

   For example `data/ieee/Ieee118Bus/ieee118.ieee` →
   `wspace/data/ieee/Ieee118Bus/result/ieee118_network_info.txt`.

2. **No previous run** — produce it with the ACLF CLI, then read the file:

   ```bash
   cd wspace
   java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf <ieee|psse> <input_path>
   ```

Both fallbacks read a *stored* summary, so state clearly that the values come from the last run rather than the live model.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `InterPSS is not available in this workspace` | The workspace `README.md` first heading must be exactly `iPSS Agent` |
| `the in-process InterPSS bridge is unavailable` | Install `java-bridge` and build the uber JAR (`scripts/setup-java-bridge.sh`), then restart `dsh web` |
| `no simulation case is loaded in the InterPSS bridge` | Select a case in the InterPSS tab, or pass `case` explicitly |
| `unrecognized case selector` | Use a `data/…` path, an absolute path containing `/wspace/data/`, or one of the three preset labels |
| Wrong case reported | Trust `source`: `selection` is the tab, `bridge` is the last case the JVM held — pass `case` to be explicit |
| Very large case is slow or runs out of memory | The bridge JVM runs with `-Xmx4g`; see `Setup.md` for heap guidance |
