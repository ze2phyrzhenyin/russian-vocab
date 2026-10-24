# Learning domain and offline storage

Implemented files: `src/domain/learning.ts`, `src/domain/search.ts`, `src/lib/offline.ts`. Shared serialized types live in `src/domain/types.ts`.

## Research and dependency boundary

Verified 2026-10-24 against the npm published `ts-fsrs@5.4.2` (MIT, Node >=20) and its tag commit `bb71e35a2f5af5a5ac6cce9ef7c41ad24855721d`. Inspected `packages/fsrs/src/models.ts`, `fsrs.ts`, `__tests__/FSRS-6.test.ts` and `__tests__/fixed/prevent-skipping.test.ts`. The repository main branch already documents a different v6 API requiring Node >=24; we do not use main documentation as the installed v5 API contract. This scheduler runs in JS without the separate optimizer/WASM package.

Primary references:
- https://github.com/open-spaced-repetition/ts-fsrs/tree/v5.4.2
- https://open-spaced-repetition.github.io/ts-fsrs/
- https://registry.npmjs.org/ts-fsrs/5.4.2
- https://dexie.org/docs/Dexie/Dexie.transaction()

No upstream application code is copied. We import the scheduling dependency and use its public `fsrs`, `createEmptyCard` and `Rating` APIs. FSRS weights, retention, steps and fuzz settings are explicit constants and saved with version strings on every review event. Fuzz is off to make replay deterministic. Package version and algorithm version are distinct.

## Cards and questions

`cardId(itemId, direction)` produces independent `ru-zh`, `zh-ru` and `recall` identities. Different source rows remain different items; a shared many-to-many lesson membership does not duplicate an item's memory state.

`buildQuestions(items, direction, {limit, seed, shuffle, states, now})` returns serializable questions. Directions may be `ru-zh`, `zh-ru`, `recall` or `mixed`. `limit` counts presented cards, not unique source entries. Mixed mode divides the requested limit between forward/reverse directions, so a large deck does not fill the entire round with forward cards. Siblings are separated. For one or two items it uses a single direction and self-recall. An already scheduled card shown before its due time is marked `initialPractice`. Missing or disputed meanings are excluded from meaning questions. A generic aspect/source warning does not exclude an otherwise reliable Chinese meaning.

Choices use existing meanings/wordings, never generated fake Russian. Exclusions cover same item, exact answer, shared Chinese meaning atom, contained meaning, known common synonymous Chinese wording, shared Russian/aspect alternative, е/ё variant, missing/disputed meaning and multi-alternative distractors. Multi-meaning and paired targets fall back to recall. Fewer than two safe distractors also falls back. These rules are conservative lexical checks, not a claim that a complete synonym dictionary exists. New verified lexical relationships can extend the exclusions; genuinely ambiguous content must stay marked and use self-recall until reviewed.

Display the full original Russian/Chinese string and source context. Search normalization removes only explicit stress marks after NFC. It preserves ё and й. An е alias is an independent search helper and never rewrites identity. Mixed Latin/Cyrillic detection only suggests OCR review; it does not silently correct.

## Session queue and rating

`makeSession(questions, sessionId)` creates a durable serializable queue. `nextQuestion(session)` returns `{question,attempt,practice}`. `answerSession(session,{questionId,correct,rating,hinted,now})` returns the next immutable session and a stable answer attempt. A stale question id is rejected. The UI must persist via `offlineStore.commitAttempt` before switching to the next question; it should display feedback until the learner explicitly presses Continue.

Failure is always Again, never Hard. Hard means successful but difficult recall. Hints or guesses are conservatively Again; speed does not decide Easy. The learner may choose a rating explicitly. Retries appear after 3–7 other queued questions when possible, or after the available remainder. They are always practice, use shuffled existing options, and are capped at two retries. With no intervening different item, the failed item is retained in `hardItemIds` for a later session. Thus a single-word deck terminates without answer-revealing immediate repetition.

`applyRating(card|null,rating,now)` is for **formal** events only. It returns ISO-date JSON, rejects reversed history, and is deterministic. Practice attempts are still recorded for session correction statistics but never call the scheduler. A later, genuinely due review can be formal even if an earlier same-day correction was practice. Server-side checks must enforce this boundary independently of client flags.

`sessionSummary` separates total answers, formal events, practice, correct answers, corrected unique items and unresolved hard items. It never labels one choice as permanent mastery. `localDateKey` and `studyStreak` use an IANA user timezone, while stored timestamps are UTC. Calendar-day arithmetic is independent of daylight-saving day length.

