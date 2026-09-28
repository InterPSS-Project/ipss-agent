# `org.interpss.agent.script.gvy` — Groovy Script Adapter Architecture

## Purpose

The Groovy script adapter lets callers mutate a live InterPSS network from Groovy source — either an inline string or a `.gvy` file — without writing Java against the model API for every what-if change. It also exposes DC sensitivity analysis on the same live network via a bound `SenAnalysisAlgorithm`.

Typical uses:

- Adjust bus loads, branch impedance / status, network id, or contribute gen/load data after import
- Query bus sensitivities (e.g. dV/dQ via `SenAnalysisType.QVOLTAGE`) without leaving the script
- Query generation shift factors (GSF) via `senAlgo.calGenShiftFactor(injectBusId, monitorBranch)`
- Query weighted gen-transfer factors via `senAlgo` inject/withdraw lists + `genTransferDistFactor(branch)`
- Drive study automation (batch parameter changes before load flow)
- Keep scenario edits as readable scripts next to case data

**Design note:** Scripts operate on the **same object instance** held by the processor. There is no copy-on-eval and no separate script-model layer. Binding exposes the network and sensitivity algorithm under fixed variable names (`aclfnet`, `senAlgo`); Groovy property syntax maps to JavaBean getters/setters on InterPSS EMF/Java objects.

## Package Layout

```
org.interpss.agent.script.gvy
├── BaseDshGvyScriptProcessor       # Abstract base: shared imports + evaluate()
└── AclfNetDshGvyScriptProcessor    # ACLF binding: aclfnet, senAlgo

Related (outside package)
├── org.interpss.agent.runner.GvyScriptRunner          # File I/O + before/after digest for bridge/CLI
├── org.interpss.agent.script.gvy.GvyScriptEvalTest    # Unit coverage
└── wspace/script/*.gvy                               # Script fixtures
```

This package lives in **ipss-agent** (`src/main/java/org/interpss/agent/script/gvy/`). The `Dsh` infix distinguishes these classes from the older `org.interpss.script.gvy.AclfNetGvyScriptProcessor` / `BaseGvyScriptProcessor` that may still ship inside `ipss-runnable` / ipss-plugin — prefer the agent `*Dsh*` types here.

## Dependency

| Artifact                           | Role                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `org.apache.groovy:groovy` (4.0.x) | `GroovyShell`, `Binding`                                                          |
| `com.interpss:ipss.core.lib`       | `AclfNetwork`, `SenAnalysisAlgorithm`, `SenAnalysisType`, `DclfAlgoObjectFactory` |
| `org.apache.commons.math3`         | `Complex` — pre-imported for scripts via `GVY_IMPORTS`                            |

## Class Hierarchy

```
BaseDshGvyScriptProcessor (abstract)
  └── AclfNetDshGvyScriptProcessor   # binds AclfNetwork as "aclfnet",
                                  # SenAnalysisAlgorithm as "senAlgo"
```

Extension point for future processors (same pattern):

```
BaseDshGvyScriptProcessor
  ├── AclfNetDshGvyScriptProcessor      # aclfnet + senAlgo
  ├── AcscNetDshGvyScriptProcessor      # (future) acscnet
  └── DStabNetDshGvyScriptProcessor     # (future) dstabnet
```

## Architecture Overview

```
  ┌──────────────────────────────────────┐
  │  Caller                              │
  │  GvyScriptEvalTest / GvyScriptRunner │
  │  bridge / CLI                        │
  └───────────────┬──────────────────────┘
                  │ 1. load AclfNetwork (IeeeFileAdapter, etc.)
                  │ 2. new AclfNetDshGvyScriptProcessor(net)
                  │ 3. evaluate(groovyCode)  or  FileUtil.read → evaluate
                  ▼
  ┌──────────────────────────────────────┐
  │  AclfNetDshGvyScriptProcessor           │
  │  ┌────────────────────────────────┐  │
  │  │ Binding                        │  │
  │  │   "aclfnet" → AclfNetwork      │  │
  │  │   "senAlgo" → SenAnalysisAlgo  │  │
  │  └───────────────┬────────────────┘  │
  │                  │                     │
  │  GroovyShell(binding)                  │
  │                  │                     │
  │  evaluate(GVY_IMPORTS + groovyCode)    │
  └──────────────────┼─────────────────────┘
                     │ mutates / queries in place
                     ▼
              AclfNetwork (live model)
                  buses / branches /
                  contribute loads / gens
                     ▲
                     │ shares network
              SenAnalysisAlgorithm
                  calBusSensitivity(...)
                  calGenShiftFactor(...)      # GSF (withdraw = ref)
                  injectBusList / withdrawBusList
                  genTransferDistFactor(...)  # weighted transfer
```

