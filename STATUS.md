# Current status

2026-10-24: User explicitly authorized full implementation of docs/DEVELOPMENT_PROMPT.txt by Codex. Earlier preparation-only stop is superseded. No Claude delegation.

## Delivered
- The requested first learning loop and development framework are complete. Final combined E2E run: 10/10 passed, no skipped/flaky cases (2026-10-24, 69.9 seconds).
- Actual running entry: http://localhost:4187 through the Mac SSH forward to rex-cli. App and PostgreSQL containers are healthy and bound only to loopback. Public deployment has not been performed.
- rex-cli isolated database, full source import, 50 annotations, real auth seed and local OCR assets initialized successfully.

## Checkpoints
- A: passed locally (2026-10-24): actual workbook import, 39 domain/database/config tests and real Chromium login/selection/wrong-answer/persistence/mobile-layout path. See `tests/e2e/checkpoint-a.spec.ts`, `artifacts/screenshots/A-*` and `docs/TESTING.md`. Fixed fast-answer outbox drain and post-login landing during acceptance.
- B: passed locally (2026-10-24): real Chromium personal collection CRUD/manual types/export/single-word recall and actual Tesseract fixture recognition (15 boxes, engine confidence 91%); edited/confirmed 4 OCR entries saved and learned. Source image authorized/anonymous access and Unicode searches passed. See `artifacts/ocr/browser/`.
- C: passed on production standalone (2026-10-24), 4/4 browser tests. Offline 10 events survive reload, sync exactly 10 and replay without duplication; account A/B cache/draft/deck isolation, conflict replay and admin revision+restoration passed. Nine axe audits (3 pages × 360/390/430) had zero violations. See `artifacts/checkpoint-c/`.

## Resume
Read AGENTS.md, PLANS.md, docs/DEVELOPMENT_PROMPT.txt, docs/CONTRACT.md and current Git changes. Do not initialize again or overwrite concurrent edits. Root owns package/lock/schema/API integration.

## Latest evidence
- Existing local PostgreSQL 14.18 reachable; server rex-cli has Docker 29.9.2, Python and Node 24.21.0.
- Verified/imported 4,835 source rows, 6 books, 69 lessons, 4,838 memberships, 108 images/104 referenced anchors. Current source import is complete; original six-book completeness is not established.
- 50 representative annotation drafts imported. None is represented as human-reviewed.
- Latest complete quality gate: `dev-run pnpm verify` passed lint, TypeScript, 64 TS/domain/PostgreSQL/security tests, 11 importer tests, 9 content tests and production build. Logs: `artifacts/verification/`.
- Final runtime includes separate local/remote cookie namespaces, Chinese authentication errors, a fully precached public shell and explicit offline readiness confirmation. Real demo/new/admin logins and ordinary-user admin rejection passed at `http://localhost:4187`.
- Supplemental tests passed both actual question directions, 3–7-question mistake spacing, 44px targets, long Cyrillic/Chinese, 200% text, and actual WebKit 27.2 offline refresh with 3 exact synced events. This is macOS browser emulation, not physical iOS/Android evidence.
- Final evidence index: `artifacts/verification/final-summary.json`, `artifacts/verification/e2e-final.json`, `artifacts/deployment/rex-cli-runtime.json`, `artifacts/deployment/smoke-4187.json`. Detailed handoff: `docs/DELIVERY.md`.

## Next / limitations
- Next milestone: persistent full-corpus enrichment jobs, field review and rollback; keep source/draft/reviewed states separate. Cloud provider remains unconfigured. Current 50 representatives do not establish complete annotations for 4,835 entries; human-reviewed field count remains zero.
- Complete advanced spelling/listening/grammar exercises, physical-device acceptance and separately authorized production deployment afterward.
- No external credential blocks the delivered learning/OCR/offline loop. CI configuration exists but has not run on GitHub; no GitHub push/public workbook publication was performed.
- Playwright now starts/reuses the local built server automatically; a remote PLAYWRIGHT_BASE_URL uses the caller-provided instance. A test-server shutdown caused one failed attempt before this lifecycle improvement; the final 10/10 report is the authoritative acceptance run.
