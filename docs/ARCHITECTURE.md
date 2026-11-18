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
| Completions   | Complete, undo, complete a past day (configurable window), guardian approval if the item requires it                      | Notification of pending approvals |
| Coins         | Personal wallet per member + household pot, history, personal → pot transfers, manual adjustment by an admin              | Streak bonus                      |
| Wishes        | Price, per-period usage limit, link, redemption for coins, wishes funded by the pot                                       |                                   |
| Progress      | Week and month rates, current and best streak, heatmap                                                                    | CSV export                        |
| Household     | Members, roles, invitations, sharing a habit between members, several households per person (model v2)                    | Calendar sharing                  |
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

## Model v2: accounts, supervision and households (decided, not implemented yet)

This section supersedes "Data model", the household parts of "Business rules" and "Authentication and rights" below, which still describe what is implemented today (one household per instance, everything belongs to the household). It is decided before the first deployment, so the schema and its initial migration are rewritten, with no data to migrate. Each part of the tables below is updated as the code lands.

### Principles

- **An account belongs to a person.** It owns its profile settings (time zone, first day of the week), its balance, its wishes and its personal habits and tasks. It exists without any household.
- **A household is an optional shared space**: members, shared habits and tasks (optionally assigned to a member), shared wishes and a pot. A person can belong to several households. Each item carries its household, so a person's rights on it come from their membership of that household: there is no "active household".
- **Supervision is a property of the account.** An account is supervised if and only if it has at least one guardian (parent or tutor). Household roles shrink to `owner` and `member`: "child" no longer exists in a household.
- **Privacy by default.** Only guardians see the detail of a supervised account. Household owners see the shared items, not their members' personal space. Super admins see no content at all.

### Entities

