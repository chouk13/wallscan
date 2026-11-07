# WallScan — Soufflet Décoration

Application mobile + desktop + web : photographier le mur du client, le mesurer, y visualiser un papier peint du catalogue
Soufflet à l'échelle réelle, générer un devis exact, conclure et rattacher au CRM.

Référence complète : [`docs/PROMPT-MAITRE.md`](docs/PROMPT-MAITRE.md) · Architecture : [`docs/architecture.md`](docs/architecture.md) · ADR : [`docs/adr/`](docs/adr/)

## Démarrage

```bash
corepack enable && pnpm install
cp .env.example .env            # remplir Supabase (région EU/CH), stockage, clés
supabase start && supabase db reset   # joue supabase/migrations
pnpm ci                          # lint + typecheck + test + build
pnpm dev                         # api :3001, web :3000, desktop (vite :1420 + tauri), mobile (expo)
```

Prérequis natifs : Node ≥ 22, pnpm 10, Rust stable (Tauri), Xcode / Android Studio (Expo), Supabase CLI.

## Structure

```
apps/        mobile (Expo) · desktop (Tauri 2) · web (Next.js) · api (Fastify)
packages/    core · i18n · config · ui · measurement · vision · render-engine · quote-engine · crm-core · crm-adapters/*
supabase/    migrations SQL (schéma, RLS, triggers d'immuabilité)
docs/        architecture, adr/, reports/, specs/, security/
.claude/     agents/ — l'équipe de 14 agents
```

## Règles non négociables

- Argent en **centimes entiers** (`Cents`), TVA en points de base. Jamais de flottant.
- Prix, TVA, tarifs, remises : **en base, historisés**, jamais dans le code.
- Devis **déterministe** (`packages/quote-engine`), `trace[]` par ligne, immuable après envoi.
- Zéro chaîne UI en dur → `packages/i18n` (FR/DE/IT/EN).
- Photos de domiciles = données personnelles : consentement, rétention, suppression (nLPD/RGPD).
- `quote-engine` et `measurement` : couverture 100 % (seuil CI).
