---
name: russian-content
description: Generate, inspect or revise traceable Russian annotations and field coverage for Slovo; use for morphology, aspect, grammar evidence or content quality work.
---

Read [content rules](../../../docs/RUSSIAN_CONTENT.md) and the applicable source row/image.

`dev-run .local/content-venv/bin/python scripts/build_annotations.py` generates the representative annotation file. `dev-run pnpm content:import` applies it without replacing reviewed fields. `dev-run pnpm content:report` reports database coverage. Test changes with `dev-run .local/content-venv/bin/python -m unittest discover -s tests/content -v`.

Separate workbook evidence, dictionary-derived candidates and model-authored explanations. Preserve unknown, disputed and not-applicable fields. Only an actual review event permits a reviewed label. Perfective person forms are future, not present; aspect pairs are not inferred from slash order or prefixes. Source images are evidence of the source, not proof the source is correct.

The current 50 examples do not certify the remaining 4,785 items. Report denominators and field-level provenance, not a single misleading completion percentage.
