# Deck Guidance

## Audience

Design for utility planning engineers, ISO/RTO reliability staff, operating committees, executive sponsors, and compliance reviewers. The deck should feel sober, technical, and decision-ready.

## Narrative Pattern

Use this order unless the user asks for a different structure:

1. Title and study scope
2. Executive compliance verdict
3. System and study basis
4. P0 base-case voltage performance
5. P0 base-case thermal performance
6. Generator reactive power capability
7. P1 contingency performance
8. Top overloads and severe contingencies
9. Geographic/functional risk themes if inferable from bus/facility names
10. Mitigation priorities
11. Data quality and remaining TPL work
12. Appendix: detailed tables

For very small cases, merge related sections. For large cases, split P1 and mitigation into multiple slides.

## Slide Standards

- Use a restrained utility palette: navy, steel blue, graphite, white, amber, and red for severity.
- Avoid decorative gradients and marketing-style hero layouts.
- Use dense but readable layouts: titles, 1-2 key charts/tables, and a short implication line.
- Keep body text sparse. Replace paragraphs with metrics, callouts, and ranked tables.
- Use traffic-light status markers:
  - PASS: green
  - INCONCLUSIVE / data gap: amber
  - FAIL / NON-COMPLIANT: red
- Preserve units and thresholds: per-unit voltage, MW/MVA, Rate A, Rate B, percent loading.
- Do not overstate compliance beyond the report. If P2-P7 are not evaluated, say so plainly.

## Core Slides

### Executive Verdict

Show a compact scorecard:

- P0 voltage
- P0 thermal
- generator Q limits
- P1 thermal
- overall compliance

Add 2-3 bullets on the main failure drivers and the planning implication.

### System Basis

Show:

- active buses and branches
- generation and load
- number of generators and loads
- contingencies evaluated
- monitored branches
- load flow convergence status

### Voltage

Show:

- minimum and maximum voltage
- count and percent below 0.95 pu
- count and percent above 1.05 pu
- marginal range count if available
- top voltage violations

Use a bar or banded distribution when counts by voltage band are present.

### Thermal

Separate base-case thermal from post-contingency thermal. For each, show:

- overload count
- severe overload count
- highest loading percent
- top 5-10 facilities

### Generator Q Limits

Show:

- total generators
- number and percent at limit
- Qmin versus Qmax count when available
- violations count
- implication for voltage support

### P1 Contingency

Show:

- contingencies evaluated
- monitored conditions or branches
- post-contingency overload count
- severe overload count
- top outage/monitored branch pairs

Make clear that report rows may be violation records, while unique contingency counts may be smaller.

### Mitigation

Translate findings into planning actions:

- voltage support: shunts, SVC/STATCOM, generator setpoints, transformer taps
- thermal: line uprates, reconfiguration, redispatch, reconductoring, new transmission
- reactive capability: generator Q capability review and voltage schedule tuning
- study next steps: P2/P3/P4/P5/P6/P7, dynamic stability, short-circuit, remedial action schemes

## Tables

Use only the top rows in the main deck:

- top 10 voltage violations
- top 10 base-case overloads
- top 10 P1 overloads
- top 10 generators by Q violation severity if useful

Move long lists to appendix or omit if they are already in the Markdown report.

## Tone

Use precise reliability language:

- "non-compliant under the report criteria"
- "requires mitigation or additional study"
- "not evaluated in this study scope"
- "thermal compliance is inconclusive because ratings are missing"

Avoid casual phrasing and avoid pretending the report proves more than it does.
