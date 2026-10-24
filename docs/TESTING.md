# Verification boundaries

All heavy commands use `dev-run`. The local PostgreSQL integration suite fails before importing database code unless `DATABASE_URL` is localhost/127.0.0.1 and names `ruslearn_dev`. It creates UUID-owned fixture users/items and deletes only those fixtures in a transaction. It never resets demo, new-user or existing learning records.

```sh
dev-run pnpm exec vitest run tests/domain tests/integration
dev-run pnpm exec tsc --noEmit --pretty false
dev-run pnpm exec eslint src scripts tests --no-warn-ignored
```

The domain suite verifies deterministic FSRS, explicit ratings, independent direction cards, balanced mixed rounds, conservative distractor exclusions, bounded practice, timezone/DST and account-scoped Dexie persistence. The PostgreSQL suite verifies ten-event replay, concurrent retry, immutable payloads, direction independence, client correctness overrides, conflict retention/resolution, scheduling boundaries and access control. Pure configuration tests cover production demo rejection, dedicated demo database naming and authentication secret validation.

Browser checkpoints are sequential acceptance gates. Run A, then B, then C only after the preceding gate passes. C requires the built standalone `pnpm start` runtime, default `http://localhost:4186`; immutable production assets are necessary for meaningful service-worker reload verification. Playwright starts/reuses that local runtime automatically. When `PLAYWRIGHT_BASE_URL` is supplied, it uses the explicitly provided instance without managing it. A development server is unsuitable evidence for offline shell acceptance.

```sh
dev-run pnpm exec playwright test tests/e2e/checkpoint-c.spec.ts
```

Checkpoint C prepares these independently observable assertions:

- A unique real UI signup downloads two lessons, answers ten questions offline, reloads with unsaved feedback preserved, then syncs exactly ten events. A second offline round cannot exceed the pending daily new-item budget. An identical HTTP replay leaves the server count unchanged.
- The same browser signs out of A and signs up B. B has no A decks/downloads/drafts and cannot start A's downloaded range offline; A's private draft remains stored under A's key.
- Stale-state and future-clock events remain in server conflicts across reload; unauthenticated and wrong-account mutation guards apply. Keeping as practice and discarding are idempotent and do not advance FSRS.
- Normal and anonymous accounts cannot use administration. The locally documented administrator makes a real versioned teaching-note revision; direct read-only database checks confirm immutable source JSON and actor/before/after audit. A second revision restores the original teaching notes and preserves both audit records. Passwords stay in process and are not included in Playwright tracing or artifacts.
- Dark theme and reduced-motion pages at 360, 390 and 430 pixels produce screenshots and axe results. No serious/critical accessibility violation is accepted; full results remain reviewable.

C artifacts live in ignored `artifacts/checkpoint-c/`. Unique QA accounts remain identifiable by the `checkpoint-c-` email prefix as acceptance evidence; tests never delete arbitrary accounts by prefix. Admin audit history is retained even after restoring teaching text. Do not commit the private workbook, screenshots containing workbook content, OCR originals, database credentials, or local access records.

Prepared tests are not proof of a completed checkpoint. Current run outcomes belong in root `STATUS.md` and artifact reports, and must only be recorded after the commands actually complete.

Final delivery evidence (2026-10-24): lint/type/build passed, 64 TypeScript/domain/database/security tests, 11 Python importer tests and 9 content tests passed. The final combined browser suite passed 10/10 in 69.9 seconds. Nine axe scans had no violations. Real WebKit 27.2 and Chromium 156.0.8078.4 engines ran on macOS with mobile viewport/device parameters; no physical-phone claim is made. See `artifacts/verification/final-summary.json` for exact performance samples, OCR evidence and deployment checks.

The WebKit run caught initial CSS/JS missing from the worker cache, despite Chromium's HTTP cache making the earlier path appear usable. The v2 worker now precaches only public shell static references, and the download success message requires the controlling worker to confirm readiness. The final WebKit test asserts CSS/JS are present and API/OCR paths are absent before disconnecting.