## Core Components

### `BaseDshGvyScriptProcessor`

Owns the shared evaluation contract:

- Holds a protected `GroovyShell shell` (created by subclasses with a domain-specific `Binding`)
- Defines `GVY_IMPORTS` — text prepended to every script so callers need not import common types
- `evaluate(String groovyCode)` → `shell.evaluate(GVY_IMPORTS + groovyCode)` and returns the last expression value (or `null` when the script has no return)

Current shared imports:

```java
import org.apache.commons.math3.complex.Complex;
import com.interpss.core.DclfAlgoObjectFactory;
import com.interpss.core.algo.dclf.SenAnalysisType;
import com.interpss.core.contingency.ContingencyBranchOutageType;
```

Scripts can therefore write `new Complex(r, x)`, `SenAnalysisType.QVOLTAGE` / `PANGLE`, and related factory / outage types without local import statements.

### `AclfNetDshGvyScriptProcessor`

AC load-flow specialization:

1. Stores the `AclfNetwork` reference
2. Creates a `Binding` and registers:
  - `"aclfnet"` → the live `AclfNetwork`
  - `"senAlgo"` → `DclfAlgoObjectFactory.createSenAnalysisAlgorithm(aclfNet)` on the **same** network
3. Constructs `GroovyShell` with that binding
4. Exposes `getAclfNet()` for the caller to inspect/assert after eval

Scripts address the network through `aclfnet` and sensitivity through `senAlgo` (lowercase binding keys) — not the Java field names.

**Lifetime:** `senAlgo` is created once at processor construction and reuses the bound network. Call `senAlgo` after structural edits if you need sensitivities that reflect the updated topology/parameters (the algorithm reads the live `AclfNetwork`). Inject/withdraw bus lists on `senAlgo` **persist across** `evaluate` **calls** on the same processor — clear and repopulate them when changing transfer scenarios.

### `GvyScriptRunner` (related)

Production entry for bridge/CLI: reads a `.gvy` file, evaluates it with `AclfNetDshGvyScriptProcessor`, and returns a before/after digest (load/gen MW, bus/branch counts, return value). File I/O stays in the runner; the processor only evaluates strings.

## Data Flow

### Inline script

```
AclfNetwork net
       │
       ▼
AclfNetDshGvyScriptProcessor(net)     // Binding: aclfnet = net, senAlgo = SenAnalysis(...)
       │
       ▼
evaluate("aclfnet.getBus('Bus14').loadP = 0.18;")
       │
       ▼
net.getBus("Bus14").getLoadP() == 0.18   // same instance
```

### Sensitivity query (inline)

```
evaluate("""
  dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, 'Bus14', 'Bus14')
  return 'Bus14 dV/dQ: ' + dVdQ
  """)
       │
       ▼
senAlgo.calBusSensitivity(QVOLTAGE, ...) on live aclfnet
```

`SenAnalysisType.QVOLTAGE` returns **dV/dQ** (B″ path). Self-bus dQ/dV is the reciprocal when needed: `1.0 / dVdQ`.

### GSF query (inline)

```
evaluate("""
  branch = aclfnet.getBranch('Bus5->Bus6(1)')
  gsf = senAlgo.calGenShiftFactor('Bus8', branch)
  return 'Bus8 - Bus5->Bus6(1) GSF: ' + gsf
  """)
       │
       ▼
senAlgo.calGenShiftFactor(injectBusId, monitorBranch)
  // withdraw = reference / slack bus
```

`calGenShiftFactor` is the single-injection GSF API (inject bus vs ref/slack on one monitor branch).

### Weighted gen-transfer factor (inline)

```
evaluate("""
  senAlgo.injectBusList.clear()
  senAlgo.addInjectBus(aclfnet.getBus('Bus2'), 1.0)
  senAlgo.withdrawBusList.clear()
  senAlgo.addWithdrawBus(aclfnet.getBus('Bus14'), 0.9)
  senAlgo.addWithdrawBus(aclfnet.getBus('Bus13'), 0.1)
  branch = aclfnet.getBranch('Bus9->Bus14(1)')
  f = senAlgo.genTransferDistFactor(branch)
  return '... ' + f
  """)
       │
       ▼
senAlgo.genTransferDistFactor(monitorBranch)
  // uses injectBusList + withdrawBusList participation weights
```

