---
name: vocab-import
description: Import or reconcile the private 东方俄语 workbook in Slovo, preserving source rows, formulas, image mappings and learner history.
---

Read [data rules](../../../docs/DATA_CONTRACT.md) before changing source mapping.
Input is `VOCAB_SOURCE_PATH` or `data/source/东方俄语词汇汇总_第1至6册.xlsx`.

Run `dev-run pnpm import:vocab -- --file <path>` from the project root. The extractor preserves the workbook bytes, all original columns, links and 108 drawings. A changed source-key identity produces a candidate and a reconciliation report; inspect it instead of bypassing the rejection. Do not split rows at slashes or merge by Russian text.

Inspect `artifacts/import/` and compare actual counts to the source file, not to hard-coded historical expectations. Then re-import the same file and confirm source/card counts and learner states are unchanged. Use `dev-run .local/content-venv/bin/python -m unittest discover -s tests/importer -v` for importer changes.

Keep original workbook, extracted text and images private and ignored by Git. Report source rows, joins, images, practice eligibility and unreviewed conflicts separately.