| Entity / table      | What changes                                                                                                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`             | `is_super_admin`, `disabled_at`, `time_zone`, `week_start`, `oidc_issuer` + `oidc_subject` (the identity is the pair, the issuer being the OIDC tenant), and for supervised accounts the rights `can_create`, `can_modify`, `can_delete`, `can_transfer` |
| `guardianships`     | `guardian_id`, `ward_id`, `status` (`pending`, `active`), created by consent of both sides. The ward's `supervised` state is derived: at least one `active` row                                                                                          |
| `households`        | `features` (JSON: pot, wishes, habits, tasks), `pot_withdrawals` (`owners`, `members`, `nobody`), `backdate_days` (nullable = no limit); no more time zone or week start (moved to users)                                                                |
| `memberships`       | `(household_id, user_id)` unique, `role` is `owner` or `member`; a user can have several rows                                                                                                                                                            |
| `wallets`           | one personal wallet per user (`user_id`, no household) and one pot per household (`household_id`, no user)                                                                                                                                               |
| `items`, `rewards`  | exactly one of `owner_user_id` (personal) and `household_id` (shared); shared items can be assigned to one or several members                                                                                                                            |
| `ledger_entries`    | tied to a wallet; the household column goes away (a pot entry is found through its wallet)                                                                                                                                                               |
| `invites`           | for a household only: `household_id`, `role` (`owner` or `member`); an existing account can use one                                                                                                                                                      |
| `instance_settings` | who may create a household (`anyone` or `admins`, default `anyone`) and whether guardians may create supervised local accounts (default on), edited in the Admin panel                                                                                   |
| `account_claims`    | one-time code created by a super admin for an account that will sign in through OIDC; using it links the OIDC identity to that account                                                                                                                   |

Time zone and first day of the week are per account because a person cannot have two "todays". A household keeps only what is its own, such as its backdate window.

### Rights

Effective right = what the role allows, **and** (if the account is supervised) what its guardians allow.

| Who              | Can                                                                                                                                                                                                                                                                                                                                               | Cannot                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Account (self)   | Manage its own profile, personal items and wishes, complete items, transfer between its wallet and the pots of its households                                                                                                                                                                                                                     | If supervised: create, modify, delete or transfer without the matching right from its guardians |
| Guardian         | See and edit the ward's items, wishes and history; set the ward's rights; approve the ward's completions that need approval; adjust the ward's balance with a note (add or remove coins, never their own); transfer from the ward's wallet to a pot the ward can use; stop supervising (the account becomes unsupervised when the last one stops) | See anything of an account it does not supervise; withdraw from a pot on the ward's behalf      |
| Household owner  | Invite, change roles, remove members, edit household settings and features, manage shared items and wishes, adjust the pot, pay out from the pot, change the pot withdrawal policy                                                                                                                                                                | See a member's personal space                                                                   |
| Household member | See the shared items and who completed what, create and edit shared items they made, complete shared items, give to the pot, withdraw from it if the household allows it                                                                                                                                                                          | Manage members or settings                                                                      |
| Super admin      | List accounts and households, create local accounts, create and delete households, disable, enable or delete an account, grant or remove the super admin role, remove an account from a household, adjust a household's pot                                                                                                                       | See any item, wish or history; designate a guardian                                             |

Guards: never delete or demote the last super admin, never delete yourself, never remove the last owner of a household.

### Flows

- **First start.** The first account (local setup or first OIDC sign-in) becomes super admin and owner of a first household, so the app is usable at once.
- **Account creation.** By a super admin (local account, or an account that will be claimed through OIDC), by a guardian creating a supervised local account for their child (instance setting, on by default), or automatically for an unknown OIDC identity when `OIDC_AUTO_CREATE_USERS=true` (otherwise it is refused). No self-registration and no notion of e-mail in the app.
- **Linking OIDC to an existing account.** The identity is `(issuer, sub)`. For an account made by a super admin, a one-time claim code is handed to the person; signing in through OIDC and entering the code links the identity to that account.
- **Household creation.** Open to any account by default (the creator becomes owner); a super admin can restrict it to super admins in the Admin panel.
- **Joining a household.** By invitation code, as today, from a signed-in account. Invitations exist for households only.
- **Leaving or being removed.** The membership goes. The account, its sessions, its personal items, wishes and wallet stay (including coins earned from shared items and credited to the personal wallet). The person loses the household's items, wishes and pot; what they gave to the pot stays there.
- **Supervision.** Created by mutual consent: a guardian proposes, or the person designates a guardian, and the other side accepts. A guardian can end it for themselves at any time; when none is left the account is no longer supervised. Nothing forces supervision on an adult.
- **Pot transfers.** Any member can give from their wallet to a household pot (subject to the `can_transfer` right if supervised; a guardian may also give from the ward's wallet). Withdrawing to one's own wallet follows the household's `pot_withdrawals` policy (owners only by default); a guardian cannot withdraw on the ward's behalf. An owner can pay out from the pot to a member. Nobody adjusts their own wallet: guardians adjust their wards', household owners adjust the pot.
- **Disabling and deleting.** A disabled account cannot sign in and keeps all its data. Deleting erases its credentials, personal items, wishes, wallet and history; its past completions in shared items stay, anonymised, and what it gave to a pot stays.
- **Feature toggles.** A household can hide or disable its pot, wishes, habits or tasks. A disabled feature is hidden in the UI and refused by the API (`feature_disabled`). The personal space has no toggles.

### Implemented so far

- Super admins, the Admin panel, accounts without a household (slice A).
- Personal ownership (slice B1): items and wishes belong to a household or to an account (`owner_id`), the personal wallet belongs to the account and follows it between households (`wallets.household_id` is null), `ledger_entries.household_id` is nullable, and the app works fully for an account in no household. Personal items are visible to their owner only, credit the personal wallet only and never need approval.
- Several households per account (slice B2): `memberships` has no per-user uniqueness. Time zone and first weekday belong to the account (`users.timezone`, `users.week_start`, edited in Settings); a household keeps only its name and backdate window. Lists (items, wishes, today, stats) merge every household of the person and their personal space. Rights on an item or wish come from the household it belongs to, and coins credited to a pot go to that household's pot, whichever household is active. The client sends the household it is looking at in the `X-Household-Id` header; household management routes (members, invites, pot transfers, ledger of the pot, approvals, leaving) apply to that active household, which falls back to the person's oldest membership. Until guardians exist, a child without the right to create items in any household cannot create personal items either.
- Guardianships (slice C1): `guardianships` rows, one-time `guardianship_codes` (7 days, single use) in both directions (a guardian's code makes the person who uses it their ward; a ward's code makes the person who uses it their guardian), and a guardian can also create a supervised local account. A supervised account is limited by `users.can_create/can_modify/can_delete/can_transfer` (strict defaults: only giving to a pot is allowed) and its completions of items that need approval go pending like a child's. Guardians act on a ward's own space through `/supervision/wards/:wardId/...` (same routes and rules as the ward, minus completing and redeeming), set the ward's rights, adjust the ward's coins with a note, approve or reject completions, and end the supervision; a ward cannot end it. Nothing is revealed about accounts you do not supervise (404), super admins included. No loops: a supervised account cannot supervise. Household roles are `owner` and `member`: the former `child` is a supervised account, the former `can_create_items` is the ward's `can_create`.
- Pot policy (slice D1): `households.pot_withdrawals` is `owners` (default), `members` or `nobody` and governs who takes coins out of the pot, either to their own wallet (`POST /household/pot/withdrawals`) or by paying a shared wish; a supervised account never withdraws, and nobody withdraws on a ward's behalf. An owner can pay another member out of the pot (`POST /household/pot/payouts`, never to themselves, whatever the policy); everybody can give to it. Errors use `pot_locked`.
- Still to do: anyone else can), feature toggles, claim codes, `OIDC_AUTO_CREATE_USERS`.

### Still open

- The exact lifetime and format of claim codes and of guardianship requests (proposed: 7 days, single use, like household invitations).

### Order of work

1. Rewrite the schema, the initial migration, the domain rights and the API for accounts, guardianship, multi-household, personal or shared items, wallets and pots. The 181 existing tests are the safety net and are adapted as they go.
2. Web and mobile: supervision (guardians' panel, requests), household switching and personal or shared scopes, two balances and pots, profile settings, feature toggles.
3. Admin panel (web and mobile) for super admins.

## Data model (SQLite, implemented today)

SQLite in WAL mode, a single file, schema managed by Drizzle ORM (better-sqlite3 driver) and its migrations. Everything carries a `household_id`. No balance is stored as truth: a balance = the sum of a wallet's entries.

| Table              | Key columns                                                                                                                                                                                            | Role                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `households`       | id, name, timezone, week_start, backdate_days                                                                                                                                                          | The household and its settings                                                                                           |
| `users`            | id, display_name, avatar_url, oidc_subject, username, email, password_hash (nullable)                                                                                                                  | A person, linked to Authentik or to a local account (`username` unique, lowercase, for local sign-in)                    |
| `memberships`      | household_id, user_id, role (`owner`, `member`)                                                                                                                                                        | Membership and role; `can_create_items` = "if allowed" for a child                                                       |
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
- **Guardian approval.** If `requires_approval` and the actor is supervised (has a guardian): completion in `pending`, no entry. One of their guardians approves it (entry created) or rejects it, through `/supervision/wards/:wardId/completions/:id/approve|reject`; `GET /supervision/pending` lists what waits for you across your wards.
- **Transfers.** Personal → pot: two entries (−n personal, +n pot) in the same transaction, linked by `transfer_id`. Insufficient balance: 409 `insufficient_balance`.
- **Wish redemption.** `BEGIN IMMEDIATE` transaction: check balance and period limit, insert the redemption and the `−cost` entry in the `funded_from` wallet. A wish funded by the pot is reserved for the `owner` and `adult` roles.
- **Idempotency.** Every write request carries an `Idempotency-Key` (client UUID); a duplicate returns the response already stored.
- **Streaks.** Consecutive periods where the goal is met, counting only the days the item was due.
- **Past days.** Allowed within `backdate_days` (2 by default); beyond that, only an `owner`.

## API

REST JSON under `/api/v1`, Fastify + Zod schemas that generate validation, shared types and the OpenAPI spec.

| Method and path                                                                                                                               | Role                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /me`                                                                                                                                     | Profile, household, role, balances (personal and pot)               |
| `GET /today?date=`                                                                                                                            | Items due that day with progress; Today screen                      |
| `GET/POST /items`, `PATCH/DELETE /items/:id`                                                                                                  | Habits and tasks                                                    |
| `POST /items/:id/completions`                                                                                                                 | Complete (optional `date`); returns the completion and the balances |
| `DELETE /completions/:id`                                                                                                                     | Undo                                                                |
| `POST /completions/:id/approve`, `POST /completions/:id/reject`                                                                               | Adult approval                                                      |
| `GET/POST /rewards`, `PATCH /rewards/:id`                                                                                                     | Wishes                                                              |
| `POST /rewards/:id/redemptions`                                                                                                               | Redeem                                                              |
| `DELETE /redemptions/:id`                                                                                                                     | Undo a redemption (refund)                                          |
| `POST /transfers`                                                                                                                             | Personal → pot transfer                                             |
| `GET /ledger?wallet=&cursor=`                                                                                                                 | Paginated history                                                   |
| `POST /ledger/adjustments`                                                                                                                    | Manual adjustment (owner)                                           |
| `GET /stats?from=&to=`                                                                                                                        | Rates, streaks, heatmap                                             |
| `GET /household`, `PATCH /household`, `PATCH /members/:id`, `DELETE /members/:id`, `POST /household/invites`, `DELETE /household/invites/:id` | Household management (see below)                                    |
| `POST /devices`                                                                                                                               | Push token                                                          |
| `GET /events`                                                                                                                                 | SSE stream of household changes                                     |