`dFactor` on each inject/withdraw bus is the contributing fraction of total injection or withdrawal. Reference numeric values for IEEE14 live in ipss-plugin `Ieee14_GSF_Test.gsfInjWithTest` (e.g. Bus2 inject / Bus14(0.9)+Bus13(0.1) withdraw on `Bus9->Bus14(1)` ≈ 0.569027).

### Script file (`.gvy`)

```
FileUtil.readFileAsString("wspace/script/ieee14_adjBus14.gvy")
       │
       ▼
evaluate(groovyCode)   // same Binding / shell as inline
       │
       ▼
AclfNetwork updated in place
```

File loading is **outside** the processor (`FileUtil`, `GvyScriptRunner`, or equivalent). The processor only evaluates strings. That keeps I/O optional and testable.

## Binding Contract (ACLF)

| Binding name | Java type                                          | Meaning                                                  |
| ------------ | -------------------------------------------------- | -------------------------------------------------------- |
| `aclfnet`    | `com.interpss.core.aclf.AclfNetwork`               | Live ACLF network under study                            |
| `senAlgo`    | `com.interpss.core.algo.dclf.SenAnalysisAlgorithm` | DC sensitivity / GSF / PTDF–LODF API on the same network |

Scripts may introduce local variables (`bus`, `load`, `branch`, `dVdQ`, `gsf`, `f`, …). Those live in the Groovy script scope for that evaluation; they are not required binding entries.

### Groovy ↔ Java property mapping

Groovy property assignment uses JavaBean conventions on InterPSS objects, for example:

| Script                                                              | Effect                                         |
| ------------------------------------------------------------------- | ---------------------------------------------- |
| `aclfnet.id = 'Modified'`                                           | `net.setId("Modified")`                        |
| `bus.loadP = 0.18`                                                  | `bus.setLoadP(0.18)`                           |
| `load.loadCP = new Complex(p, q)`                                   | `load.setLoadCP(...)`                          |
| `branch.z = new Complex(r, x)`                                      | `branch.setZ(...)`                             |
| `branch.status = false`                                             | deactivates branch (`isActive()` → false)      |
| `senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, injId, busId)` | dV(bus)/dQ(inj)                                |
| `senAlgo.calGenShiftFactor(injBusId, branch)`                       | GSF: inject@bus vs ref on monitor branch       |
| `senAlgo.addInjectBus(bus, dFactor)` / `addWithdrawBus(...)`        | Populate participation lists for transfers     |
| `senAlgo.injectBusList.clear()` / `withdrawBusList.clear()`         | Reset lists before a new transfer scenario     |
| `senAlgo.genTransferDistFactor(branch)`                             | Weighted gen-transfer factor on monitor branch |
| `senAlgo.getDclfAlgoBranch(branchId)`                               | DCLF branch wrapper for outage construction    |
| `DclfAlgoObjectFactory.createCaOutageBranch(dclfBranch, type)`      | Build outage object (`ContingencyBranchOutageType.OPEN`) |
| `senAlgo.lineOutageDFactor(outage, monitorBranch)`                  | LODF of outage on monitor branch               |

Method calls (`getBus`, `getBranch`, `getContributeLoad`, `calBusSensitivity`, `calGenShiftFactor`, `addInjectBus`, `addWithdrawBus`, `genTransferDistFactor`, `getDclfAlgoBranch`, `lineOutageDFactor`) and factory helpers (`DclfAlgoObjectFactory.createCaOutageBranch`) are ordinary Java API calls from Groovy.

## Usage Patterns

### 1. Construct and evaluate (from tests)

```java
AclfNetwork net = IeeeFileAdapter.createAclfNet(
    AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());

AclfNetDshGvyScriptProcessor gvyProcessor = new AclfNetDshGvyScriptProcessor(net);

Object result = gvyProcessor.evaluate("aclfnet.id = 'Modified';");
// net.getId() == "Modified"
```

`IEEE14_CASE` resolves to the classpath fixture `cases/ieee14/ieee14.ieee` under `src/test/resources/`.

