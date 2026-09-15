Produce a summary report for the current InterPSS simulation case — convergence, generation/load balance, voltage profile, branch loading and largest flows — or a ranked top-N view by scope.

Read and follow `.agents/skills/ipss-case-summary/SKILL.md` (canonical). That skill defines the tool calls per scope, the CSV columns to read for rating loading and the voltage distribution, the report layout, and the interpretation caveats.

**Examples:**

```
/ipss-case-summary
/ipss-case-summary lowest and highest voltage buses
/ipss-case-summary most loaded branches
```
