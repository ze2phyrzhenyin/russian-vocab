# Russian vocabulary learning app

- This is a new Russian vocabulary memorization project, not a dictionary product.
- Canonical server project: rex-cli:/home/adminlinux/Developer/russian-vocab. Local implementation and independent acceptance workspace: /Users/zephyrsui/Developer/russian-vocab.
- User instruction (2026-10-24): Codex directly implements, reviews and verifies this project. The updated global default is also Codex throughout. Do not invoke Claude unless the user explicitly enables it for a specified scope.
- Current phase: active development. On 2026-10-24 the user explicitly authorized implementing docs/DEVELOPMENT_PROMPT.txt with Codex. This supersedes the earlier preparation-only instruction. Deliver checkpoints A, B and C with real verification. Read STATUS.md and PLANS.md on resumption.
- Product: mobile-first Chinese UI for Russian vocabulary learning with the user's real six-book workbook. Preserve source rows, image mappings, uncertainty and provenance. Never imply all source books or Russian annotations have been fully verified.
- Parallel Codex agents are explicitly requested by the supplied development prompt. Root owns shared types, database schema/migrations, package manifest/lockfile and integration. Assign disjoint paths; do not overwrite concurrent work.
- Use dev-run for heavy build/test commands. On rex-cli browser automation uses dev-browser-run.
- User explicitly authorized GitHub publication and public deployment on 2026-10-24, then requested a public open-source repository and selected MIT. GitHub: public ze2phyrzhenyin/russian-vocab, MIT for original code and documentation. Preserve third-party licenses and notices. Public origin: https://slovo.zhaoyang.fr. Deploy this project's isolated production app/database and dedicated ingress; do not interrupt unrelated services or alter their data.
- Isolated project databases, demo accounts and project app processes are authorized for development and verification. Keep demo configuration fail-closed for production. Production uses a separate database and disables fixed demo accounts. The user requested a normal public test account and its credentials.
- Keep the copyrighted workbook, extracted images/data, user data and credentials out of Git. Data remains in private local/server storage and is not covered by the code's MIT license. No external tracking; OCR assets are locally hosted and on demand.
- Commands: `pnpm run setup --compose-db`, `pnpm dev`, `pnpm verify`, `pnpm verify:import`, `pnpm test:e2e`, `pnpm content:report`, `pnpm smoke:demo`. Use a built `pnpm start` server for offline browser verification; do not rebuild while another agent is using it.
- Completion requires actual login and persisted study/OCR/offline/admin paths, source counts and privacy preservation, lint/type/tests/build, and inspected mobile screenshots. Record unrun checks and physical-device limitations honestly.
- Read `docs/CONTRACT.md` for integration, `docs/DATA_CONTRACT.md` for import, `docs/RUSSIAN_CONTENT.md` for annotation, `docs/LEARNING_ENGINE.md` for scheduling, and `docs/TESTING.md` / `docs/DEMO.md` for acceptance. Repeatable workflows live in `.agents/skills/`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
