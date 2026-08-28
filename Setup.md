# InterPSS Agent — Setup Guide

This document describes how to build and run the InterPSS simulation CLI and its
report generators for power system simulations.

## Project Overview

InterPSS is an open-source, Java-based power system simulation platform. This
workspace runs simulations through a native Java CLI (`IpssCmd`) and generates
Markdown reports through the same CLI (`IpssCmd report ...`). There is no JPype
bridge and no JVM-path configuration.

**Project layout** — the runtime is spread across a parent directory where
`wspace/` is the working directory for data and results, while `src/`, `lib/`,
and `config/` are shared infrastructure at the parent level. The tree below uses
`ipss-agent/` as the **project root** (this repository).

```
ipss-agent/
├── .agents/
│   └── skills/
│       ├── ipss-sim/              # OpenAI Codex Desktop — simulation skill
│       ├── nerc-report-html/      # Interactive HTML dashboard skill
│       └── nerc-report-slides/    # NERC TPL slide-deck skill
├── .claude/
│   ├── commands/
│   │   ├── ipss-sim.md            # Claude Code slash-command entry point
│   │   ├── nerc-report-html.md
│   │   └── nerc-report-slides.md
│   └── skills/
│       └── ipss-sim/              # Claude Code skill copy (synced from .agents)
├── interpss-persistent/           # DeepSeek Harness DSH plugin package
├── scripts/
│   └── sync_ipss_skills.sh        # Copy canonical ipss-sim skill to .claude/
├── pom.xml                        # Maven build for the Java CLI (Uber JAR)
├── config/
│   ├── aclf_run.json              # ACLF NR / limit-control settings (used by IpssCmd)
│   └── gen_report.json            # Report band thresholds (used by org.interpss.agent.report)
├── lib/
│   ├── ipss_runnable.jar          # Main InterPSS runnable JAR
│   └── deps/                      # Third-party JARs
│       ├── ipss.core.lib-1.0.16.jar
│       ├── ieee.odm.schema-1.0.1.jar
│       ├── ieee.odm_pss-1.0.1.jar
│       ├── slf4j-api-1.7.36.jar / slf4j-simple-1.7.36.jar
│       ├── org.eclipse.emf.common-2.45.0.jar / .ecore-2.38.0.jar
│       ├── hazelcast-5.3.6.jar
│       ├── jaxb-api-2.3.1.jar / jaxb-impl-2.3.1.jar
│       ├── javax.activation-api-1.2.0.jar
│       ├── commons-math3-3.6.1.jar
│       ├── JKLU-1.0.0.jar / BTFJ-1.0.1.jar / AMDJ-1.0.1.jar / COLAMDJ-1.0.1.jar
│       ├── csparsej-1.1.1.jar
│       ├── dflib-2.0.0-M6.jar / dflib-csv-2.0.0-M6.jar / dflib-json-2.0.0-M6.jar
│       ├── commons-csv-1.10.0.jar
│       └── gson-2.11.0.jar
├── src/
│   ├── main/java/org/interpss/agent/   # IpssCmd Java sources
│   │   ├── IpssCmd.java
│   │   ├── cli/ (CliArgs, ReportCliArgs)
│   │   ├── report/ (Markdown report generators)
│   │   ├── input/ (IeeeFileAdapter, PsseFileAdapter, NetworkLoader)
│   │   ├── runner/ (AclfRunner, ContingencyRunner)
│   │   └── util/ (IpssNetworkInfo, ProjectPaths)
├── target/
│   └── ipss-agent-cmd-1.0.0-uber.jar   # Built by `./mvnw clean package`
├── InstallDSHPlugin.md            # DeepSeek Harness plugin install guide
└── wspace/                             # <-- working directory
    ├── data/
    │   └── ieee/
    │       └── Ieee118Bus/
    │           └── ieee118.ieee        # IEEE 118-bus test case
```

JAR file names and versions under `lib/deps/` follow [`pom.xml`](pom.xml) and
whatever Maven resolves; the `lib/deps` fragment in the tree above is illustrative.

## Prerequisites

- **Java JDK 21** (or compatible version)
- **Maven** (the repo includes the `mvnw` wrapper, which downloads a pinned
  Maven distribution on first use)
- **macOS / Linux / Windows**

Check your Java version:

```bash
java -version
```

## Step 1: Build the CLI

From the **project root**, build the self-contained Uber JAR:

macOS / Linux:

```bash
./mvnw -q clean package
```

Windows PowerShell:

```powershell
.\mvnw.cmd -q clean package
```

This compiles `src/main/java` and assembles `target/ipss-agent-cmd-1.0.0-uber.jar`,
which bundles the InterPSS runtime, all dependency JARs, and the CLI classes. The
manifest declares `org.interpss.agent.IpssCmd` as the main class.

The compiled `target/` output and downloaded Maven distribution are local build
artifacts and are not committed.

## Step 1b: Run Tests