RFC 9457 errors (`application/problem+json`) with a stable `code`. Breaking changes go through `/api/v2`.

The API never sends text meant for the UI. It sends stable error `code`s that the clients translate; the English `message` is only a fallback and for logs.

Implementation (step 2):

- Each route is declared once (`apps/api/src/routes`) with its Zod schemas: they validate input, type the handler and produce the `apps/api/openapi.json` spec (OpenAPI 3.1, also served on `GET /api/v1/openapi.json`). A test fails if the file is out of date (`pnpm --filter @lumo/api openapi:generate`). The `@lumo/api-client` client is generated from it (`pnpm --filter @lumo/api-client generate`). The authentication routes are outside the spec for now.
- Bodies are strict: an unknown field, including any `amount`, is rejected with 400.
- Every write requires `Idempotency-Key` (400 `idempotency_key_required` otherwise). Looking up the key, the action and storing the response all happen in the same `BEGIN IMMEDIATE` transaction; a replay returns the stored response with the `Idempotent-Replayed: true` header. Only successful responses are stored. Keys are specific to each user.
- Business error codes: 409 `target_reached`, `insufficient_balance`, `limit_reached`, `not_due`, `not_pending`, `already_undone`; 403 `backdate_not_allowed`, `forbidden`; 400 `future_date`, `invalid_amount`, `validation_error`.
- `PATCH /rewards/:id` accepts `archived`. `GET /ledger` paginates by cursor, newest first.

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
- **Linking:** by `sub`, or by invitation. No account creation without an invitation. Members of the Authentik group named by `OIDC_ADMIN_GROUP` (for example `lumo-admins`) become `owner`: opt-in, disabled when the variable is unset or empty, promotion only, never demotion.
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

