---
name: Add BPA Format
overview: On branch lib_update (ipss.plugin.core 1.4.2 / ipss.core.lib 1.4.0, ODM removed), replace the NetworkLoader BPA TODO with a thin BpaFileAdapter, CLI validation, tests, and format-list doc tweaks.
todos:
  - id: bpa-adapter
    content: Add BpaFileAdapter using IpssAdapter.FileFormat.BPA (same pattern as IeeeFileAdapter)
    status: completed
  - id: wire-loader-cli
    content: Replace NetworkLoader TODO with case \"bpa\"; allow bpa in CliArgs
    status: completed
  - id: tests-fixture
    content: Add ieee9 IEEE9.dat fixture + BpaFileAdapterTest / NetworkLoaderTest
    status: completed
  - id: docs
    content: Extend format lists in IpssCmd.md, Setup.md, architecture.md (post-1.4.x wording)
    status: completed
isProject: false
---

# Add BPA format to NetworkLoader

## Baseline (latest update)

Implement on branch **`lib_update`** after commit `af30a106` (*Update dependencies and versioning for InterPSS*):

- [`NetworkLoader`](../../src/main/java/org/interpss/agent/input/NetworkLoader.java) **now dispatches BPA** (`case "bpa" -> BpaFileAdapter…`). The plan baseline below is historical:

```java
// Was (pre-BPA):
case "psse" -> PsseFileAdapter.createAclfNet(filePath);
// TODO: add support for bpa format
default -> throw new IllegalArgumentException("Invalid format: " + format);
```

- Runtime already includes BPA: `lib/ipss_runnable.jar` = **ipss.plugin.core 1.4.2**, `ipss.core.lib` **1.4.0**. IEEE ODM JARs were removed; CDF / PSS/E / BPA parsers live under `org.interpss.fadapter` inside `ipss_runnable.jar`.
- **No new Maven dependencies** for BPA — only agent wiring.
- [`Setup.md`](../../Setup.md) / [`docs/architecture.md`](../architecture.md) were just rewritten for 1.4.x deps; format tables still say `ieee`, `psse` only — extend those lines carefully without undoing the dependency docs.

Plugin fixture layout (also recent): source file for the agent test is still

`ipss-plugin/ipss.test.plugin.core/testData/adpter/bpa/ieee9/IEEE9.dat`

## Context

InterPSS already parses BPA via `IpssAdapter.FileFormat.BPA` → `BPADirectParser` (covered by `BPASampleTestCases` in ipss-plugin). Agent only needs the same adapter + dispatch pattern as IEEE/PSS/E.

```mermaid
flowchart LR
  CLI["CliArgs format=bpa"] --> NL[NetworkLoader]
  NL --> Adapter[BpaFileAdapter]
  Adapter --> Ipss["IpssAdapter FileFormat.BPA"]
  Ipss --> Parser[BPADirectParser]
  Parser --> Net[AclfNetwork]
```

## Approach

Mirror [`IeeeFileAdapter`](../../src/main/java/org/interpss/agent/input/IeeeFileAdapter.java): one static `createAclfNet(path)` that calls `IpssAdapter.importAclfNet(path).setFormat(BPA).load().getImportedObj()`.

**Chosen scope:** Java agent path only (adapter + loader + CLI + tests + format lists in CLI docs). No VS Code / persistent-plugin format picker changes in this pass.

## Changes

1. **New** [`BpaFileAdapter.java`](../../src/main/java/org/interpss/agent/input/BpaFileAdapter.java) — same structure as `IeeeFileAdapter`, using `IpssAdapter.FileFormat.BPA`.

2. **Update** [`NetworkLoader.java`](../../src/main/java/org/interpss/agent/input/NetworkLoader.java):
   - Replace the TODO with `case "bpa" -> BpaFileAdapter.createAclfNet(filePath)`.
   - Javadoc: “IEEE, PSS/E, or BPA”.

3. **Update** [`CliArgs.java`](../../src/main/java/org/interpss/agent/cli/CliArgs.java) — accept `"bpa"` in `parseValidated` and usage text (`format: ieee | psse | bpa`).

4. **Tests**
   - Copy plugin `ieee9/IEEE9.dat` → `src/test/resources/cases/bpa/IEEE9.dat`.
   - Add `BPA9_CASE` in [`AgentTestSupport`](../../src/test/java/org/interpss/agent/support/AgentTestSupport.java).
   - Add `BpaFileAdapterTest` and a `NetworkLoader` dispatch test for `"bpa"` (expect 9 active buses).
   - Run against the refreshed `ipss_runnable.jar` / local m2 install from Setup.md if tests fail to resolve BPA classes.

5. **Docs (format lists only)** — add `bpa` where formats are enumerated:
   - [`IpssCmd.md`](../../IpssCmd.md)
   - [`Setup.md`](../../Setup.md) CLI table (`format`: `ieee`, `psse`, `bpa`) and, if present, the “parsers live in ipss_runnable” note so it mentions BPA alongside CDF/PSS/E
   - [`docs/architecture.md`](../architecture.md) supported-formats line + `IeeeFileAdapter` / `PsseFileAdapter` row to include `BpaFileAdapter`

## Out of scope

- VS Code InterPSS tab / `interpss-persistent` case picker (still ieee/psse only).
- Further dependency bumps beyond current `lib_update` baseline.
- BPA dynamic (`.swi`) / DStab loading.
- Other formats already in `IpssAdapter` (MATPOWER, PWD, etc.).