From the **project root**, run the JUnit 5 test suite and generate a JaCoCo coverage
report:

```bash
./mvnw test
open target/site/jacoco/index.html   # macOS — view coverage report
```

Windows PowerShell:

```powershell
.\mvnw.cmd test
Start-Process target/site/jacoco/index.html
```

Tests use self-contained fixtures under `src/test/resources/` (IEEE-14 CDF, IEEE-9
PSS/E RAW, minimal contingency JSON). JaCoCo reports coverage but does not enforce
a minimum threshold.

## Step 2: JAR Dependencies

The runtime dependency JARs are resolved by Maven during the build and bundled
into the Uber JAR. `lib/ipss_runnable.jar` and `lib/deps/*.jar` are the InterPSS
runtime and its third-party dependencies; the `pom.xml` pulls them from the local
`lib/m2-repo` (for the InterPSS/ODM artifacts) and Maven Central (for third-party
artifacts).

### InterPSS Core JARs

| JAR                           | Source         | Purpose                            |
| ----------------------------- | -------------- | ---------------------------------- |
| `ipss_runnable.jar`           | InterPSS build | Plugin core, adapters, samples     |
| `ipss.core.lib-1.0.16.jar`    | InterPSS build | ACLF engine, algorithms, EMF model |
| `ieee.odm.schema-1.0.1.jar`   | InterPSS build | IEEE ODM XML schema                |
| `ieee.odm_pss-1.0.1.jar`      | InterPSS build | IEEE ODM PSS types                 |

### Sparse Solver JARs

| JAR                  | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `JKLU-1.0.0.jar`     | KLU sparse LU solver                     |
| `BTFJ-1.0.1.jar`     | Block Triangular Form permutation        |
| `AMDJ-1.0.1.jar`     | Approximate Minimum Degree ordering      |
| `COLAMDJ-1.0.1.jar`  | Column AMD ordering                      |
| `csparsej-1.1.1.jar` | CSPARSEJ — CSparse sparse matrix library |

### DataFrame Export JARs (for CSV output)

| JAR                       | Maven Central Coordinates               | Purpose           |
| ------------------------- | --------------------------------------- | ----------------- |
| `dflib-2.0.0-M6.jar`      | `org.dflib:dflib:2.0.0-M6`              | DataFrame library |
| `dflib-csv-2.0.0-M6.jar`  | `org.dflib:dflib-csv:2.0.0-M6`          | CSV save support  |
| `dflib-json-2.0.0-M6.jar` | `org.dflib:dflib-json:2.0.0-M6`         | JSON support      |
| `commons-csv-1.10.0.jar`  | `org.apache.commons:commons-csv:1.10.0` | CSV parsing       |

### Third-Party Support JARs

| JAR                                                       | Purpose                    |
| --------------------------------------------------------- | -------------------------- |
| `slf4j-api-1.7.36.jar` / `slf4j-simple-1.7.36.jar`        | Logging                    |
| `org.eclipse.emf.common-2.45.0.jar` / `.ecore-2.38.0.jar` | Eclipse Modeling Framework |
| `hazelcast-5.3.6.jar`                                     | Distributed computing      |
| `jaxb-api-2.3.1.jar` / `jaxb-impl-2.3.1.jar`              | XML binding                |
| `javax.activation-api-1.2.0.jar`                          | Java Activation Framework  |
| `commons-math3-3.6.1.jar`                                 | Math utilities             |

## Step 3: ACLF run configuration

`aclf_run.json` defines Newton–Raphson and related options (`maxIterations`,
`tolerance`, `lfMethod`, PV/PQ limits, tap/shunt adjustments, and so on). For
ACLF, `IpssCmd` resolves the file with a **two-tier lookup**:

1. **Case-specific (preferred):** `<input_parent>/config/aclf_run.json` relative to `wspace/` (e.g. `data/psse/OpenEInterconnect/config/aclf_run.json` for input under that folder).
2. **Project default (fallback):** `config/aclf_run.json` at the project root.

The chosen path is loaded via `AclfRunConfigRec.loadAclfRunConfig` and applied
with `configAclfRun(algo, polarCoordinate, includeAdjustments, False)`. The CLI
prints `Using config file: <path>` to stderr so you can confirm which file ran.
Edit the JSON to tune convergence or solver behavior.

## Step 4: Running simulations

The CLI entry point is `IpssCmd`, packaged in the Uber JAR. Run it from the
`wspace/` directory (paths below are relative to `wspace/`):

