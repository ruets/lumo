# Lumo — architecture plan

Version frozen on November 17, 2026, all decisions settled. Source: the "Lumo — architecture plan" doc.

## Context

Lumo takes the idea of [HabitTrove](https://github.com/dohsimpson/HabitTrove): you complete habits and tasks, earn coins, and spend them on a wish list. It is rebuilt from scratch (no code reused) with a clean API, a SQLite database and two front ends (web and mobile), for a household of 2 to 10 people hosted in a homelab.

HabitTrove 0.2.31 flaws we fix:

| Problem in HabitTrove                                                        | Answer in Lumo                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| JSON files rewritten in full on every save (the last write erases the other) | SQLite, one row per completion, transactions                              |
| The client computes the coins and calls two separate actions                 | Only the server computes coins, in the same transaction as the completion |
| No API, only Next.js server actions                                          | Documented HTTP API (OpenAPI) used by both web and mobile                 |
| Write errors logged then ignored                                             | Typed errors returned to the client                                       |

License: **AGPL-3.0** (LICENSE file + SPDX header in every package).

## MVP features

| Area          | In the MVP                                                                                                                | Later                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Habits        | Schedule (daily, X times a week, fixed days, monthly), per-day goal (e.g. 3 glasses of water), reward, archiving, pinning | Free-form RRULEs, timed habits    |
| Tasks         | One-off with a due date, reward, assigned to one or more members                                                          | Subtasks, recurring reminders     |
| Completions   | Complete, undo, complete a past day (configurable window), adult approval if the item requires it                         | Notification of pending approvals |
| Coins         | Personal wallet per member + household pot, history, personal → pot transfers, manual adjustment by an admin              | Streak bonus                      |
| Wishes        | Price, per-period usage limit, link, redemption for coins, wishes funded by the pot                                       |                                   |
| Progress      | Week and month rates, current and best streak, heatmap                                                                    | CSV export                        |
| Household     | Members, roles, invitations, sharing a habit between members                                                              | Several households per instance   |
| Notifications | Mobile push for reminders                                                                                                 | Web Push, e-mail digest           |

Out of scope: freehand drawing, public demo mode. The pot screen may come after the MVP, but the schema plans for it from the start.

HabitTrove import: a one-off CLI script (`pnpm import:habittrove ./data`) that will later load the data into the SQLite database. **It is ignored during development.**

## Architecture

TypeScript monorepo. A single API holds all the logic; both clients only send intents ("complete", "redeem", "transfer"), never amounts.

```
Web front end (React + Vite)   Mobile app (Expo, Android)     Authentik (OIDC)
        │ HTTPS + cookie            │ HTTPS + token                ▲
        └──────────────┬────────────┘                              │
                       ▼                                           │
        Fastify API /api/v1 ───────────────── OIDC ────────────────┘
        Zod routes → domain package → Drizzle
        + scheduled jobs (croner) in the same process
                       │
                       ▼
        SQLite (WAL, /data/lumo.db) ──► Litestream (replication)
                                         Expo Push ◄── reminders
```

Layout (pnpm workspaces + Turborepo):

```
apps/api            Fastify, Drizzle, scheduled jobs, serves the web build
apps/web            React 19 + Vite, TanStack Router + Query, Tailwind v4
apps/mobile         Expo, Expo Router, persisted TanStack Query
packages/domain     pure business rules (schedules, streaks, coins, rights)
packages/api-client client generated from the OpenAPI spec
packages/tokens     shared design tokens (colors, type, spacing)
packages/i18n       translations (English source, French first translation), locale detection, Intl formats
scripts/            one-off tools (HabitTrove import, later)
```

## Data model (SQLite)

SQLite in WAL mode, a single file, schema managed by Drizzle ORM (better-sqlite3 driver) and its migrations. Everything carries a `household_id`. No balance is stored as truth: a balance = the sum of a wallet's entries.

| Table              | Key columns                                                                                                                                                                                            | Role                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `households`       | id, name, timezone, week_start, backdate_days                                                                                                                                                          | The household and its settings                                                                                           |
| `users`            | id, display_name, avatar_url, oidc_subject, username, email, password_hash (nullable)                                                                                                                  | A person, linked to Authentik or to a local account (`username` unique, lowercase, for local sign-in)                    |
| `memberships`      | household_id, user_id, role (`owner`, `adult`, `child`), can_create_items                                                                                                                              | Membership and role; `can_create_items` = "if allowed" for a child                                                       |
| `wallets`          | id, household_id, kind (`personal`, `shared`), user_id (null for `shared`)                                                                                                                             | One wallet per member + one pot per household                                                                            |
| `items`            | id, household_id, kind (`habit`, `task`), name, description, schedule (JSON), target_per_period, reward, credits_to (`personal`, `shared`), due_at, pinned, requires_approval, archived_at, created_by | Habits and tasks                                                                                                         |
| `item_assignees`   | item_id, user_id                                                                                                                                                                                       | Who must do what                                                                                                         |
| `completions`      | id, item_id, user_id, local_date, status (`pending`, `approved`, `rejected`), approved_by, completed_at, undone_at, ledger_entry_id                                                                    | One row per completion; undoing sets `undone_at`                                                                         |
| `rewards`          | id, household_id, name, description, cost, funded_from (`personal`, `shared`), limit_count, limit_period, link, archived_at                                                                            | The wishes                                                                                                               |
| `reward_assignees` | reward_id, user_id                                                                                                                                                                                     | Who can redeem this wish                                                                                                 |
| `redemptions`      | id, reward_id, user_id, wallet_id, redeemed_at, undone_at, ledger_entry_id                                                                                                                             | One row per redemption; undoing sets `undone_at`                                                                         |
| `ledger_entries`   | id, household_id, wallet_id, amount, reason (`completion`, `undo`, `redemption`, `transfer`, `adjustment`), ref_id, transfer_id, note, created_by, created_at                                          | Coin ledger, append-only                                                                                                 |
| `devices`          | id, user_id, push_token, platform, last_seen_at                                                                                                                                                        | Devices for push                                                                                                         |
| `sessions`         | id, user_id, kind (`web`, `mobile`), refresh_token_hash, previous_token_hash, expires_at, device_id, created_at, last_used_at                                                                          | Web cookie or mobile refresh token (SHA-256 hash only); `previous_token_hash` detects replay of an already rotated token |
| `idempotency_keys` | key, user_id, response, created_at                                                                                                                                                                     | Responses already returned for replayed requests                                                                         |
| `invites`          | id, household_id, token_hash, role, created_by, expires_at, used_at, used_by                                                                                                                           | Invitations: the only way to create an account (7 days, single use)                                                      |
| `oidc_states`      | state, nonce, code_verifier, invite_token, expires_at                                                                                                                                                  | PKCE state of an in-progress web OIDC sign-in (single use, 10 min)                                                       |

Indexes: `completions (item_id, user_id, local_date)`, `ledger_entries (wallet_id, created_at)`.

Database guard rails (migrations `0000_init` and `0001_ledger_append_only`): foreign keys on, a `CHECK` on every enumeration, a single pot per household, `local_date` in `YYYY-MM-DD` format, and two triggers that forbid any `UPDATE` or `DELETE` on `ledger_entries`: a correction is always a new entry. Migration `0002` adds `redemptions.undone_at`.

## Business rules (`domain` package)

Pure TypeScript, no dependency on the database or the framework, unit-tested. Mobile uses it for optimistic display; the server remains the only judge.

- **Local day.** Each completion carries a `local_date` computed in the household's time zone. Stats and streaks rely on it, never on UTC.
- **Schedule.** `schedule` validated by Zod: `{type:"daily"}`, `{type:"weekly",days:[1,3,5]}`, `{type:"timesPerWeek",count:3}`, `{type:"monthly",day:1}`. `isDue(item, date)` says whether the item shows up on a given day.
- **Per-day goal.** `target_per_period = 3` → 3 completions possible, each earns `reward`. Beyond that: 409 `target_reached`.
- **Atomic coins.** Completing = one transaction that inserts the completion and the `+reward` entry in the wallet designated by `credits_to` (the member's own or the pot). Undoing = `undone_at` + `−reward` entry. The client never sends an amount.
- **Adult approval.** If `requires_approval` and the actor is `child`: completion in `pending`, no entry. An `owner` or `adult` approves it (entry created) or rejects it.
- **Transfers.** Personal → pot: two entries (−n personal, +n pot) in the same transaction, linked by `transfer_id`. Insufficient balance: 409 `insufficient_balance`.
- **Wish redemption.** `BEGIN IMMEDIATE` transaction: check balance and period limit, insert the redemption and the `−cost` entry in the `funded_from` wallet. A wish funded by the pot is reserved for the `owner` and `adult` roles.
- **Idempotency.** Every write request carries an `Idempotency-Key` (client UUID); a duplicate returns the response already stored.
- **Streaks.** Consecutive periods where the goal is met, counting only the days the item was due.
- **Past days.** Allowed within `backdate_days` (2 by default); beyond that, only an `owner`.

## API

REST JSON under `/api/v1`, Fastify + Zod schemas that generate validation, shared types and the OpenAPI spec.

| Method and path                                                   | Role                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /me`                                                         | Profile, household, role, balances (personal and pot)               |
| `GET /today?date=`                                                | Items due that day with progress; Today screen                      |
| `GET/POST /items`, `PATCH/DELETE /items/:id`                      | Habits and tasks                                                    |
| `POST /items/:id/completions`                                     | Complete (optional `date`); returns the completion and the balances |
| `DELETE /completions/:id`                                         | Undo                                                                |
| `POST /completions/:id/approve`, `POST /completions/:id/reject`   | Adult approval                                                      |
| `GET/POST /rewards`, `PATCH /rewards/:id`                         | Wishes                                                              |
| `POST /rewards/:id/redemptions`                                   | Redeem                                                              |
| `DELETE /redemptions/:id`                                         | Undo a redemption (refund)                                          |
| `POST /transfers`                                                 | Personal → pot transfer                                             |
| `GET /ledger?wallet=&cursor=`                                     | Paginated history                                                   |
| `POST /ledger/adjustments`                                        | Manual adjustment (owner)                                           |
| `GET /stats?from=&to=`                                            | Rates, streaks, heatmap                                             |
| `GET /household`, `POST /household/invites`, `PATCH /members/:id` | Household management                                                |
| `POST /devices`                                                   | Push token                                                          |
| `GET /events`                                                     | SSE stream of household changes                                     |

RFC 9457 errors (`application/problem+json`) with a stable `code`. Breaking changes go through `/api/v2`.

The API never sends text meant for the UI. It sends stable error `code`s that the clients translate; the English `message` is only a fallback and for logs.

Implementation (step 2):

- Each route is declared once (`apps/api/src/routes`) with its Zod schemas: they validate input, type the handler and produce the `apps/api/openapi.json` spec (OpenAPI 3.1, also served on `GET /api/v1/openapi.json`). A test fails if the file is out of date (`pnpm --filter @lumo/api openapi:generate`). The `@lumo/api-client` client is generated from it (`pnpm --filter @lumo/api-client generate`). The authentication routes are outside the spec for now.
- Bodies are strict: an unknown field, including any `amount`, is rejected with 400.
- Every write requires `Idempotency-Key` (400 `idempotency_key_required` otherwise). Looking up the key, the action and storing the response all happen in the same `BEGIN IMMEDIATE` transaction; a replay returns the stored response with the `Idempotent-Replayed: true` header. Only successful responses are stored. Keys are specific to each user.
- Business error codes: 409 `target_reached`, `insufficient_balance`, `limit_reached`, `not_due`, `not_pending`, `already_undone`; 403 `backdate_not_allowed`, `forbidden`; 400 `future_date`, `invalid_amount`, `validation_error`.
- `GET /completions?status=pending` (owner and adults) lists the completions to approve. `PATCH /rewards/:id` accepts `archived`. `GET /ledger` paginates by cursor, newest first.

Rules clarified during implementation:

- A pending completion counts toward the day's goal (no double submission) but not toward streaks or rates, which only count approved, non-undone completions.
- A task is completed only once, whatever the date.
- Undoing writes a counter-entry of the exact amount paid originally, even if the reward has changed since. On approval, the reward goes to the wallet of the person who completed it.
- Stats: "week" rate = last 7 days, "month" = last 30 days; the current unfinished day is not a failure; heatmap over the requested range (366 days max), without "X times a week" habits.
- A wish's usage limit: per member and per period, counted in the household's local days.

## Authentication and rights

- **Authentik** over OIDC (Authorization Code + PKCE); the API then issues its own sessions.
- **Web:** the API acts as a BFF, `HttpOnly`, `Secure`, `SameSite=Lax` cookie, no token in the browser.
- **Mobile:** `expo-auth-session` (PKCE) then `/auth/mobile/exchange` → 15-minute access token + rotating refresh token in `expo-secure-store`.
- **Local accounts** as a fallback (Argon2id), can be disabled with `LOCAL_AUTH_ENABLED`.
- **Linking:** by `sub`, or by invitation. No account creation without an invitation. Authentik group `lumo-admins` → `owner` (optional, `OIDC_ADMIN_GROUP`, promotion only, never demotion).
- **First start:** as long as no user exists, the first person to sign in (OIDC) or to call `POST /auth/setup` (local account) creates the household and becomes `owner`. After that, no account without an invitation.
- **Sessions:** web = opaque token in a cookie, 30 days; mobile = 15-minute HS256 JWT access token (tied to a session, so revocable) + 60-day rotating refresh token. If an already used refresh token is replayed, the whole session is revoked.
- **CSRF:** on top of `SameSite=Lax`, any request that changes state with a cookie must carry an `Origin` equal to `PUBLIC_URL`.
- **Passwords:** Argon2id (19 MiB, 2 passes), 10 characters minimum, rate limiting on the auth routes.

| Method and path                                       | Role                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /auth/config`                                    | Public. `app: "lumo"` (identifies the server), active methods, `oidcIssuer` and `oidcClientId` (public, never the secret), `setupRequired` |
| `GET /auth/login?invite=`                             | Redirects to Authentik (PKCE S256, state, nonce)                                                                                           |
| `GET /auth/callback`                                  | Return from Authentik; opens the web session and redirects to `PUBLIC_URL`                                                                 |
| `POST /auth/mobile/exchange`                          | PKCE code obtained by `expo-auth-session` in exchange for a token pair                                                                     |
| `POST /auth/refresh`                                  | Rotation of the mobile refresh token                                                                                                       |
| `POST /auth/setup`                                    | First local account (empty instance)                                                                                                       |
| `POST /auth/local/login`, `POST /auth/local/register` | Local sign-in; creation of a local account by invitation                                                                                   |
| `POST /auth/logout`                                   | Revokes the current session                                                                                                                |
| `POST /household/invites`                             | Creates an invitation (owner)                                                                                                              |

| Action                                                   | owner | adult | child      |
| -------------------------------------------------------- | ----- | ----- | ---------- |
| Complete own items, redeem a personal wish               | yes   | yes   | yes        |
| Create or edit own habits and tasks                      | yes   | yes   | if allowed |
| Create for others, approve a child, redeem a shared wish | yes   | yes   | no         |
| Adjust coins, complete outside the window                | yes   | no    | no         |
| Manage members and settings                              | yes   | no    | no         |

Rights are checked on the API side by `can(actor, action, resource)` from the `domain` package.

## Front ends

Two separate apps (React for web, React Native/Expo for mobile). They share `domain`, `api-client`, `tokens` and `i18n`, not the components.

|              | Web                               | Mobile                                                  |
| ------------ | --------------------------------- | ------------------------------------------------------- |
| Framework    | React 19 + Vite, SPA              | Expo, Expo Router                                       |
| Navigation   | TanStack Router                   | Tabs: Today, Habits, Progress, Wishes                   |
| Data         | TanStack Query + generated client | TanStack Query, persisted cache                         |
| Styles       | Tailwind v4 + tokens              | `StyleSheet` + tokens (NativeWind ruled out, see below) |
| Offline      | Read-only PWA (to do)             | Completion queue replayed with `Idempotency-Key`        |
| Distribution | Served by the API                 | Android APK built by CI (Gradle), iOS later             |

### Internationalisation

- **Source language: English.** French is the first translation. Dictionaries live in `packages/i18n`, one file per locale (`locales/en.ts`, `locales/fr.ts`). The French file is typed so it must have exactly the same keys as English, and a test checks that every key has the same `{placeholders}` in every locale. To add a language: create `locales/<code>.ts`, list it in `messages.ts`, give it a display name in `locale.ts`.
- **Plurals.** A key with `_one` / `_other` suffixes is picked by the `count` parameter through `Intl.PluralRules`; a missing key in a locale falls back to English.
- **Language choice.** Detected from the browser (`navigator.languages`) or the device (`expo-localization`), matching the first supported language and ignoring the region (`fr-CA` → `fr`). The user can override it in the app (Automatic, English, Français); the choice is stored locally (`localStorage` on web, AsyncStorage on mobile). Changing it remounts the UI so every string is re-evaluated. Storing the choice on the user profile (so it follows them across devices) is not done yet.
- **Dates and numbers** go through `Intl` (long and short dates, weekday names), never hand-written arrays.
- **Errors.** The API sends stable error `code`s, the clients translate them (`errors.<code>`); an unknown code shows the API's English message.
- **Code and docs are in English** (code, comments, tests, documentation, commit messages).

### Implementation (step 3)

Reference mock-up: the "Lumo — app mock-up" canvas (dark theme, Unbounded and Manrope fonts, purple `#6B4BF2`, coins in `#FFC857`). Colors live in `packages/tokens`; the web copies them into the Tailwind `@theme` of `apps/web/src/styles.css` (keep them in sync).

- **Screens** (same on web and mobile): Today (day ring, still to do, pending approvals for adults, next wish), Habits (week, Habits/Tasks tabs, complete or undo, creation), Progress (week or month rate, bars, streaks, latest coins), Wishes (balance, redeem, creation). From 768 px up the web adds a sidebar and two-column grids; below that, the same tab bar as mobile.
- **Web**: TanStack Router routes in code (no file generation), TanStack Query, session cookie, optimistic updates rolled back if the server refuses. Fonts served by `@fontsource` (no CDN: the instance stays self-contained). Routes: `/`, `/habits`, `/progress`, `/wishes`.
- **Mobile**: Expo Router (`Stack.Protected` for sign-in, tabs), TanStack Query with a cache persisted in AsyncStorage (24 h). **NativeWind is not used**: `StyleSheet` and the tokens are enough, with no extra dependency on the Metro/Tailwind chain.
- **Shared logic**: `domain/progress` (`summarizeProgress`: bars, rates, trend), `i18n/format` (localised dates, schedule labels, error messages by code).

**Offline queue (mobile).** Completing always goes through the queue: the entry (`itemId`, local day, idempotency key) is written to AsyncStorage, shown immediately on top of the server data, then sent in order.

- The idempotency key is fixed at creation: a replay after a lost response never credits twice.
- The local day is fixed at entry: a completion replayed the next day keeps its day.
- Network cut, 5xx or 401: the entry stays and we stop (order is preserved). Server refusal (goal reached, day too old…): the entry is dropped with a message, the next ones continue.
- Sent at startup, when returning to the foreground, when the network comes back, on every entry and on pull-to-refresh.
- Undoing a completion that is still queued removes it locally; undoing one already sent needs the network.
- Redeeming a wish, approving and creating also need the network (the server must judge the balance).

**Server choice (mobile).** The web app is served by the API, so its server is its origin. Mobile has no origin: at first launch, the user types their server address, so a single APK serves every household.

- The address is normalised (`lumo.example.com` becomes `https://lumo.example.com`, trailing slash and query removed). HTTPS is required; plain HTTP is only accepted for `localhost` and private networks (development). On a production APK, Android blocks plain HTTP anyway.
- It is checked with `GET /auth/config`: the response must carry `app: "lumo"`, otherwise "does not answer like a Lumo server". 8-second timeout, otherwise "unreachable".
- The Authentik issuer and `client_id` come from that same call: no more `EXPO_PUBLIC_OIDC_*` variables to compile into the APK. The `lumo://auth` redirect URI still has to be declared in Authentik.
- The router has three states: no server (entry screen), server without a session (sign-in), session (tabs).
- "Change server" (sign-in and bottom of the Today screen) erases tokens, cache and offline queue before forgetting the address: no data from one household is ever sent to another.

**API additions for the front ends**: `GET /today` returns `completionIds` (undoable completions of the day); `GET /rewards` returns `remaining` (redemptions still possible in the limit period); `GET /ledger` returns `label` (name of the habit, task or wish behind the entry). Progress: the week is the calendar week (future days empty), the month is the last 4 rolling weeks, each compared with the previous period (56-day window requested from `/stats`).

**Undoing a wish redemption.** `DELETE /redemptions/{id}`: `redemptions.undone_at` (migration 0002) and an `undo` counter-entry of the exact amount paid, in the original wallet (personal or pot), in the same transaction. Same rights as undoing a completion (`redemption:undo`: yourself, the owner for everyone, an adult for a child). An undone redemption no longer counts toward the usage limit (`remaining` goes back up); a second undo returns 409 `already_undone`. In the history (Progress, web and mobile), each redemption that has not been refunded has an "Undo redemption" button with confirmation; it needs the network.

**Not done yet**: read-only PWA, Playwright and Maestro, member and household management in the UI, avatars, notifications, language stored on the user profile.

## Deployment

`docker-compose.yml` in a Proxmox LXC, behind the existing reverse proxy:

| Service  | Image                                    | Role                                                       |
| -------- | ---------------------------------------- | ---------------------------------------------------------- |
| `app`    | `ghcr.io/<you>/lumo` (Node 22, non-root) | API, static web front end, scheduled jobs                  |
| `backup` | `litestream/litestream`                  | Continuous replication of the SQLite file + daily snapshot |

- Variables validated by Zod at startup: `DATABASE_PATH`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (the three OIDC ones go together; without them, `LOCAL_AUTH_ENABLED` must stay on), `SESSION_SECRET` (32 characters minimum), `PUBLIC_URL`, `LOCAL_AUTH_ENABLED`. Optional: `OIDC_ADMIN_GROUP`, `WEB_DIST_PATH`, `PORT`, `HOST`, `LOG_LEVEL`. An empty variable counts as unset.
- `/data/lumo.db` on a local volume, never NFS/SMB.
- Migrations applied at `app` startup, the only process that writes.
- JSON logs (pino), `/healthz`, `/readyz`, optional `/metrics`.
- Images built by CI, scanned (Trivy), versioned with SemVer.
- **GitHub Actions CI** (`.github/workflows`):
  - `ci.yml`: lint, typecheck, tests (OpenAPI freshness and the offline queue included), build; then the single web + API image, tested (the container starts, serves the web app and answers the API) and scanned by Trivy; then published to `ghcr.io/<owner>/<repo>` on every push to `main` (`edge` and the SHA) and on a `vX.Y.Z` tag (SemVer and `latest`). Pull requests never publish. `linux/amd64` image only (an ARM build under emulation is too slow).
  - `mobile.yml`: Android APK built on the runner (`expo prebuild` then Gradle), no Expo account or secret, signed with Expo's debug key (enough to install it on your own phones). Available as an artifact, and attached to the GitHub release on a tag. Since the server address is chosen in the app, a single APK serves every household. `versionCode` = run number (`apps/mobile/app.config.ts`). EAS Build remains possible to publish to a store someday.

## Quality

- Vitest on `domain`: schedules, streaks, time zones (daylight-saving included), rights.
- Vitest on the API with a temporary SQLite file per test, including a concurrency test: 20 simultaneous completions → exact balance.
- Vitest on `i18n`: same keys and placeholders in every locale, plurals, locale negotiation, `Intl` formats.
- Playwright (web) and Maestro (mobile) to complete, undo, redeem, go offline.
- GitHub Actions: Biome, typecheck, tests, build, Trivy, OpenAPI spec up to date.
- Conventional Commits, review before merging to `main`.

## Roadmap

We move to the next step when its criterion is met. Durations are estimated part-time.

| Step                    | Content                                                                                | Exit criterion                                     |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. Foundations (wk 1–2) | Monorepo, CI, Docker, SQLite schema and migrations, Authentik + local auth             | Sign-in works on web and mobile                    |
| 2. Core (wk 3–4)        | Tested `domain` package, habits/tasks/completions API, coins, transfers, wishes, stats | 20 simultaneous completions give the right balance |
| 3. Front ends (wk 5–7)  | The 4 screens on web and mobile, offline queue                                         | 1 week of personal use with no blocking bug        |
| 4. Go live (wk 8)       | Tested restore, push and reminders, invited household                                  | The whole household uses it                        |
