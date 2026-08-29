# iPSS Agent

**[InterPSS Agentic Power System Simulation Agent](https://tinyurl.com/interpss)** for AC load flow, DC-based contingency analysis, and NERC TPL-001-5 style reporting. This repository ships agent-facing skills for **OpenAI Codex Desktop**, **Claude Code CLI**, and **DeepSeek Harness** (build and CLI details in [Setup.md](Setup.md); DSH plugin in [InstallDSHPlugin.md](InstallDSHPlugin.md)). The canonical skill is `[.agents/skills/ipss-sim/SKILL.md](.agents/skills/ipss-sim/SKILL.md)`; run `./scripts/sync_ipss_skills.sh` after edits to refresh `.claude/skills/ipss-sim/SKILL.md`.

It is also integrated into DeepSeek Harness as a DSH Plugin. You can run power system simulation in the traditional step-by-step way:

![ipss-dsh-plugin](./image/ipss-dsh-plugin.png)

Or in the native AI Chat way:

![ipss-agent-chat](./image/ipss-agent-chat.png)

## Environment setup

**Prerequisites:** Java JDK 21, Maven (or the included `mvnw` wrapper).

Prompt Codex, Claude Code, or DeepSeek Harness to clone and build **ipss-agent**:

```text
Install(Update) and setup ipss-agent from https://github.com/InterPSS-Project/ipss-agent
```

Depending on your network speed, it may take some time to download dependencies and build the CLI.

Build the Java CLI from the project root:

```bash
./mvnw -q clean package
```

This produces `target/ipss-agent-cmd-1.0.0-uber.jar`. See [Setup.md](Setup.md) for the full layout, tests, and configuration.

Test the setup with a sample case directory:

```text
init  # for the first time installation
/ipss-sim data/ieee/Ieee118Bus/ "IEEE 118-Bus Test Case"
```



#### DSH Plugin setup

See [InstallDSHPlugin.md](InstallDSHPlugin.md). Prompt DeepSeek Harness to install InterPSS DSH plugin:

```text
Install(update) InterPSS DSH plugin
```



## Run simulations and generate reports

After setup, run power-system simulations through the agent.

#### Skill-style simulation

Single-file mode (contingency and monitored JSON are optional; omit both for ACLF-only):

```text
/ipss-sim <input_path> [<contingency_json> <monitored_branches_json>] [in <format>] "<Report Name>"
```

Examples:

```text
/ipss-sim data/ieee/Ieee118Bus/ieee118.ieee "IEEE 118-Bus Test Case"
/ipss-sim data/psse/Texas2K/case.RAW data/psse/Texas2K/contingencies.json data/psse/Texas2K/monitored.json "Texas 2K-Bus System"
```

Directory mode (auto-discovers `*.RAW` / `*.raw` / `*.ieee`, `*contingency*.json`, `*monitor*.json`):

```text
/ipss-sim <simu_case_directory> "<NERC Report Name>"
/ipss-sim Aclf only <simu_case_directory> "<Loadflow Report Name>"
```

After a NERC Markdown report exists, generate follow-on artifacts:

```text
Use $nerc-report-html to generate an interactive HTML dashboard from <result_dir>
Use $nerc-report-slides to convert the NERC TPL report into a slide deck
```

Claude Code: use the prompts above, or the slash commands `/nerc-report-html` and `/nerc-report-slides`.

### Direct prompt simulation

Natural-language equivalents of the Java CLI (see [IpssCmd.md](IpssCmd.md)):

```text
Run aclf psse <case_file>
Run ca psse <case_file> <contingency_file> <monitor_file>
Generate NERC TPL report "<NERC Report Name>" for <result_dir>
```



## Explore simulation results

Results are written under `wspace/<input_parent>/result/` (relative to the project root: the folder that contains your case file, plus a `result` subfolder). You can inspect them with the LLM, for example:

```text
# Load flow
Find the lowest voltage bus
Find the highest loading branch
# Contingency analysis
Find the top N-1 loaded branches
```



## Reference


| Topic                             | Document                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| **Architecture**                  | [docs/architecture.md](docs/architecture.md)                                               |
| Layout, build, JARs, agent skills | [Setup.md](Setup.md)                                                                       |
| `IpssCmd` (Java CLI) usage        | [IpssCmd.md](IpssCmd.md)                                                                   |
| Markdown report generator         | [GenReport.md](GenReport.md)                                                               |
| DeepSeek Harness DSH plugin       | [InstallDSHPlugin.md](InstallDSHPlugin.md)                                                 |
| DSH plugin package                | [interpss-persistent/README.md](interpss-persistent/README.md)                             |
| Interactive HTML dashboards       | `[.agents/skills/nerc-report-html/SKILL.md](.agents/skills/nerc-report-html/SKILL.md)`     |
| NERC slide decks                  | `[.agents/skills/nerc-report-slides/SKILL.md](.agents/skills/nerc-report-slides/SKILL.md)` |