### 2. Multi-statement script (text block)

```java
String groovyCode = """
    bus = aclfnet.getBus('Bus14');
    load = bus.getContributeLoad('Bus14-L1');
    load.loadCP = new Complex(0.18, 0.07);
    """;
gvyProcessor.evaluate(groovyCode);
```

### 3. Bus dV/dQ sensitivity via `senAlgo`

```java
String groovyCode = """
    dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, 'Bus14', 'Bus13')
    return 'dV(Bus13)/dQ(Bus14): ' + dVdQ
    """;
Object result = gvyProcessor.evaluate(groovyCode);
```

`SenAnalysisType` is available from `GVY_IMPORTS`; `senAlgo` comes from the processor binding. See also core usage guide `SenAnalysisAlgorithm_usage_guide.md` (`PANGLE` / `QVOLTAGE`, PTDF, LODF).

### 4. Generation shift factor (GSF) via `senAlgo`

```java
String groovyCode = """
    branch = aclfnet.getBranch('Bus5->Bus6(1)')
    gsf = senAlgo.calGenShiftFactor('Bus8', branch)
    return 'Bus8 - Bus5->Bus6(1) GSF: ' + gsf
    """;
Object result = gvyProcessor.evaluate(groovyCode);
```

Resolve the monitor branch from `aclfnet`, then call `calGenShiftFactor(injectBusId, branch)`. Withdraw is the network reference/slack bus. Fixture `wspace/script/ieee14_calGSF.gvy` asserts Bus8 on `Bus5->Bus6(1)` ≈ −0.2181389; interface-sum checks live in ipss-plugin `Ieee14_GSF_Test.gsfInjOnlyTest` (Bus8 on `Bus5->Bus6(1)` / `Bus4->Bus7(1)` / `Bus4->Bus9(1)` sum to −1.0).

### 5. Weighted gen-transfer factor via inject/withdraw lists

```java
String groovyCode = """
    senAlgo.injectBusList.clear()
    senAlgo.addInjectBus(aclfnet.getBus('Bus2'), 1.0)
    senAlgo.withdrawBusList.clear()
    senAlgo.addWithdrawBus(aclfnet.getBus('Bus14'), 0.9)
    senAlgo.addWithdrawBus(aclfnet.getBus('Bus13'), 0.1)
    branch = aclfnet.getBranch('Bus9->Bus14(1)')
    f = senAlgo.genTransferDistFactor(branch)
    return 'genTransferDistFactor Bus9->Bus14(1): ' + f
    """;
Object result = gvyProcessor.evaluate(groovyCode);
```

Clear the lists first (they persist on the shared `senAlgo`), then set inject/withdraw buses with participation weights, then call `genTransferDistFactor(monitorBranch)`. Fixture `wspace/script/ieee14_calWGenTFacotr.gvy` asserts ≈ 0.57121 on IEEE14 (same scenario as `Ieee14_GSF_Test.gsfInjWithTest`).

### 6. Line outage distribution factor (LODF) via `senAlgo`

```java
String groovyCode = """
    outageBranch = senAlgo.getDclfAlgoBranch('Bus13->Bus14(1)')
    outageBranch = DclfAlgoObjectFactory.createCaOutageBranch(
        outageBranch, ContingencyBranchOutageType.OPEN)
    monitorBranch = aclfnet.getBranch('Bus9->Bus14(1)')
    lodf = senAlgo.lineOutageDFactor(outageBranch, monitorBranch)
    return lodf
    """;
Object result = gvyProcessor.evaluate(groovyCode);
```

`DclfAlgoObjectFactory` and `ContingencyBranchOutageType` come from `GVY_IMPORTS`. Fixture `wspace/script/ieee14_calLODF.gvy` asserts LODF ≈ 1.0 for outage `Bus13->Bus14(1)` on monitor `Bus9->Bus14(1)`.

### 7. External `.gvy` fixture

```java
String groovyCode = FileUtil.readFileAsString(
    AgentTestSupport.projectRootPath("wspace/script/ieee14_adjBranch1_2.gvy").toString());
gvyProcessor.evaluate(groovyCode);
```

Example fixture (`wspace/script/ieee14_adjBranch1_2.gvy`):

```groovy
fromBusId = "Bus1";
toBusId = "Bus2";
circuitId = "1";
r = 0.02;
x = 0.06;

branch = aclfnet.getBranch(fromBusId, toBusId, circuitId);
branch.status = false;
branch.z = new Complex(r, x);
```

