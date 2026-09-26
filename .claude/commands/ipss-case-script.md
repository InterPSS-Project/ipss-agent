Run a Groovy scenario script — a `.gvy` file or inline source — against the current InterPSS simulation case — a what-if edit to loads, branch impedance or status, or network metadata — and report what it changed.

Read and follow `.agents/skills/ipss-case-script/SKILL.md` (canonical). That skill defines the tool call, where the script comes from (a `.gvy` file in the case folder's `scripts/` directory, or inline source), the `aclfnet` / `senAlgo` bindings, JavaBean property mapping, and the pre-imported sensitivity types, the before/after digest, the mutating semantics (`reload`, no rollback), how to solve the edited case, and fallbacks for agents without the tool.

**Examples:**

```
/ipss-case-script ieee14_adjBus14.gvy
/ipss-case-script data/ieee/Ieee14Bus/scripts/ieee14_adjBranch1_2.gvy
/ipss-case-script ieee14_adjBus14.gvy on IEEE 14-bus, reload first
/ipss-case-script set Bus14-L1 to 0.50 + j0.30 pu on IEEE 14-bus
```