Server daily totals include `stats.day` in the user's timezone. `dailyStatsFor` resets only `today` and `newToday` when a cached snapshot crosses local midnight, including 23/25-hour DST days. The UI checks this at action time and refreshes its displayed day on visibility/one-minute ticks; it does not write derived display totals back over the original server snapshot. Offline bootstrap performs the same rollover when reopening. Pending introductions are still counted by their actual day, so yesterday's unsynced events remain durable without consuming today's new-item allowance.

## Offline API

`offlineStore` uses Dexie IndexedDB with compound account keys. A successful server bootstrap must call `saveBootstrap`; only that account may read/write its data through the API. A seven-day offline grant permits previously authorized study. `deactivateAccount` revokes offline fallback immediately on logout, but retains all unacknowledged events and drafts until the same user authenticates again. An explicit server 401 must never be treated as a network outage. First login requires the server.

- `cacheSelection(userId,key,ItemsResponse)`, `getCachedSelection`, `listDownloads`, `removeDownload` manage explicitly downloaded content. Display the returned byte counts as JSON cache size, not a measure of browser storage overhead. Assets/audio are not included unless separately downloaded and accounted for.
- `primeStates(userId,states)` stores a scheduling baseline from an ordinary online list, without claiming the content is downloaded. `getStates(userId,itemIds)` returns the latest local schedules when resuming; `getResetCardIds` returns server-authoritative absent-state tombstones so stale session/download snapshots cannot recreate rejected provisional memory.
- `saveSession`, `loadSession`, `clearSession` preserve the current session.
- `saveDraft`, `getDraft<T>`, `deleteDraft` preserve private OCR/manual drafts.
- `nextIdentity(userId)` transactionally allocates a stable browser device id and increasing account sequence.
- `enqueueEvent` is idempotent for an identical id/payload; conflicting payload reuse is rejected.
- `commitAttempt(userId,session,event)` atomically writes session and outbox. A failed IndexedDB transaction must leave the UI on the unanswered question and show a save error.
- `getPendingEvents` excludes unresolved conflicts; `applySyncResult` removes only acknowledged ids, retains conflicts with reasons and updates server schedule states without wiping pending local predictions.
- `countPendingNewItems(userId,dayKey,timeZone)` counts distinct newly introduced items in the durable outbox. The daily allowance subtracts this from the latest server `newToday`; a bootstrap refresh after acknowledgement prevents the same introduction being lost or counted twice. Different direction cards share the same item introduction budget.
- `getCounts` and `getConflicts` support visible pending/conflict status. `clearAccount` refuses to clear unsynced data unless an explicit discard action supplies `true`.

Network work occurs outside IndexedDB transactions. Server receipt order and baseline versions remain authoritative; the client never sends a whole remembered state to overwrite history. A locally projected state is provisional until accepted by the server. Root server implementation owns atomic event deduplication, content/access checks, clock validation and conflict persistence.

The latest accepted incorrect answer or Again rating marks that direction card for correction while answer correctness remains a separate metric. An item is a mistake if any of its direction cards is marked; the item counter deduplicates those cards. Successful practice clears the practiced direction's flag without growing FSRS memory; it does not silently clear the opposite direction. List/download and sync responses derive flags from the same accepted-event order. A practice-only item with no memory card is visible in server history/mistake statistics but has no serialized FSRS state to carry an offline flag. The server conflict resolution operation preserves original payload/reason, accepts same-action retries, rejects changing a recorded decision, and never schedules a kept practice event.

Account scoping protects normal application account switches and data access paths. Like other browser storage, it is not isolation from a person controlling browser devtools or malicious same-origin script; authentication, CSP and XSS prevention remain necessary. The service worker must not cache private API responses or original images in a shared cache.

## Tests

`tests/domain/learning.test.ts` covers normalization, deterministic FSRS, rating adaptation, independent card ids, due boundaries, safe choices, meaningful aspect-warning handling, one-item fallback, bounded retries, correction/formal separation, duplicate submission rejection, timezone midnight and DST.

`tests/domain/offline.test.ts` uses actual Dexie with fake-indexeddb to check ten offline records, repeat acknowledgement, retained conflicts, transaction rollback, cross-account isolation, logout retention, concurrent sequences and provisional schedule reconciliation. These are storage/logic tests, not substitutes for real browser offline and mobile acceptance.
