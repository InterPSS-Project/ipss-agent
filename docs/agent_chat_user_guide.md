# iPSS Agent Chat User Guide

The iPSS Agent supports natrual language chat that allows you to run power-system simulations and generate reports.

## Chat to run simulations and generate reports

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

