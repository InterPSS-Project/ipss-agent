Run a Groovy (.gvy) scenario script against the current InterPSS simulation case — a what-if edit to loads, branch impedance or status, or network metadata — and report what it changed.

Read and follow `.agents/skills/ipss-case-script/SKILL.md` (canonical). That skill defines the tool call, where the script file is resolved from (the case folder's `scripts/` directory), the `aclfnet` binding and JavaBean property mapping, the before/after digest, the mutating semantics (`reload`, no rollback), how to solve the edited case, and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-script ieee14_adjBus14.gvy
/ipss-case-script data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy
/ipss-case-script ieee14_adjBus14.gvy on IEEE 14-bus, reload first
```
