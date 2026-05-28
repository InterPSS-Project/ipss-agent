# InterPSS Agent — Setup Guide

This document describes how to set up and run the InterPSS Agent workspace for power system simulations using the native Java `IpssCmd` CLI.

## Project Overview

InterPSS is an open-source, Java-based power system simulation platform. This repository provides a fat-JAR command-line tool for AC load flow and DC contingency analysis, plus agent skills for reporting and exploration.

**Project layout** — roles at runtime:

| Role | Path | Purpose |
|------|------|---------|
| **Project root** | Repository top level | `config/`, `lib/`, `target/`, `wspace/` |
| **Working directory** | `wspace/` | Run `IpssCmd` here; case paths are relative to `wspace/` |

The tree below uses `ipss-agent/` as the **project root** (replace with your clone path).

```
ipss-agent/
├── .agents/
│   └── skills/
│       └── ipss-sim/          # OpenAI Codex Desktop project skill
├── .claude/
│   ├── commands/
│   │   └── ipss-sim.md        # Claude Code slash-command entry point
│   └── skills/
│       └── ipss-sim/          # Claude Code skill copy
├── config/
│   ├── aclf_run.json          # Default ACLF NR / limit-control settings
│   ├── gen_report.json        # Voltage / loading thresholds for reports
│   └── log4j2.xml             # Log4j2 configuration (optional JVM flag)
├── lib/
│   ├── ipss_runnable.jar      # InterPSS plugin / adapters
│   └── deps/                  # Third-party and core JARs
├── pom.xml                    # Builds ipss-agent-cmd shaded JAR
├── src/
│   ├── assembly/
│   │   └── uber.xml           # Fat JAR assembly descriptor
│   └── main/
│       └── java/
│           └── org/interpss/agent/
│               ├── IpssCmd.java
│               ├── ProjectPaths.java
│               ├── input/         # IEEE / PSS/E adapters
│               └── util/
└── wspace/                    # <-- cd here before running IpssCmd
    └── data/
        └── ieee/
            └── Ieee118Bus/
                └── ieee118.ieee
```

JAR file names and versions under `lib/deps/` follow [`pom.xml`](pom.xml) and `./mvnw dependency:copy-dependencies`. The listing above is illustrative.

### Simulation outputs

When you run `IpssCmd` from `wspace/`, CSV and text results are written under:

```text
wspace/<input_parent>/result/
```

For example, input `data/ieee/Ieee118Bus/ieee118.ieee` produces `ieee118_DF_bus.csv` and `ieee118_network_info.txt` in `wspace/data/ieee/Ieee118Bus/result/`.

Further CLI detail: [IpssCmd.md](IpssCmd.md). Report workflow: [GenReport.md](GenReport.md).

## Prerequisites

- **Java JDK 21** (or compatible version)
- **macOS / Linux / Windows**

Check your Java version:

```bash
java -version
```

## Step 1: JAR Dependencies

The InterPSS runtime requires JARs under `lib/` and `lib/deps/`.

### Recommended: Maven dependency copy

```bash
./mvnw -q dependency:copy-dependencies
```

Windows PowerShell:

```powershell
.\mvnw.cmd -q dependency:copy-dependencies
```

The wrapper downloads Maven on first use and copies runtime JARs into `lib/deps/`. Ensure `lib/ipss_runnable.jar` and the InterPSS core JARs listed in [.gitignore](.gitignore) are present (they are version-controlled in this repo).

### InterPSS core JARs (required)


| JAR | Purpose |
| --- | ------- |
| `ipss_runnable.jar` | Plugin core, adapters, DFrame exporters |
| `ipss.core.lib-1.0.16.jar` | ACLF engine, algorithms |
| `ieee.odm.schema-1.0.1.jar` | IEEE ODM schema |
| `ieee.odm_pss-1.0.1.jar` | IEEE ODM PSS types |

### Other dependencies

Sparse solvers (`JKLU`, `BTFJ`, `AMDJ`, `COLAMDJ`, `csparsej`), DataFrame export (`dflib`, `dflib-csv`), logging (`slf4j`), EMF, Hazelcast, JAXB, Gson, and related JARs are copied into `lib/deps/` by the Maven step above.

## Step 2: Build `IpssCmd`

From the project root:

```bash
./mvnw package
```

Produces:

```text
target/ipss-agent-cmd-1.0.0-shaded.jar
```

The shaded JAR unpacks `lib/ipss_runnable.jar` and all `lib/deps/*.jar` into one runnable artifact (~30 MB).

## Step 3: Configuration