| Action                                                        | owner                | member               | supervised member               |
| ------------------------------------------------------------- | -------------------- | -------------------- | ------------------------------- |
| Complete own items, redeem a personal wish                    | yes                  | yes                  | yes (approval if the item asks) |
| Create, edit or delete habits, tasks and wishes               | yes                  | yes                  | only what their guardians allow |
| Take coins out of the pot (to yourself, or pay a shared wish) | per household policy | per household policy | never                           |
| Give to a pot                                                 | yes                  | yes                  | if their guardians allow it     |
| Undo someone else's completion, adjust the pot                | yes                  | no                   | no                              |
| Complete outside the backdate window                          | yes                  | no                   | no                              |
| Manage members and settings                                   | yes                  | no                   | no                              |

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

- **Screens** (same on web and mobile): Today (day ring, still to do, pending approvals for guardians, next wish), Habits (week, Habits/Tasks tabs, complete or undo, creation), Progress (week or month rate, bars, streaks, latest coins), Wishes (balance, redeem, creation), Settings (account and sign-out, language, and on mobile the server), opened from the avatar next to the balance. From 768 px up the web adds a sidebar and two-column grids; below that, the same tab bar as mobile.
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
- "Change server" (sign-in and the Settings screen) erases tokens, cache and offline queue before forgetting the address: no data from one household is ever sent to another.

