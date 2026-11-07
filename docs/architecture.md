# WallScan — Architecture

Owner : `lead-architect` · Mise à jour : 2026-11-06 · Statut : Phase 0

Référence : [`PROMPT-MAITRE.md`](./PROMPT-MAITRE.md). Décisions : [`adr/`](./adr/).

## 1. Vue d'ensemble

```
            ┌───────────────┐   ┌────────────────┐   ┌──────────────────┐
            │  apps/mobile  │   │  apps/desktop  │   │     apps/web     │
            │ Expo / RN     │   │ Tauri 2 + Vite │   │ Next.js          │
            │ visite domicile│  │ showroom       │   │ admin + partage  │
            └──────┬────────┘   └───────┬────────┘   └────────┬─────────┘
                   │  packages/* (TypeScript partagé, zéro duplication)  │
   ┌───────────────┴───────────────────────────────────────────────────┴───────┐
   │ ui · i18n · config(tokens) · core(money, domain) · measurement · vision    │
   │ render-engine · quote-engine · crm-core · crm-adapters/{internal,bexio,…} │
   └───────────────────────────────────┬───────────────────────────────────────┘
                                       │ tRPC / HTTPS
                              ┌────────┴─────────┐
                              │    apps/api      │  Fastify, pg-boss (sync CRM)
                              └────────┬─────────┘
                 ┌─────────────────────┼─────────────────────┐
        ┌────────┴────────┐  ┌─────────┴─────────┐  ┌────────┴────────┐
        │ Supabase Postgres│  │ Storage S3 (EU/CH)│  │ CRM externe     │
        │ RLS org_id, Auth │  │ photos/rendus/tex │  │ Bexio, HubSpot… │
        └─────────────────┘  └───────────────────┘  └─────────────────┘
```

## 2. Le parcours en 5 étapes et qui fait quoi

| Étape | Package | Entrée | Sortie | Phase |
|---|---|---|---|---|
| Capturer | apps (caméra/import) | photo ≤ 4096 px | `photos` | 1 |
| Mesurer | `measurement` (+ modules AR natifs) | AR / objet de référence / saisie | `WallMeasurement{width, height, area, openings, method, confidence}` | 0 (manuel), 1 (référence), 2 (AR) |
| Visualiser | `vision` + `render-engine` | photo, 4 coins, texture calibrée | rendu GPU, lés | 1–2 |
| Chiffrer | `quote-engine` | mesure, papier peint, price list, taux, tarifs | `QuoteOutput` + `trace[]` | 1 |
| Conclure | `api` + `crm-core` | devis | PDF, lien, deal CRM | 1 (PDF), 3 (CRM) |

## 3. Invariants d'architecture

1. **Logique métier uniquement dans `packages/*`**, pure, testée. Les apps ne contiennent que UI, I/O et glue.
2. **Argent en centimes entiers** (`Cents`, `packages/core/src/money.ts`) ; taux en points de base. Une règle ESLint
   interdit les littéraux flottants dans `quote-engine`.
3. **Le moteur de devis ne connaît ni l'heure ni le réseau** : la date du devis est une entrée, les prix sont des entrées.
   Même entrées → même sortie ; `engine_version` stocké avec chaque devis pour rejouer un calcul à l'identique.
4. **Prix, TVA, tarifs, remises vivent en base**, historisés par `valid_from/valid_to`, jamais écrasés
   (`supabase/migrations/0001_init.sql`). Le rôle `client` ne voit jamais `purchase_price` (vue `wallpaper_prices_public`).
5. **Devis envoyé = immuable** : trigger Postgres `quotes_immutable` ; toute modification crée une nouvelle `version`.
   Numéro légal attribué à l'envoi par `next_quote_number(org)` (compteur verrouillé, sans trou).
6. **RLS par `org_id`** sur toutes les tables ; tables filles via jointure parent.
7. **Offline-first mobile** : SQLite local (catalogue, prix horodatés, murs, devis brouillons, dernier rendu), file de sync
   différée, conflits explicites. Détail en ADR-0004 (Phase 2).
8. **CRM = port** (`crm-core`) ; les adaptateurs sont les seuls à importer un SDK CRM. `InternalCrm` est le défaut.
9. **Données personnelles** : photos de domiciles = données personnelles (nLPD/RGPD) — consentement, rétention,
   soft-delete puis purge du stockage objet. Régions EU/CH uniquement.
10. **i18n** : `packages/i18n` ; FR source, DE/IT/EN ; un test CI échoue si une clé manque.

## 4. Flux de données clés

### Mesure → devis
`measurement` produit `WallMeasurement` ; si `confidence < 0.8` l'UI affiche la bannière « Mesure à vérifier ».
Toute correction passe par `applyCorrection` qui marque `correctedByUser` (métrique §4.5).
`quote-engine` reçoit la mesure + le papier peint + les données tarifaires valides à `quoteDate` et renvoie les lignes avec `trace[]`.

### Devis → envoi
API : `draft` → attribution du numéro → `sent` (immuable) → PDF (react-pdf/Typst) → lien signé → `viewed` / `accepted` (IP, horodatage) → CRM (`createDeal`, `attachFile`, `logActivity`) via pg-boss avec `idempotency_key`.

### Sync offline (Phase 2)
Delta par `updated_at` ; les brouillons de devis sont locaux jusqu'à l'envoi ; un devis ne peut être envoyé qu'en ligne
(numérotation légale serveur). Price list locale > 7 jours → avertissement « prix à confirmer ».

## 5. Structure du dépôt

```
apps/mobile  apps/desktop  apps/web  apps/api
packages/ui  packages/core  packages/measurement  packages/render-engine  packages/vision
packages/quote-engine  packages/crm-core  packages/crm-adapters/{internal,bexio,hubspot,webhook}
packages/i18n  packages/config
supabase/migrations  docs/adr  docs/reports  docs/specs  docs/security  .claude/agents
```

## 6. Risques techniques identifiés (à ne pas sous-estimer)

| Risque | Impact | Mitigation |
|---|---|---|
| Textures seamless HD calibrées inexistantes chez les fournisseurs | Rendu à l'échelle impossible | Question bloquante n°3 ; prévoir un atelier de numérisation d'échantillons (coût à chiffrer) |
| Précision de la mesure par objet de référence sur photo importée (perspective, distorsion d'objectif) | Devis faux | Confiance affichée, bannière < 0.8, correction obligatoire avant envoi, benchmark laser 20 murs |
| AR Expo : pas de module ARKit/ARCore officiel maintenu | Phase 2 glisse | Module natif Expo Modules maison (iOS d'abord) ; ADR-0002 |
| Règles de rouleaux non confirmées par Soufflet | 40 devis de référence impossibles | Paramètres `quote_settings` ; statut « NON VALIDÉ » affiché tant que le jeu de référence manque |
| Hébergement Supabase : pas de région Suisse native | nLPD | Région EU (Francfort) + DPA, ou Postgres auto-hébergé CH (ADR-0001) |
