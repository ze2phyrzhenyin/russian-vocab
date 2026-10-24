# Current status

2026-10-24: Codex implementation, full-corpus annotation workflow, GitHub publication and public deployment explicitly authorized. User chose the zhaoyang.fr domain and requested a normal test account. No Claude delegation.

## Runtime and access

- Public: https://slovo.zhaoyang.fr
- Private GitHub: https://github.com/ze2phyrzhenyin/russian-vocab
- Canonical server: rex-cli:/home/adminlinux/Developer/russian-vocab; local workspace /Users/zephyrsui/Developer/russian-vocab.
- Independent production PostgreSQL `slovo` and `slovo-production` Compose; APP_ENV=production, DEMO_MODE=false. Fixed demo accounts are not created in production.
- Public test-account credentials are private `.local/production-test-access.md`; administrator handoff is `.local/rex-cli-production-admin-access.md` locally and `.local/production-admin-access.md` on rex-cli. Never commit these files.
- Local/SSH demo remains isolated at ports 4186/4187; it is not the public production database.

## Delivered content workflow

- 4,835 source rows / textbook learning items, 6 books, 69 lessons, 4,838 memberships, 108 images and 14,505 direction cards.
- All 4,835 entries have 32 field states. Actual source evidence, generated dictionary candidates, unknown, disputed and not-applicable remain distinct. 50 representative explanation drafts retained; no automatic human-review claims.
- 3,181 entries have declension candidates; 1,058 have non-disputed conjugation candidates. 35 original meanings are missing, 11 source entries have known issues; 4,795 remain eligible for meaning-choice practice.
- Source fields 17,073; generated fields 35,666; unknown 63,750; disputed 40; applicable fields 116,529. Reviewed fields remain 0 after QA restores the original snapshots.
- Persistent jobs snapshot per-item source and candidate hashes, carry provider/schema/version/zero-cost budget, run bounded atomic batches, survive interruption, support cancellation/resumption and failed-only retry. Reviewed/rejected fields are protected.
- Administrator workbench supports filters by book/lesson/part of speech/field/status, evidence inspection, explicit field approval/rejection and audited restoration of a selected historical snapshot. Source rows and learning history remain separate.
- Local job `27066cf3-3e55-4035-8086-ab78462c96cf` and production job `d9ad835f-6955-4193-bef4-c4f8e03eb9b2`: both completed 4,835/4,835, zero failures, zero cloud cost. Dataset hash `90c23282bc06ec36cc25b6c732a783eae92a28ad2c6b2001b4b1a7339ad1b229`.
- Generator repeat: 4,835 cache hits / zero regeneration, byte-identical outputs; Node/Python input/output hashes agree for every source row.

## Verification

- Original A/B/C learning, OCR, offline and permission loops remain part of the release regression.
- Workbench real browser acceptance: 2/2 passed, field approve/reject/history restoration, cancellation and resumption; source fingerprint unchanged, final reviewed-field count 0.
- Four workbench axe audits at 360/390/430 and dark mode: zero violations, 44px controls, no horizontal overflow. Real PostgreSQL tests cover concurrent source import and review, strict request replay, expired leases and stale-version rejection.
- Final engineering: 79 TS/PostgreSQL tests + 11 importer + 19 content tests, lint/types/build passed. Local browser regression 10/10 plus workbench 2/2 passed. Public B/OCR/export, C/10-event offline, and WebKit/3-event offline paths all passed; B was rerun after a real public-latency stale-export bug was fixed.
- Final engineering, local regression and public release results are indexed in docs/DELIVERY.md and private artifacts/verification plus artifacts/deployment/public.
- GitHub Actions was attempted but could not start because the account has a billing/spending restriction. Local/server checks provide the executed evidence; no CI pass is claimed.

## Remaining evidence and product extensions

- User explicitly says there is no connected phone. Android adb lists no devices; iOS device tooling is unavailable. Chromium/WebKit mobile emulation is not physical iOS/Android acceptance.
- All-entry candidate coverage is not complete knowledge or human review. Unknown fields still need reliable evidence and actual reviewer actions. No cloud AI provider is configured; cloud tasks fail clearly without external calls.
- Cross-source lexeme/sense reconciliation and advanced spelling/listening/grammar exercises remain separate extensions. The provided book 3 source is a 17-page extract; importing this workbook does not establish completeness of all original books.

Read AGENTS.md, docs/CONTENT_WORKFLOW.md, docs/CONTENT_WORKBENCH_QA.md and docs/DEPLOYMENT.md before resuming. Do not reinitialize existing databases, replace credentials or overwrite another administrator's reviewed content.
