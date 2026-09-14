Run an AC load flow (ACLF) for the current InterPSS simulation case — the case selected in the InterPSS tab — or for a named case, and report convergence.

Read and follow `.agents/skills/ipss-case-aclf/SKILL.md` (canonical). That skill defines the tool call, the case-resolution order, what the run writes, how to read convergence, the result explorer, the report-staleness caveat, and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-aclf
/ipss-case-aclf data/ieee/Ieee118Bus/ieee118.ieee
/ipss-case-aclf Texas 2K-bus
```
