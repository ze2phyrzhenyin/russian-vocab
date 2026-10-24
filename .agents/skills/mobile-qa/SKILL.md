---
name: mobile-qa
description: Exercise Slovo's real mobile learning, personal deck, OCR and offline workflows and inspect screenshots at 360, 390 and 430 pixel widths.
---

Read [testing guide](../../../docs/TESTING.md) and run against the isolated demo defined in `.env`. Use `dev-run pnpm test:e2e` on Mac, `dev-browser-run pnpm test:e2e` on rex-cli. Source workbook and prepared OCR assets must already exist.

Inspect actual screenshot output as well as assertions. Cover wrong-answer feedback, manual continuation, resume, source detail, long Cyrillic, ё/й, safe area, dark mode and reduced motion. Use the self-authored `tests/fixtures/ru-zh-sample.png` for real OCR, then edit and explicitly confirm before saving.

For offline acceptance, explicitly download a lesson, disconnect, produce 10 distinct events, reconnect and prove exactly 10 persisted events. Replaying acknowledged events must not increase counts. Account switches must not show the previous account's deck, draft, photo or session.

State browser/version and emulation settings. Playwright emulation is not evidence of physical iOS/Android testing.
