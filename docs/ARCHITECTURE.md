# Lumo — plan d'architecture

Version figée le 17 novembre 2026, toutes décisions tranchées. Source : le doc « Lumo — plan d'architecture ».

## Contexte

Lumo reprend le principe de [HabitTrove](https://github.com/dohsimpson/HabitTrove) : on valide des habitudes et des tâches, on gagne des pièces, on les dépense dans une liste d'envies. On le reconstruit de zéro (aucun code repris) avec une API propre, une base SQLite et deux fronts (web et mobile), pour un foyer de 2 à 10 personnes hébergé dans un homelab.

Défauts de HabitTrove 0.2.31 qu'on corrige :

| Problème dans HabitTrove                                                                   | Réponse dans Lumo                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Fichiers JSON réécrits en entier à chaque sauvegarde (la dernière écriture efface l'autre) | SQLite, une ligne par complétion, transactions                                 |
| Le client calcule les pièces et appelle deux actions séparées                              | Le serveur seul calcule les pièces, dans la même transaction que la complétion |
| Pas d'API, seulement des server actions Next.js                                            | API HTTP documentée (OpenAPI), consommée par le web et le mobile               |
| Erreurs d'écriture journalisées puis ignorées                                              | Erreurs typées renvoyées au client                                             |

Licence : **AGPL-3.0** (fichier LICENSE + en-tête SPDX dans chaque paquet).

## Fonctionnalités du MVP

| Domaine       | Dans le MVP                                                                                                                                    | Plus tard                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Habitudes     | Récurrence (quotidienne, X fois par semaine, jours fixes, mensuelle), objectif par jour (ex. 3 verres d'eau), récompense, archivage, épinglage | RRULE libres, habitudes à durée         |
| Tâches        | Ponctuelles avec échéance, récompense, assignées à un ou plusieurs membres                                                                     | Sous-tâches, rappels récurrents         |
| Complétions   | Valider, annuler, valider un jour passé (fenêtre configurable), accord d'un adulte si l'élément l'exige                                        | Notification des validations en attente |
| Pièces        | Porte-monnaie perso par membre + cagnotte du foyer, historique, virements perso → cagnotte, ajustement manuel par un admin                     | Bonus de série                          |
| Envies        | Prix, limite d'usage par période, lien, échange contre des pièces, envies financées par la cagnotte                                            |                                         |
| Progrès       | Taux semaine et mois, série actuelle et record, heatmap                                                                                        | Export CSV                              |
| Foyer         | Membres, rôles, invitations, partage d'une habitude entre membres                                                                              | Plusieurs foyers par instance           |
| Notifications | Push mobile pour les rappels                                                                                                                   | Web Push, résumé par e-mail             |

Hors périmètre : dessins à main levée, mode démo public. L'écran de la cagnotte peut arriver après le MVP, mais le schéma la prévoit dès le départ.

Import HabitTrove : un script CLI à usage unique (`pnpm import:habittrove ./data`) qui chargera plus tard les données dans la base SQLite. **On n'en tient pas compte pendant le développement.**

## Architecture

Monorepo TypeScript. Une API unique détient toute la logique ; les deux clients n'envoient que des intentions (« valider », « échanger », « virer »), jamais des montants.

```
Front web (React + Vite)     App mobile (Expo, Android)        Authentik (OIDC)
        │ HTTPS + cookie            │ HTTPS + jeton                ▲
        └──────────────┬────────────┘                              │
                       ▼                                           │
        API Fastify /api/v1 ───────────────── OIDC ────────────────┘
        routes Zod → paquet domain → Drizzle
        + tâches planifiées (croner) dans le même process
                       │
                       ▼
        SQLite (WAL, /data/lumo.db) ──► Litestream (réplication)
                                         Expo Push ◄── rappels
```

Arborescence (pnpm workspaces + Turborepo) :

```
apps/api            Fastify, Drizzle, tâches planifiées, sert le build web
apps/web            React 19 + Vite, TanStack Router + Query, Tailwind v4
apps/mobile         Expo, Expo Router, TanStack Query persisté, NativeWind
packages/domain     règles métier pures (récurrence, séries, pièces, droits)
packages/api-client client généré depuis la spec OpenAPI
packages/tokens     design tokens partagés (couleurs, typo, espacements)
packages/i18n       clés de traduction partagées (fr d'abord, en ensuite)
scripts/            outils ponctuels (import HabitTrove, plus tard)
```

## Modèle de données (SQLite)

SQLite en mode WAL, un seul fichier, schéma géré par Drizzle ORM (driver better-sqlite3) et ses migrations. Tout porte un `household_id`. Aucun solde n'est stocké comme vérité : un solde = somme des écritures d'un porte-monnaie.

| Table              | Colonnes clés                                                                                                                                                                                          | Rôle                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `households`       | id, name, timezone, week_start, backdate_days                                                                                                                                                          | Le foyer et ses réglages                                                                                                  |
| `users`            | id, display_name, avatar_url, oidc_subject, username, email, password_hash (nullable)                                                                                                                  | Une personne, liée à Authentik ou à un compte local (`username` unique, en minuscules, pour la connexion locale)          |
| `memberships`      | household_id, user_id, role (`owner`, `adult`, `child`), can_create_items                                                                                                                              | Appartenance et rôle ; `can_create_items` = « si autorisé » pour un enfant                                                |
| `wallets`          | id, household_id, kind (`personal`, `shared`), user_id (null pour `shared`)                                                                                                                            | Un porte-monnaie par membre + une cagnotte par foyer                                                                      |
| `items`            | id, household_id, kind (`habit`, `task`), name, description, schedule (JSON), target_per_period, reward, credits_to (`personal`, `shared`), due_at, pinned, requires_approval, archived_at, created_by | Habitudes et tâches                                                                                                       |
| `item_assignees`   | item_id, user_id                                                                                                                                                                                       | Qui doit faire quoi                                                                                                       |
| `completions`      | id, item_id, user_id, local_date, status (`pending`, `approved`, `rejected`), approved_by, completed_at, undone_at, ledger_entry_id                                                                    | Une ligne par validation ; annuler pose `undone_at`                                                                       |
| `rewards`          | id, household_id, name, description, cost, funded_from (`personal`, `shared`), limit_count, limit_period, link, archived_at                                                                            | Les envies                                                                                                                |
| `reward_assignees` | reward_id, user_id                                                                                                                                                                                     | Qui peut échanger cette envie                                                                                             |
| `redemptions`      | id, reward_id, user_id, wallet_id, redeemed_at, ledger_entry_id                                                                                                                                        | Une ligne par échange                                                                                                     |
| `ledger_entries`   | id, household_id, wallet_id, amount, reason (`completion`, `undo`, `redemption`, `transfer`, `adjustment`), ref_id, transfer_id, note, created_by, created_at                                          | Journal des pièces, en ajout seul                                                                                         |
| `devices`          | id, user_id, push_token, platform, last_seen_at                                                                                                                                                        | Appareils pour le push                                                                                                    |
| `sessions`         | id, user_id, kind (`web`, `mobile`), refresh_token_hash, previous_token_hash, expires_at, device_id, created_at, last_used_at                                                                          | Cookie web ou refresh token mobile (hash SHA-256 seulement) ; `previous_token_hash` détecte le rejeu d'un jeton déjà roté |
| `idempotency_keys` | key, user_id, response, created_at                                                                                                                                                                     | Réponses déjà rendues pour les requêtes rejouées                                                                          |
| `invites`          | id, household_id, token_hash, role, created_by, expires_at, used_at, used_by                                                                                                                           | Invitations : seul moyen de créer un compte (7 jours, usage unique)                                                       |
| `oidc_states`      | state, nonce, code_verifier, invite_token, expires_at                                                                                                                                                  | État PKCE d'une connexion OIDC web en cours (usage unique, 10 min)                                                        |

Index : `completions (item_id, user_id, local_date)`, `ledger_entries (wallet_id, created_at)`.

Garde-fous en base (migrations `0000_init` et `0001_ledger_append_only`) : clés étrangères actives, `CHECK` sur chaque énumération, une seule cagnotte par foyer, `local_date` au format `YYYY-MM-DD`, et deux triggers qui interdisent tout `UPDATE` ou `DELETE` sur `ledger_entries` : une correction est toujours une nouvelle écriture.

## Règles métier (paquet `domain`)

TypeScript pur, sans dépendance à la base ni au framework, testé unitairement. Le mobile l'utilise pour l'affichage optimiste ; le serveur reste seul juge.

- **Jour local.** Chaque complétion porte une `local_date` calculée dans le fuseau du foyer. Stats et séries se basent dessus, jamais sur l'UTC.
- **Récurrence.** `schedule` validé par Zod : `{type:"daily"}`, `{type:"weekly",days:[1,3,5]}`, `{type:"timesPerWeek",count:3}`, `{type:"monthly",day:1}`. `isDue(item, date)` dit si l'élément apparaît un jour donné.
- **Objectif par jour.** `target_per_period = 3` → 3 validations possibles, chacune rapporte `reward`. Au-delà : 409 `target_reached`.
- **Pièces atomiques.** Valider = une transaction qui insère la complétion et l'écriture `+reward` dans le porte-monnaie désigné par `credits_to` (perso du membre ou cagnotte). Annuler = `undone_at` + écriture `−reward`. Le client n'envoie jamais de montant.
- **Accord d'un adulte.** Si `requires_approval` et que l'acteur est `child` : complétion en `pending`, aucune écriture. Un `owner` ou `adult` l'approuve (écriture créée) ou la rejette.
- **Virements.** Perso → cagnotte : deux écritures (−n perso, +n cagnotte) dans la même transaction, liées par `transfer_id`. Solde insuffisant : 409 `insufficient_balance`.
- **Échange d'envie.** Transaction `BEGIN IMMEDIATE` : vérifier solde et limite de période, insérer l'échange et l'écriture `−cost` dans le porte-monnaie `funded_from`. Une envie financée par la cagnotte est réservée aux rôles `owner` et `adult`.
- **Idempotence.** Toute requête d'écriture porte un `Idempotency-Key` (UUID client) ; un doublon renvoie la réponse déjà enregistrée.
- **Séries.** Périodes consécutives où l'objectif est atteint, en ne comptant que les jours où l'élément était dû.
- **Jours passés.** Permis dans la limite de `backdate_days` (2 par défaut) ; au-delà, seulement un `owner`.

## API

REST JSON sous `/api/v1`, Fastify + schémas Zod qui génèrent validation, types partagés et spec OpenAPI.

| Méthode et chemin                                                 | Rôle                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /me`                                                         | Profil, foyer, rôle, soldes (perso et cagnotte)                    |
| `GET /today?date=`                                                | Éléments dus ce jour avec l'avancement ; écran Aujourd'hui         |
| `GET/POST /items`, `PATCH/DELETE /items/:id`                      | Habitudes et tâches                                                |
| `POST /items/:id/completions`                                     | Valider (`date` optionnelle) ; renvoie la complétion et les soldes |
| `DELETE /completions/:id`                                         | Annuler                                                            |
| `POST /completions/:id/approve`, `POST /completions/:id/reject`   | Accord d'un adulte                                                 |
| `GET/POST /rewards`, `PATCH /rewards/:id`                         | Envies                                                             |
| `POST /rewards/:id/redemptions`                                   | Échanger                                                           |
| `POST /transfers`                                                 | Virement perso → cagnotte                                          |
| `GET /ledger?wallet=&cursor=`                                     | Historique paginé                                                  |
| `POST /ledger/adjustments`                                        | Ajustement manuel (owner)                                          |
| `GET /stats?from=&to=`                                            | Taux, séries, heatmap                                              |
| `GET /household`, `POST /household/invites`, `PATCH /members/:id` | Gestion du foyer                                                   |
| `POST /devices`                                                   | Jeton push                                                         |
| `GET /events`                                                     | Flux SSE des changements du foyer                                  |

Erreurs RFC 9457 (`application/problem+json`) avec un `code` stable. Les breaking changes passent par `/api/v2`.

Implémentation (étape 2) :

- Chaque route est déclarée une fois (`apps/api/src/routes`) avec ses schémas Zod : ils valident les entrées, typent le handler et produisent la spec `apps/api/openapi.json` (OpenAPI 3.1, aussi servie sur `GET /api/v1/openapi.json`). Un test échoue si le fichier n'est pas à jour (`pnpm --filter @lumo/api openapi:generate`). Le client `@lumo/api-client` en est généré (`pnpm --filter @lumo/api-client generate`). Les routes d'authentification sont hors spec pour l'instant.
- Les corps sont stricts : un champ inconnu, dont tout `amount`, est refusé en 400.
- Toute écriture exige `Idempotency-Key` (400 `idempotency_key_required` sinon). La recherche de la clé, l'action et la mémorisation de la réponse se font dans la même transaction `BEGIN IMMEDIATE` ; un rejeu renvoie la réponse enregistrée avec l'en-tête `Idempotent-Replayed: true`. Seules les réponses réussies sont mémorisées. Les clés sont propres à chaque utilisateur.
- Codes d'erreur métier : 409 `target_reached`, `insufficient_balance`, `limit_reached`, `not_due`, `not_pending`, `already_undone` ; 403 `backdate_not_allowed`, `forbidden` ; 400 `future_date`, `invalid_amount`, `validation_error`.
- `GET /completions?status=pending` (owner et adultes) liste les validations à approuver. `PATCH /rewards/:id` accepte `archived`. `GET /ledger` pagine par curseur, du plus récent au plus ancien.

Règles précisées à l'implémentation :

- Une validation en attente compte vers l'objectif du jour (pas de double envoi) mais pas vers les séries ni les taux, qui ne comptent que les validations approuvées et non annulées.
- Une tâche se valide une seule fois, quelle que soit la date.
- Annuler écrit une contre-écriture du montant exact payé à l'origine, même si la récompense a changé depuis. À l'approbation, la récompense va au porte-monnaie de celui qui a validé.
- Stats : taux « semaine » = 7 derniers jours, « mois » = 30 derniers jours ; le jour en cours non terminé n'est pas un échec ; heatmap sur la plage demandée (366 jours max), sans les habitudes « X fois par semaine ».
- Limite d'usage d'une envie : par membre et par période, comptée en jours locaux du foyer.

## Authentification et droits

- **Authentik** en OIDC (Authorization Code + PKCE) ; l'API émet ensuite ses propres sessions.
- **Web :** l'API sert de BFF, cookie `HttpOnly`, `Secure`, `SameSite=Lax`, aucun jeton dans le navigateur.
- **Mobile :** `expo-auth-session` (PKCE) puis `/auth/mobile/exchange` → jeton d'accès 15 min + refresh rotatif dans `expo-secure-store`.
- **Comptes locaux** en secours (Argon2id), désactivables via `LOCAL_AUTH_ENABLED`.
- **Liaison :** par `sub`, ou par invitation. Pas de création de compte sans invitation. Groupe Authentik `lumo-admins` → `owner` (optionnel, `OIDC_ADMIN_GROUP`, promotion seulement, jamais de rétrogradation).
- **Premier démarrage :** tant qu'aucun utilisateur n'existe, le premier à se connecter (OIDC) ou à appeler `POST /auth/setup` (compte local) crée le foyer et devient `owner`. Ensuite, plus aucun compte sans invitation.
- **Sessions :** web = jeton opaque en cookie, 30 jours ; mobile = jeton d'accès JWT HS256 de 15 min (lié à une session, donc révocable) + refresh rotatif de 60 jours. Si un refresh déjà utilisé est rejoué, toute la session est révoquée.
- **CSRF :** en plus de `SameSite=Lax`, toute requête qui modifie l'état avec un cookie doit porter un `Origin` égal à `PUBLIC_URL`.
- **Mots de passe :** Argon2id (19 Mio, 2 passes), 10 caractères minimum, limitation de débit sur les routes d'auth.

| Méthode et chemin                                     | Rôle                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /auth/config`                                    | Méthodes de connexion actives, `setupRequired`                          |
| `GET /auth/login?invite=`                             | Redirige vers Authentik (PKCE S256, state, nonce)                       |
| `GET /auth/callback`                                  | Retour d'Authentik ; ouvre la session web et redirige vers `PUBLIC_URL` |
| `POST /auth/mobile/exchange`                          | Code PKCE obtenu par `expo-auth-session` contre une paire de jetons     |
| `POST /auth/refresh`                                  | Rotation du refresh token mobile                                        |
| `POST /auth/setup`                                    | Premier compte local (instance vide)                                    |
| `POST /auth/local/login`, `POST /auth/local/register` | Connexion locale ; création d'un compte local sur invitation            |
| `POST /auth/logout`                                   | Révoque la session courante                                             |
| `POST /household/invites`                             | Crée une invitation (owner)                                             |

| Action                                                                 | owner | adult | child       |
| ---------------------------------------------------------------------- | ----- | ----- | ----------- |
| Valider ses éléments, échanger une envie perso                         | oui   | oui   | oui         |
| Créer ou modifier ses habitudes et tâches                              | oui   | oui   | si autorisé |
| Créer pour les autres, approuver un enfant, échanger une envie commune | oui   | oui   | non         |
| Ajuster les pièces, valider hors fenêtre                               | oui   | non   | non         |
| Gérer membres et réglages                                              | oui   | non   | non         |

Droits vérifiés côté API par `can(actor, action, resource)` du paquet `domain`.

## Fronts

Deux applis séparées (React pour le web, React Native/Expo pour le mobile). Elles partagent `domain`, `api-client`, `tokens` et `i18n`, pas les composants.

|              | Web                            | Mobile                                                     |
| ------------ | ------------------------------ | ---------------------------------------------------------- |
| Framework    | React 19 + Vite, SPA           | Expo, Expo Router                                          |
| Navigation   | TanStack Router                | Onglets : Aujourd'hui, Habitudes, Progrès, Envies          |
| Données      | TanStack Query + client généré | TanStack Query, cache persisté                             |
| Styles       | Tailwind v4 + tokens           | `StyleSheet` + tokens (NativeWind écarté, voir ci-dessous) |
| Hors ligne   | PWA en lecture (à faire)       | File des validations rejouée avec `Idempotency-Key`        |
| Distribution | Servi par l'API                | APK Android via EAS Build (iOS plus tard)                  |

### Implémentation (étape 3)

Maquette de référence : le canvas « Lumo — maquette de l'appli » (thème sombre, polices Unbounded et Manrope, violet `#6B4BF2`, pièces en `#FFC857`). Les couleurs vivent dans `packages/tokens` ; le web les recopie dans le `@theme` Tailwind de `apps/web/src/styles.css` (à garder synchrone).

- **Écrans** (identiques sur web et mobile) : Aujourd'hui (anneau de la journée, reste à faire, accords en attente pour les adultes, prochaine envie), Habitudes (semaine, onglets Habitudes/Tâches, valider ou annuler, création), Progrès (taux semaine ou mois, barres, séries, dernières pièces), Envies (solde, échange, création). Le web ajoute, à partir de 768 px, une barre latérale et des grilles à deux colonnes ; en dessous, la même barre d'onglets que le mobile.
- **Web** : routes TanStack Router en code (pas de génération de fichiers), TanStack Query, cookie de session, mises à jour optimistes avec retour arrière si le serveur refuse. Polices servies par `@fontsource` (pas de CDN : l'instance reste autonome).
- **Mobile** : Expo Router (`Stack.Protected` pour la connexion, onglets), TanStack Query avec cache persisté dans AsyncStorage (24 h). **NativeWind n'est pas utilisé** : `StyleSheet` et les tokens suffisent, sans dépendance de plus sur la chaîne Metro/Tailwind.
- **Logique partagée** : `domain/progress` (`summarizeProgress` : barres, taux, tendance), `i18n/format` (dates en français, libellés de récurrence, messages d'erreur par code).

**File hors ligne (mobile).** Valider passe toujours par la file : l'entrée (`itemId`, jour local, clé d'idempotence) est écrite dans AsyncStorage, affichée tout de suite par-dessus les données du serveur, puis envoyée dans l'ordre.

- La clé d'idempotence est fixée à la création : un rejeu après une réponse perdue ne crédite jamais deux fois.
- Le jour local est fixé à la saisie : une validation rejouée le lendemain garde son jour.
- Coupure réseau, 5xx ou 401 : l'entrée reste et on s'arrête (l'ordre est conservé). Refus du serveur (objectif atteint, jour trop ancien…) : l'entrée est abandonnée avec un message, les suivantes continuent.
- Envoi au démarrage, au retour au premier plan, au retour du réseau, à chaque saisie et au tirer-pour-rafraîchir.
- Annuler une validation encore en file la retire localement ; annuler une validation déjà envoyée exige le réseau.
- Échanger une envie, approuver et créer exigent aussi le réseau (le serveur doit juger le solde).

**Ajouts à l'API pour les fronts** : `GET /today` renvoie `completionIds` (validations annulables du jour) ; `GET /rewards` renvoie `remaining` (échanges encore possibles dans la période de limite) ; `GET /ledger` renvoie `label` (nom de l'habitude, tâche ou envie à l'origine de l'écriture). Progrès : la semaine est la semaine calendaire (jours futurs vides), le mois est les 4 dernières semaines glissantes, chacun comparé à la période précédente (fenêtre de 56 jours demandée à `/stats`).

**Pas encore fait** : PWA en lecture seule, Playwright et Maestro, gestion des membres et du foyer dans l'interface, avatars, notifications.

## Déploiement

`docker-compose.yml` dans un LXC Proxmox, derrière le reverse proxy existant :

| Service  | Image                                    | Rôle                                                        |
| -------- | ---------------------------------------- | ----------------------------------------------------------- |
| `app`    | `ghcr.io/<toi>/lumo` (Node 22, non root) | API, front web statique, tâches planifiées                  |
| `backup` | `litestream/litestream`                  | Réplication continue du fichier SQLite + snapshot quotidien |

- Variables validées par Zod au démarrage : `DATABASE_PATH`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (les trois OIDC vont ensemble ; sans elles, `LOCAL_AUTH_ENABLED` doit rester actif), `SESSION_SECRET` (32 caractères minimum), `PUBLIC_URL`, `LOCAL_AUTH_ENABLED`. Optionnelles : `OIDC_ADMIN_GROUP`, `WEB_DIST_PATH`, `PORT`, `HOST`, `LOG_LEVEL`. Une variable vide vaut « non définie ».
- `/data/lumo.db` sur un volume local, jamais NFS/SMB.
- Migrations appliquées au démarrage de `app`, seul process qui écrit.
- Logs JSON (pino), `/healthz`, `/readyz`, `/metrics` optionnel.
- Images construites par la CI, scannées (Trivy), versionnées en SemVer.

## Qualité

- Vitest sur `domain` : récurrences, séries, fuseaux (changement d'heure inclus), droits.
- Vitest sur l'API avec un fichier SQLite temporaire par test, dont un test de concurrence : 20 validations simultanées → solde exact.
- Playwright (web) et Maestro (mobile) pour valider, annuler, échanger, hors ligne.
- GitHub Actions : Biome, typecheck, tests, build, Trivy, spec OpenAPI à jour.
- Conventional Commits, revue avant fusion sur `main`.

## Feuille de route

On passe à l'étape suivante quand son critère est rempli. Durées estimées à temps partiel.

| Étape                       | Contenu                                                                                   | Critère de passage                              |
| --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Fondations (sem. 1–2)    | Monorepo, CI, Docker, schéma SQLite et migrations, auth Authentik + locale                | Connexion OK sur web et mobile                  |
| 2. Cœur métier (sem. 3–4)   | Paquet `domain` testé, API habitudes/tâches/complétions, pièces, virements, envies, stats | 20 validations simultanées donnent le bon solde |
| 3. Fronts (sem. 5–7)        | Les 4 écrans sur web et mobile, file hors ligne                                           | 1 semaine d'usage perso sans bug bloquant       |
| 4. Mise en service (sem. 8) | Restauration testée, push et rappels, foyer invité                                        | Tout le foyer l'utilise                         |