`Complex`, `SenAnalysisType`, `DclfAlgoObjectFactory`, and `ContingencyBranchOutageType` are available because `BaseDshGvyScriptProcessor` prepends `GVY_IMPORTS`.

### 8. Consumers in this repository

`interpss_run_gvy` (DeepSeek Harness chat tool) exposes **both** entry points through one `script`
argument — or an **array** of them, applied in order on the same processor-held network (0.4.11+): a `.gvy` selector resolves to a file under the case folder's `scripts/`, anything carrying
whitespace or statement punctuation is evaluated as inline source. The Host routes them to
`GvyScriptRunner.runOnNet` (file) and `GvyScriptRunner.runSourceOnNet` (source), which share the same
`AclfNetDshGvyScriptProcessor` evaluation and before/after digest; `IpssAgentBridge.runGvy` /
`runGvySource` wrap the two JVM calls. `IpssCmd` still has no `gvy` subcommand, so the CLI/Codex path
runs a file through `GvyScriptRunner` directly (see the `ipss-case-script` skill's fallbacks).

## Evaluation Semantics

| Concern        | Behavior                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Mutation       | In-place on the bound network                                                                                                     |
| Sensitivity    | Bus dθ/dP, dV/dQ via `senAlgo.calBusSensitivity(...)`                                                                             |
| GSF / factors  | `calGenShiftFactor`; weighted `genTransferDistFactor` via inject/withdraw lists; PTDF / LODF                                      |
| Return value   | Last Groovy expression / explicit `return`; often unused for mutation scripts                                                     |
| Imports        | Always prefixed with `GVY_IMPORTS` (`Complex`, `SenAnalysisType`, …)                                                              |
| Shell lifetime | One `GroovyShell` per processor instance; reusable across multiple `evaluate` calls                                               |
| Isolation      | No sandbox; scripts have full access to the bound Java objects                                                                    |
| Errors         | Groovy compile/runtime exceptions propagate to the caller (e.g. `MissingPropertyException` if a type is not imported and not FQN) |

Reuse one processor for a sequence of scripts against the same network (as in `GvyScriptEvalTest`) so binding stays consistent.

## Test Coverage Map

| Test                                        | Verifies                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `GvyScriptEvalTest.bus14testCase`           | Inline: id, bus `loadP`, contribute `loadCP`, branch `z`                                                                                 |
| `GvyScriptEvalTest.bus14ScriptFileTestCase` | `.gvy` fixtures: Bus14 load CP; Branch 1–2 `z` + status off; Bus14→Bus13 dV/dQ; Bus8 GSF on `Bus5->Bus6(1)`; weighted gen-transfer; LODF |
| `GvyScriptRunnerTest`                       | Bridge-style runner: file eval, digest, contribute load / branch status fixtures                                                         |
| `Ieee14_GSF_Test` (ipss-plugin CA tests)    | Numeric GSF / gen-transfer factors for IEEE14 (Java API reference for scripted GSF / GTDF)                                               |

`bus14ScriptFileTestCase` expected scalars (IEEE14):

| Fixture                         | Asserts                                      | Expected   |
| ------------------------------- | -------------------------------------------- | ---------- |
| `ieee14_adjBus14.gvy`           | Bus14-L1 `loadCP`                            | 0.18+j0.07 |
| `ieee14_adjBranch1_2.gvy`       | Branch 1–2 `z` + inactive                    | 0.02+j0.06 |
| `ieee14_calDv_dQ.gvy`           | dV(Bus13)/dQ(Bus14)                          | ≈ 0.0608355 |
| `ieee14_calGSF.gvy`             | Bus8 GSF on `Bus5->Bus6(1)`                  | ≈ −0.2181389 |
| `ieee14_calWGenTFacotr.gvy`     | Bus2→Bus14(0.9)+Bus13(0.1) on `Bus9->Bus14(1)` | ≈ 0.57121 |
| `ieee14_calLODF.gvy`            | Outage `Bus13->Bus14(1)` on `Bus9->Bus14(1)` | ≈ 1.0      |

Fixtures live under `wspace/script/`. Sample case data: `src/test/resources/cases/ieee14/ieee14.ieee` (also `wspace/data/ieee/Ieee14Bus/ieee14.ieee`).

## Extension Guide

To add a processor for another network type:

1. Subclass `BaseDshGvyScriptProcessor`
2. Accept the target network in the constructor
3. `binding.setVariable("<name>", network)` — document the binding name as part of the public contract
4. Optionally bind related algorithms (as `senAlgo` is for ACLF)
5. `this.shell = new GroovyShell(binding)`
6. Optionally extend `GVY_IMPORTS` (or a subclass-specific import block) if scripts need more default types
7. Add tests mirroring `GvyScriptEvalTest` (inline + file)

Keep binding names stable and lowercase (e.g. `aclfnet`, `senAlgo`) so scripts remain portable across hosts (tests, CLI, desktop).

## Relationship to File Adapters

```
External case file
       │
       ▼
org.interpss.agent.input.IeeeFileAdapter  (import)  →  AclfNetwork
       │
       ▼
org.interpss.agent.script.gvy (adjust / query)  →  same AclfNetwork (+ senAlgo)
       │
       ▼
Loadflow / contingency / export
```

File adapters **create** the model; Groovy adapters **edit** and **query** it after load. They are complementary, not overlapping:

- `IeeeFileAdapter` / other input adapters — format parsing / builders
- `agent.script.gvy` — runtime scripting against the built model (mutations + sensitivity / GSF / gen-transfer / LODF)

## Design Constraints & Caveats

- **No transactional rollback** — a failed mid-script leave earlier mutations applied
- **Thread safety** — one processor / network per thread; `GroovyShell` and network are not synchronized
- **Security** — treat `.gvy` content like executable code; only run trusted scripts
- **Contribute vs aggregate model** — script examples for contribute loads assume `net.isContributeGenLoadModel()` (as in IEEE14 tests)
- **Property names** — prefer documented JavaBean names (`loadCP`, `z`, `status`); typos fail at Groovy runtime
- **Sensitivity semantics** — `QVOLTAGE` is dV/dQ; do not confuse with dQ/dV used in AC voltage-control adjustment (`LfAdjSensitivity`)
- **GSF vs gen-transfer** — `calGenShiftFactor(inject, branch)` withdraws at the ref bus; weighted multi-bus transfers use `genTransferDistFactor` after clearing and setting `injectBusList` / `withdrawBusList` (lists persist across `evaluate` calls)
- **LODF construction** — outage objects must be built with `DclfAlgoObjectFactory.createCaOutageBranch` from `senAlgo.getDclfAlgoBranch(...)`; monitor branch comes from `aclfnet.getBranch(...)`
- **Working directory** — relative case paths depend on cwd; prefer `AgentTestSupport` / absolute paths in tests and the bridge

## Source Index

| Path                                                                  | Role                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/main/java/.../agent/script/gvy/BaseDshGvyScriptProcessor.java`      | Shared evaluate + imports (`Complex`, `SenAnalysisType`, …) |
| `src/main/java/.../agent/script/gvy/AclfNetDshGvyScriptProcessor.java`   | ACLF binding (`aclfnet`, `senAlgo`)                         |
| `src/main/java/.../agent/runner/GvyScriptRunner.java`                 | File eval + digest for bridge/CLI                           |
| `src/test/java/.../agent/script/gvy/GvyScriptEvalTest.java`           | Unit coverage (inline + `wspace/script` fixtures)           |
| `src/test/java/.../agent/runner/GvyScriptRunnerTest.java`             | Runner / digest coverage                                    |
| `wspace/script/ieee14_adjBus14.gvy`                                   | Load adjustment fixture                                     |
| `wspace/script/ieee14_adjBranch1_2.gvy`                               | Branch z/status fixture                                     |
| `wspace/script/ieee14_calDv_dQ.gvy`                                   | Bus14→Bus13 dV/dQ fixture                                   |
| `wspace/script/ieee14_calGSF.gvy`                                     | Bus8 GSF on `Bus5->Bus6(1)` fixture                         |
| `wspace/script/ieee14_calWGenTFacotr.gvy`                             | Weighted gen-transfer on `Bus9->Bus14(1)` fixture           |
| `wspace/script/ieee14_calLODF.gvy`                                    | LODF outage `Bus13->Bus14(1)` → monitor `Bus9->Bus14(1)`    |
| `src/test/resources/cases/ieee14/ieee14.ieee`                         | IEEE14 CDF test case                                        |