### ACLF run configuration

`aclf_run.json` defines Newton–Raphson and related options. For ACLF, `IpssCmd` resolves the file with a **two-tier lookup**:

1. **Case-specific (preferred):** `<input_parent>/config/aclf_run.json` relative to `wspace/`.
2. **Project default (fallback):** `config/aclf_run.json` at the project root.

The tool prints `Using config file: <path>` to stdout. Edit either JSON to tune convergence or limit controls without recompiling.

### Report thresholds

`config/gen_report.json` supplies voltage bands and branch loading limits referenced when agents draft compliance reports. See [GenReport.md](GenReport.md).

### Logging (optional)

Pass Log4j2 configuration when launching:

```bash
java -Dlog4j.configurationFile=../config/log4j2.xml -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ...
```

## Step 4: Running simulations

Run from `wspace/` (paths relative to `wspace/`):

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf ieee data/ieee/Ieee118Bus/ieee118.ieee
```

### Command syntax

```
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar <simutype> <format> <input> [<cont_file> <monitor_file>]
```


| Argument | Values | Description |
| -------- | ------ | ----------- |
| `simutype` | `aclf`, `ca` | Load flow or contingency analysis |
| `format` | `ieee`, `psse` | Input file format |
| `input` | path | Case file (relative to `wspace/`) |
| `cont_file` | path | Contingency JSON (required for `ca`) |
| `monitor_file` | path | Monitored-branches JSON (required for `ca`) |

Windows PowerShell (same arguments):

```powershell
cd wspace
java -jar ..\target\ipss-agent-cmd-1.0.0-shaded.jar aclf ieee data\ieee\Ieee118Bus\ieee118.ieee
```

### Contingency analysis example

```bash
cd wspace
java -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar ca psse \
  data/psse/Texas2K/Texas2k_series24_case1_2016summerPeak_v36.RAW \
  data/psse/Texas2K/2k_contingencies_115kVAbove.json \
  data/psse/Texas2K/2k_monitored_branches.json
```

Large cases may need a higher heap:

```bash
java -Xmx8g -jar ../target/ipss-agent-cmd-1.0.0-shaded.jar aclf psse data/psse/Texas2K/...
```

## Step 5: Reports and downstream analysis

Simulation CSVs are consumed by agent skills and optional HTML/slide generators. See [GenReport.md](GenReport.md) for artifact names and the `ipss-sim` / `nerc-report-*` skill workflow. No separate simulation CLI is required beyond `IpssCmd`.

## Step 6: Verifying the `ipss-sim` agent skill

Agent skill files are included for Codex and Claude. Setup means completing Steps 1–2, then invoking the skill from a supported agent.

### OpenAI Codex Desktop

```text
.agents/skills/ipss-sim/SKILL.md
.agents/skills/ipss-sim/agents/openai.yaml
```

Example prompt:

```text
Use $ipss-sim to run data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

Directory mode:

```text
Use $ipss-sim to run data/psse/Texas2K "Texas 2K-Bus System"
```

The skill runs `IpssCmd` from `wspace/` for ACLF/CA, then produces reports per [GenReport.md](GenReport.md).

### Claude Code CLI

```text
.claude/skills/ipss-sim/SKILL.md
.claude/commands/ipss-sim.md
```

```text
/ipss-sim data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
```

### Version-control notes

- Commit `.agents/skills/ipss-sim/**`, `.claude/skills/ipss-sim/**`, and `.claude/commands/ipss-sim.md`.
- Do not commit `target/`, generated extra `lib/deps/*.jar` beyond tracked pins, `.mvn/wrapper/dists/`, or `wspace/**/result/`.
- After editing `.agents/skills/ipss-sim/SKILL.md`, sync to Claude with `./scripts/sync_ipss_skills.sh` if available.

## Troubleshooting


| Symptom | What to check |
| ------- | ------------- |
| `Could not find ipss-agent project root` | Run `IpssCmd` from `wspace/` or ensure `wspace/` and `config/` exist at the project root. |
| `Case file not found` | Paths are relative to `wspace/`, not the project root. |
| `NoClassDefFoundError` / missing InterPSS classes | Rebuild with `./mvnw package` after `lib/deps/` is populated. |
| NR load flow does not converge | Raise `maxIterations` in the resolved `aclf_run.json`. |
| `OutOfMemoryError` on large cases | Use `java -Xmx8g` (or higher) when launching the shaded JAR. |
| Report skill cannot find CSVs | Pass the `result` directory that contains `*_DF_bus.csv` (same folder `IpssCmd` wrote to). |
