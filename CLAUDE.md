# Lumo

Appli de suivi d'habitudes gamifiée pour un foyer, self-hosted (inspirée de HabitTrove, réécrite de zéro). Le plan complet et toutes les décisions sont dans `docs/ARCHITECTURE.md` : lis-le avant toute tâche et respecte-le. Si une demande le contredit, signale-le avant de coder.

## Règles non négociables

- Toute la logique (pièces, droits, récurrence, séries) vit dans `packages/domain`, en TypeScript pur, et le serveur est seul juge. Les clients n'envoient jamais de montant.
- Chaque écriture de pièces passe par `ledger_entries` dans la même transaction que l'action qui la cause. Aucun solde stocké comme vérité.
- Base : SQLite (WAL) via Drizzle + better-sqlite3. Pas de PostgreSQL.
- Toute logique qui touche aux pièces ou aux droits a ses tests avant d'être considérée terminée.
- Ignorer l'import HabitTrove pendant le développement.
- Licence AGPL-3.0 : en-tête `// SPDX-License-Identifier: AGPL-3.0-or-later` dans les fichiers source.

## Conventions

- pnpm workspaces + Turborepo, Node 22, TypeScript strict.
- Biome pour lint et format.
- Conventional Commits.
- Interface et textes en français d'abord, via `packages/i18n`.
- Mobile : Android seulement pour l'instant.

## Avancement

Travailler étape par étape selon la feuille de route de `docs/ARCHITECTURE.md`. Étape 1 (Fondations) livrée, reste à valider la connexion réelle Authentik sur web et mobile. Étape 2 (Cœur métier) livrée : domain testé, API, pièces, virements, envies, stats, critère « 20 validations simultanées » vérifié. Étape en cours : **3. Fronts**.