macOS / Linux:

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
```

Windows PowerShell:

```powershell
cd wspace
java -jar ..\target\ipss-agent-cmd-1.0.0-uber.jar aclf ieee data\ieee\Ieee118Bus\ieee118.ieee
```

### Command Syntax

```
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar <simutype> <format> <input> [<cont_file> <monitor_file>]
```

| Argument   | Values         | Description                                        |
| ---------- | -------------- | -------------------------------------------------- |
| `simutype` | `aclf`, `ca`   | Simulation type: load flow or contingency analysis |
| `format`   | `ieee`, `psse` | Input file format                                  |
| `input`    | path           | Input file path (relative to `wspace/`)            |
| `cont_file` / `monitor_file` | path | Contingency / monitored-branches JSON (required for `ca`) |

Contingency analysis example:

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

See [IpssCmd.md](IpssCmd.md) for full usage.

## Step 5: Generating reports

Markdown reports are generated by the Java CLI `report` subcommand.

### NERC TPL-001-5 report

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc "Texas 2K-Bus System" data/psse/Texas2K/result
```

Writes `NERC_TPL_001_5_Report.md` into the same result directory.

### AC Load Flow report

```bash
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report aclf "IEEE 118-Bus Test Case" data/ieee/Ieee118Bus/result
```

Writes `AC_Loadflow_Report.md` into the same result directory.

Thresholds come from `config/gen_report.json`. See [GenReport.md](GenReport.md).

For system design, see [docs/architecture.md](docs/architecture.md).

## Step 6: Verifying the `ipss-sim` Agent Skill

This repository already includes agent-facing skill files so Codex and Claude can
run the full simulation workflow from a natural-language prompt. No copy step is
required when the repository is opened as a project; setup means verifying the
files are present and then invoking the skill from the supported agent.

### OpenAI Codex Desktop

The Codex project skill is stored at:

```text
.agents/skills/ipss-sim/SKILL.md
```

UI metadata for the skill is stored at:

```text
.agents/skills/ipss-sim/agents/openai.yaml
```

To use it:

1. Add or open this repository folder as a Codex Desktop project.
2. Make sure Step 1 (build) has been completed.
3. Verify the files below are present.
4. Invoke the skill by name in a prompt:

```text
Use $ipss-sim to run data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

For a directory that contains a case file plus contingency and monitored-branch JSON files:

```text
Use $ipss-sim to run data/psse/Texas2K "Texas 2K-Bus System"
```

Codex should load the project skill from `.agents/skills/ipss-sim/` and then run
the workflow from `wspace/`:

1. ACLF with `java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar aclf ...`
2. CA with `java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar ca ...` when contingency and monitored files are provided or auto-discovered
3. Report generation with `java -jar ../target/ipss-agent-cmd-1.0.0-uber.jar report nerc ...`

### Claude Code CLI

Claude skill and command registration files are stored at:

```text
.claude/skills/ipss-sim/SKILL.md
.claude/commands/ipss-sim.md
```

Use the slash-command form:

```text
/ipss-sim data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

or directory mode:

```text
/ipss-sim data/psse/Texas2K "Texas 2K-Bus System"
```

### Version-Control Notes

- `.agents/skills/ipss-sim/**`, `.claude/skills/ipss-sim/**`, and `.claude/commands/ipss-sim.md` should be committed.
- `.agents/skills/nerc-report-html/**`, `.agents/skills/nerc-report-slides/**`, and `.claude/commands/nerc-report-*.md` should be committed.
- `target/`, generated `lib/deps/*.jar`, `.mvn/wrapper/dists/`, and `wspace/**/result/` are local build or output artifacts and should remain uncommitted.
- If the skill instructions change, edit `.agents/skills/ipss-sim/SKILL.md` (canonical), then run `./scripts/sync_ipss_skills.sh` from the project root to copy it to `.claude/skills/ipss-sim/SKILL.md`. Set `SYNC_CODEX=1` to also refresh `~/.codex/skills/ipss-sim/SKILL.md` when that directory exists.

### DeepSeek Harness (DSH Plugin)

For the browser **InterPSS** tab in DeepSeek Harness, build the CLI (Step 1) and
follow [InstallDSHPlugin.md](InstallDSHPlugin.md). The plugin package lives in
`interpss-persistent/`; activation requires this workspace's `README.md` H1 to be
exactly `# iPSS Agent`.

Follow-on report artifacts use the Codex skills `$nerc-report-html` and
`$nerc-report-slides` (canonical files under `.agents/skills/`). Claude Code
slash commands `/nerc-report-html` and `/nerc-report-slides` point at the same
skills.

### Quick Verification

From the project root, these commands should show the registered skill files:

macOS / Linux:

```bash
find .agents/skills/ipss-sim .claude/skills/ipss-sim .claude/commands -maxdepth 2 -type f | sort
```

Windows PowerShell:

```powershell
Get-ChildItem .agents\skills\ipss-sim, .claude\skills\ipss-sim, .claude\commands -Recurse -File |
  ForEach-Object { Resolve-Path -Relative $_.FullName }
```

Expected entries include:

```text
.agents/skills/ipss-sim/SKILL.md
.agents/skills/ipss-sim/agents/openai.yaml
.claude/commands/ipss-sim.md
.claude/commands/nerc-report-html.md
.claude/commands/nerc-report-slides.md
.claude/skills/ipss-sim/SKILL.md
```
