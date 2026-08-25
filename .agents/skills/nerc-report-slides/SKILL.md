---
name: nerc-report-slides
description: Convert InterPSS NERC TPL-001-5 Markdown compliance reports into professional PowerPoint slide decks for electric utilities, ISOs/RTOs, transmission planners, reliability committees, and executive review. Use when Codex is asked to turn NERC_TPL_001_5_Report.md or a similar TPL/compliance Markdown report into slides, board-ready reporting, executive summaries, reliability assessment decks, mitigation planning decks, or ISO/utility presentations.
---

# NERC Report Slides

Convert a generated `NERC_TPL_001_5_Report.md` into a professional utility/ISO slide deck. Use the `presentations:Presentations` skill for PPTX creation, rendering, and visual QA.

This skill is a reporting runbook, not only a design guide: extract the compliance findings, build editable slides with artifact-tool modules, render previews, check layouts, iterate, and save the finished `.pptx` beside the source report.

## Inputs

Accept any of these:

- A path to `NERC_TPL_001_5_Report.md`.
- A result directory containing `NERC_TPL_001_5_Report.md` and InterPSS CSV outputs.
- Pasted Markdown report content.

If the user gives a result directory, use the report file in that directory. Use nearby CSVs only when the Markdown lacks enough data for a chart or table.

## Workflow

1. Read `references/deck-guidance.md` before designing the deck.
2. Read the Markdown report and identify:
   - system name, base MVA, report date, source directory
   - P0 status and top P0 drivers
   - voltage violations and voltage extremes
   - base-case thermal status
   - generator reactive power limit findings
   - P1 contingency results
   - severe overloads and mitigation themes
   - data quality gaps and remaining TPL work
3. Check nearby CSV outputs when the Markdown is missing ranked rows or when a top-10 table would make the deck more useful. Useful companion files often include voltage violation, branch loading, generator Q-limit, and contingency overload CSVs.
4. Build a concise executive narrative before making slides:
   - overall compliance status
   - why the case failed or passed
   - highest-risk facilities or regions
   - what decisions the audience needs to make
5. Use the Presentations skill to create a polished PPTX deck.
6. Render and inspect the deck. Fix crowding, tiny tables, awkward page breaks, and weak slide titles before delivery.

## Presentation Build Pattern

Prefer the artifact-tool module workflow from the Presentations skill:

1. Create a task workspace under `outputs/<thread-or-task>/presentations/<case-slug>/`.
2. Put one ESM slide module per slide in `slides/`, plus shared helpers in `slides/common.mjs`.
3. Build with `build_artifact_deck.mjs`, requiring the expected slide count and writing previews plus layout JSON.
4. Run `check_layout_quality.mjs --layout <layout-dir> --warn-only`.
5. Inspect representative preview PNGs, especially dense tables and executive scorecards.
6. Copy the final PPTX beside the source report.

Use this command shape, adjusting paths:

```bash
node <presentations-skill>/scripts/build_artifact_deck.mjs \
  --workspace outputs/<task>/presentations/<case-slug> \
  --slides-dir outputs/<task>/presentations/<case-slug>/slides \
  --out outputs/<task>/presentations/<case-slug>/<case-slug>_NERC_TPL_001_5_Report_Slides.pptx \
  --preview-dir outputs/<task>/presentations/<case-slug>/preview \
  --layout-dir outputs/<task>/presentations/<case-slug>/layout/final \
  --slide-count <n>
```

If `--contact-sheet` fails because `python3` lacks Pillow (`ModuleNotFoundError: No module named 'PIL'`), rebuild without `--contact-sheet`. The individual previews and layout JSON are sufficient for QA.

## Deck Requirements

- Create a decision-ready technical deck, not a raw Markdown dump.
- Prefer 8-14 slides for normal reports; allow 15-20 for large EI-scale reports.
- Use message titles that state findings, not labels such as "Voltage Results".
- Use charts, ranked tables, and heat-map-like summaries where possible.
- Keep detailed violation lists in appendix slides; surface only top risks in the main story.
- Include a clear final action slide: mitigation priorities, additional studies, and data needs.
- Use editable PowerPoint text, shapes, bars, and tables wherever practical rather than static screenshots.
- For utility/ISO audiences, favor restrained navy/steel/graphite styling with amber/red severity markers. Avoid decorative hero pages, gradients, and marketing copy.
- Do not claim full TPL compliance if P2-P7 categories were not evaluated. Call the scope gap out directly.
- When report sections disagree on counts, prefer the executive summary for headline scorecards and mention detailed active-network counts only when helpful.

## Recommended Slide Spine

Use this 12-slide structure unless the report or user request calls for a different cut:

1. Title and study scope.
2. Executive verdict and compliance scorecard.
3. System and study basis.
4. P0 voltage distribution and extremes.
5. Top low/high voltage buses if violations exist.
6. P0 base-case thermal status.
7. Generator reactive capability and Q-limit findings.
8. P1 contingency thermal summary.
9. Top P1 overloads or severe contingency pairs.
10. Common-mode or remaining TPL exposure if inferable.
11. Mitigation priorities.
12. Data quality, limitations, and next steps.

For passing or very small cases, merge slides 4-5, 6-9, and 10-12. For EI-scale reports, split P1 overloads, voltage pockets, and mitigation into more slides.

## Data Extraction Heuristics

- Voltage: capture min/max voltage, counts below 0.95 pu, marginal low bands, high voltage counts, and top violating buses.
- Thermal: separate P0/base-case overloads from P1/post-contingency overloads; preserve Rate A/Rate B and percent loading language.
- Generator Q: capture total generators, generators with Q limits, count at Qmin/Qmax, violations, and percent at limits.
- Contingency: distinguish imported contingencies, unique contingencies evaluated, monitored branches/conditions, overload records, and severe overloads.
- Data quality: include rating completeness, setpoint availability, generator Q-limit availability, transformer taps, load records, and categories not evaluated.
- Mitigation: translate findings into planning actions such as voltage support, tap/setpoint review, shunt/SVC/STATCOM needs, line uprates, redispatch, topology correction, additional TPL screening, and model validation.

## Output

Save the deck beside the source report unless the user requests another location.

Use a filename like:

```text
<case_slug>_NERC_TPL_001_5_Report_Slides.pptx
```

For result paths like `wspace/data/psse/<CaseName>/result/NERC_TPL_001_5_Report.md`, use `<CaseName>` as the case slug when possible.

Also provide a short summary of:

- output path
- slide count
- headline compliance status
- most important findings
- any unresolved data gaps or limitations

## QA Checklist

Before final response:

- PPTX exists at the requested or default output path.
- Preview PNGs were rendered for every slide.
- `check_layout_quality.mjs` reports zero errors, or any remaining errors are fixed before delivery.
- Visual spot-check includes the executive verdict, densest table, and final action/next-step slide.
- Final response mentions any tooling fallback, such as skipped contact-sheet generation due to missing Pillow.
