# Delivery plan

Each checkpoint must run with real authentication and database state before continuing. All checks are recorded in STATUS.md and artifacts/.

1. Audit original OOXML values, hyperlink formulas, drawings and source coverage. Extract immutable JSON and on-demand images. Inspect representative images and reconcile totals.
2. Verify primary documentation and versions/licenses. Fix shared types and SQL relationships. Set up strict TypeScript, Next, Prisma/Postgres, Better Auth and reproducible commands.
3. Checkpoint A: import all source rows and mappings idempotently; seed isolated demo accounts; implement lessons, direction cards, FSRS and mistake queues. Verify login → select → answer wrong → practice → logout/login → retained history.
4. Checkpoint B: personal decks with entries/phrases/sentences, actual local Tesseract OCR with editing and explicit save, representative traceable annotations, source images. Verify own content and an actual OCR sample.
5. Checkpoint C: account-isolated Dexie caches/outbox, explicit lesson downloads, deterministic transactional synchronization/conflict states, administrator revisions and access tests.
6. Run lint/type/domain/database/browser/build gates, mobile screenshots (360/390/430), offline 10-event test, source coverage checks and isolated rex-cli demo smoke. Write accurate handoff and remaining full-product milestones.

Follow-on product milestones: complete detailed annotation enrichment/review across all applicable fields; advanced grammar/listening/spelling exercises; additional content/provider infrastructure only when needed; real device acceptance and production deployment separately scoped.

## Delivered gates (2026-10-24)

| Gate | Observable result | Repeatable check | Status |
| --- | --- | --- | --- |
| A | All source rows/images, real accounts, two direction cards, wrong-answer persistence | `pnpm verify:import`; checkpoint-a and compatibility E2E | Passed |
| B | Own decks, 3 content kinds, actual OCR confirmation and source details | checkpoint-b E2E; Python content tests | Passed |
| C | 10 exact offline events, account boundaries, audited admin revisions | checkpoint-c E2E; PostgreSQL integration tests | Passed |
| Mobile / browser | 360/390/430, 44px, long text, dark/reduced motion, WebKit offline reload | compatibility E2E; 9 axe audits | Passed |
| Engineering / runtime | Strict lint/types/tests/build, safe reimport, repeatable setup, real rex-cli logins | `pnpm verify`; `pnpm smoke:demo`; Compose health | Passed |

The final combined browser suite passed 10/10. CI is configured but not run on GitHub. Detailed limits and evidence are in `docs/DELIVERY.md`; these gates do not claim full-corpus annotation review or physical-phone acceptance.

## Next milestone

Implement persistent enrichment jobs for one lesson, with provider/schema/prompt versions, per-field evidence, cancellation/retry, financial budget, cache and protected reviewed fields. A reviewer must be able to inspect, approve and revert a proposed field with an audit trail. Acceptance: rerun only failed jobs, cancel without losing completed results, never overwrite reviewed fields, and report source/draft/reviewed coverage separately. Expand to all books only after that lesson-level path passes. Current no-key learning and local OCR must remain functional.
