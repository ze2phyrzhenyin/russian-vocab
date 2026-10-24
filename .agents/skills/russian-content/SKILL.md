---
name: russian-content
description: Generate, inspect or revise traceable Russian annotations and field coverage for Slovo; use for morphology, aspect, grammar evidence or content quality work.
---

Read [content rules](../../../docs/RUSSIAN_CONTENT.md) and the applicable source row/image.

`dev-run .local/content-venv/bin/python scripts/build_annotations.py` processes every source row and writes `data/processed/annotations.json` plus `annotations.manifest.json`. Each item has all 32 field states and per-item input/output/source-row fingerprints. The persistent content task must validate the snapshot against current SourceEntry.raw before publishing candidates and preserve independent reviewed/rejected decisions. `dev-run pnpm content:report` reports database coverage separately from local artifact coverage. Test changes with `dev-run .local/content-venv/bin/python -m unittest discover -s tests/content -v`.

Separate workbook evidence, dictionary-derived candidates and model-authored explanations. Preserve unknown, disputed and not-applicable fields. Only an actual review event permits a reviewed label. Perfective person forms are future, not present; aspect pairs are not inferred from slash order or prefixes. Source images are evidence of the source, not proof the source is correct.

All 4,835 current rows receive source/dictionary candidate processing; this does not certify every field or manufacture linguistic review. Preserve the original 50 representative drafts, explicit gaps, 35 missing meanings, and known disputes. Display ambiguity when dictionary candidates or source context do not establish a unique part of speech. Unknown words and missing examples/relations/pronunciation stay unknown. Report source/generated/unknown/disputed/not-applicable/reviewed denominators per book, lesson and POS; never equate field presence with knowledge completion.

Before a consumer runs a full job, verify all sourceRowFingerprint and outputFingerprint values with the Node consumer's canonical JSON implementation. Candidate scores are decimal strings to avoid cross-language float encoding differences. Re-run generation to prove cache hits and unchanged bytes; source or implementation changes must invalidate the appropriate cached item. Do not edit the source workbook or infer lexeme/sense identity from a shared spelling.
