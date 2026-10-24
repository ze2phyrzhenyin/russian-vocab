---
name: learning-engine
description: Modify or verify Slovo direction cards, FSRS scheduling, bounded mistake practice or transactional offline review events.
---

Read [learning contract](../../../docs/LEARNING_ENGINE.md), `src/domain/types.ts` and `src/server/reviews.ts`.

Keep pure scheduling and queue logic in `src/domain`; use the installed ts-fsrs version and named ratings. Wrong or forgotten maps to Again. Immediate retries are practice and must not repeatedly advance FSRS. The two language directions have independent card IDs but share the same learning item.

Run `dev-run pnpm exec vitest run tests/domain tests/integration`. Integration tests create their own fixtures in the dedicated development database; never substitute a production URL.

Check replay, double taps, stale base versions, unknown content/scheduler versions, clock skew, cross-account requests and explicit conflict resolution. Client predictions are replaced by acknowledged state, while unacknowledged or conflicted events stay in the account-specific outbox. For one-item collections or ambiguous alternatives, use recall instead of fabricated distractors.
