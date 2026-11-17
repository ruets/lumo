# Lumo

Suivi d'habitudes gamifié pour un foyer, self-hosted. Licence AGPL-3.0. Plan complet : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Développement

Prérequis : Node 22, pnpm (via Corepack).

```bash
pnpm install
cp .env.example apps/api/.env   # puis renseigner SESSION_SECRET ; PUBLIC_URL=http://localhost:5173
pnpm dev                        # API :3000 et web :5173 (le web proxifie /api)
```

Au premier lancement, ouvrir http://localhost:5173 : l'écran propose de créer le foyer (compte local owner) ou de se connecter via Authentik si OIDC est configuré.

```bash
pnpm lint        # Biome
pnpm typecheck
pnpm test        # Vitest (domain, i18n, API sur SQLite temporaire)
pnpm build
pnpm db:generate # nouvelle migration Drizzle après modification de apps/api/src/db/schema.ts
```

Mobile (Android) : `cd apps/mobile && pnpm dev`, avec `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OIDC_ISSUER` et `EXPO_PUBLIC_OIDC_CLIENT_ID`.

## Déploiement

```bash
cp .env.example .env   # à compléter
docker compose up -d   # app + sauvegarde Litestream
```

Dans Authentik : une seule application OIDC (client confidentiel) avec deux redirect URIs, `PUBLIC_URL/api/v1/auth/callback` pour le web et `lumo://auth` pour le mobile. Le mobile n'a jamais le secret : il obtient le code par PKCE et l'API l'échange.
