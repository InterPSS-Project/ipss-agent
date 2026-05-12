# iPSS Agent

**[InterPSS Agentic Power System Simulation Agent](docs/The iPSS Agent - Redefining Power System Simulation through Agentic AI.pdf)** for AC load flow, DC-based contingency analysis, and NERC TPL-001-5 style reporting. This repository is configured for agent-driven power-system simulation in **OpenAI Codex Desktop**, **Claude Code CLI**, and **Gemini CLI** (skills and commands).

## Environment setup

Git check out or download this repository and follow the setup instructions below.

### OpenAI Codex Desktop (recommended)

1. Add the folder as a Codex project.
2. Run the setup below, then test with a sample case (for example, under `wspace/data/Texas2K`).

```text
Setup ipss.agent env
# Test the setup with a sample case directory
/ipss-sim <simu_case_directory> "<NERC Report Name>"
```

1. Add your data folder as a Codex project and use the agent to do the simulations.

### Claude/Gemini CLI setup

```text
/init  # optional
Setup ipss.agent env
Setup the skills and commands to run the workflow
```

## Run simulations and generate reports

After the setup, run power-system simulations through the agent.

### Skill-style simulation

Input file mode:

```text
/ipss-sim <simu_case_file> <contingency_file> <monitored_file> "<NERC Report Name>"
```

Input directory mode (auto-discovers `*.RAW` / `*.raw` / `*.ieee`, `*contingency*.json`, `*monitor*.json`):

```text
/ipss-sim <simu_case_directory> "<NERC Report Name>"
```

### Direct prompt simulation

```text
Run ACLF format psse <case_file>
Run CA format psse <case_file> <contingency_file> <monitor_file>
Gen NERC TPL report "<NERC Report Name>" <result_dir>
```

## Explore simulation results

Results are written to `<case_directory>/result dir`. You can inspect them with the LLM, for example:

```text
# Load flow
Find the lowest voltage bus
Find the highest loading branch
# Contingency analysis
Find the top N-1 loaded branches
```

## Reference


| Topic                            | Document                     |
| -------------------------------- | ---------------------------- |
| Layout, JARs, `config.json`, JVM | [Setup.md](Setup.md)         |
| `ipss_cmd.py` usage              | [IpssCmd.md](IpssCmd.md)     |
| Report generator                 | [GenReport.md](GenReport.md) |


