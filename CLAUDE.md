# Lumo

Gamified habit tracker for a household, self-hosted (inspired by HabitTrove, rewritten from scratch). The full plan and all decisions are in `docs/ARCHITECTURE.md`: read it before any task and follow it. If a request contradicts it, say so before coding.

## Non-negotiable rules

- All logic (coins, rights, schedules, streaks) lives in `packages/domain`, in pure TypeScript, and the server is the only judge. Clients never send an amount.
- Every coin write goes through `ledger_entries` in the same transaction as the action that causes it. No balance is stored as truth.
- Database: SQLite (WAL) through Drizzle + better-sqlite3. No PostgreSQL.
- Any logic that touches coins or rights has its tests before it is considered done.
- Ignore the HabitTrove import during development.
- AGPL-3.0 license: `// SPDX-License-Identifier: AGPL-3.0-or-later` header in source files.

## Conventions

- pnpm workspaces + Turborepo, Node 22, strict TypeScript.
- Biome for lint and format.
- Conventional Commits.
- **Everything technical is in English**: code, comments, tests, documentation, commit messages.
- **The app is internationalised.** English is the source language, French the first translation. All UI text goes through `packages/i18n` (one dictionary per locale, same keys enforced by types and a test); never hard-code a user-facing string, a date format or a weekday name in an app. The API never sends UI text: it sends stable error `code`s that the clients translate. The UI language follows the browser or device and can be changed manually in the app.
- Mobile: Android only for now.

## Progress

Work step by step following the roadmap in `docs/ARCHITECTURE.md`. Step 1 (Foundations) delivered; the real Authentik sign-in on web and mobile still has to be validated. Step 2 (Core) delivered: tested domain, API, coins, transfers, wishes, stats, the "20 simultaneous completions" criterion verified. Step 3 (Front ends): the 4 screens are built on web and mobile (from the mock-up), with the offline queue tested, a server picker on mobile, undoing wish redemptions, and English/French translations; CI publishes the Docker image to GHCR and builds the Android APK with Gradle on the runner. Still to do: try the app on a real Android phone and complete the week of personal use that is the exit criterion. Model v2 slices A (super admins, accounts without a household, Admin panel) and B1 (personal items, wishes and coins: the app works without a household) are delivered on web and mobile (mobile not yet tried on a device). Next, before the first deployment: the rest of model v2 (several households per account, guardians, pot policy, toggles, claim codes) (accounts with guardians, several households per person, pots), decided in `docs/ARCHITECTURE.md` and not implemented yet. Current step: **3. Front ends**.
