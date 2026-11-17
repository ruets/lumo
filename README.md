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
pnpm --filter @lumo/api openapi:generate     # spec OpenAPI après changement de route (testée par la CI)
pnpm --filter @lumo/api-client generate      # client typé depuis la spec
```

Mobile : `cd apps/mobile && pnpm dev`. L'appli demande l'adresse du serveur au premier lancement (un seul APK pour tous les foyers) ; `EXPO_PUBLIC_API_URL` ne fait que pré-remplir ce champ en développement.

## Déploiement

```bash
cp .env.example .env   # à compléter
docker compose up -d   # app + sauvegarde Litestream
```

Dans Authentik : une seule application OIDC (client confidentiel) avec deux redirect URIs, `PUBLIC_URL/api/v1/auth/callback` pour le web et `lumo://auth` pour le mobile. Le mobile n'a jamais le secret : il obtient le code par PKCE et l'API l'échange.