**API additions for the front ends**: `GET /today` returns `completionIds` (undoable completions of the day); `GET /rewards` returns `remaining` (redemptions still possible in the limit period); `GET /ledger` returns `label` (name of the habit, task or wish behind the entry). Progress: the week is the calendar week (future days empty), the month is the last 4 rolling weeks, each compared with the previous period (56-day window requested from `/stats`).

**Undoing a wish redemption.** `DELETE /redemptions/{id}`: `redemptions.undone_at` (migration 0002) and an `undo` counter-entry of the exact amount paid, in the original wallet (personal or pot), in the same transaction. Same rights as undoing a completion (`redemption:undo`: yourself, the owner for everyone, an adult for a child). An undone redemption no longer counts toward the usage limit (`remaining` goes back up); a second undo returns 409 `already_undone`. In the history (Progress, web and mobile), each redemption that has not been refunded has an "Undo redemption" button with confirmation; it needs the network.

**Household management.** `GET /household` returns the household settings and its members (display name, role, `canCreateItems`) to every member, plus the pending invitations to the owner only. `PATCH /members/:id` (owner only) changes a role and/or a child's permission to create items; the domain rule `assertRoleChange` keeps at least one owner (409 `last_owner`). `POST /household/invites` creates an invitation, whose token is shown once at creation; `DELETE /household/invites/:id` revokes a pending one. Joining: a link `https://<server>/?invite=<token>` opens the web join form; on mobile, "I have an invitation" on the sign-in screen takes the code (the owner shares it through the system share sheet). Both call `POST /auth/local/register`; with OIDC the invitation travels in `GET /auth/login?invite=`. The web page is `/household`, the mobile screen is reached from Settings.

`PATCH /household` (owner) edits the name, time zone, first day of the week (ISO 1–7) and backdate window (0–30 days, or `null` for no limit: the number is kept in the database so turning the limit back on starts from it); the time zone is validated against the IANA database. Changing it only affects days computed from then on: completions already recorded keep their `local_date`. `DELETE /members/:id` (owner) removes a member: never yourself (409 `cannot_remove_self`) and never the last owner (409 `last_owner`), both domain rules (`assertCanRemoveMember`). The member loses every way in (sessions, devices, credentials, memberships) and is unassigned from items and wishes, their pending approvals are rejected, but their history stays: completions, ledger entries and wallet are kept, and the user row remains so old entries still show a name. Erasing the credentials frees the username and means an OIDC member must be invited again to come back.

Joining through Authentik: on web the join form's Authentik button carries the invitation (`/auth/login?invite=`); on mobile the code typed in the join form is sent with the code exchange (`invite` in `/auth/mobile/exchange`). The server side is covered by tests against a fake OIDC provider; it has not been tried against a real Authentik yet.

**Not done yet**: read-only PWA, Playwright and Maestro, avatars, notifications, language stored on the user profile.

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
- The runtime image drops npm, corepack and yarn (it only runs `node dist/server.js`): their bundled dependencies were the only findings of the Trivy scan on the base image.
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

| Step                          | Content                                                                                                 | Exit criterion                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Foundations (wk 1–2)       | Monorepo, CI, Docker, SQLite schema and migrations, Authentik + local auth                              | Sign-in works on web and mobile                                                                           |
| 2. Core (wk 3–4)              | Tested `domain` package, habits/tasks/completions API, coins, transfers, wishes, stats                  | 20 simultaneous completions give the right balance                                                        |
| 3. Front ends (wk 5–7)        | The 4 screens on web and mobile, offline queue                                                          | 1 week of personal use with no blocking bug                                                               |
| 3b. Model v2 (before go-live) | Accounts, supervision, several households, personal or shared items, pots, Admin panel (see "Model v2") | Schema rewritten with all tests green; supervision, households and the Admin panel work on web and mobile |
| 4. Go live (wk 8)             | Tested restore, push and reminders, invited household                                                   | The whole household uses it                                                                               |
