# ADR-0003 — Moteur de devis déterministe, pur et auditable

Date : 2026-11-06 · Statut : **Proposée** · Owner : quote-engineer · Reviewer : backend-engineer, qa-engineer

## Contexte
Un devis faux = perte d'argent ou de confiance. Le devis doit être reproductible des mois plus tard (litige, nouvelle version),
fonctionner hors ligne et expliquer chaque chiffre au vendeur.

## Options
1. Calcul côté serveur (SQL / API) : simple, mais impossible hors ligne et logique dupliquée pour l'aperçu client.
2. Calcul dans l'app avec prix embarqués dans le code : rapide mais viole §1.4 (prix hors base) et non historisable.
3. **Package pur `quote-engine`** exécuté partout (mobile, desktop, web, serveur pour le PDF), alimenté uniquement par des données
   de la base, sans horloge ni réseau, avec `trace[]`.

## Décision
Option 3.
- Entrées explicites : `quoteDate`, mesure, papier peint, `WallpaperPrice`, `LaborRate[]`, `Consumable[]`, `TaxRate[]`, `QuoteSettings`, remise.
- Sortie : lignes + totaux + `trace[]` par ligne + `requiresAdminApproval` + `warnings` (ex. price list > 7 jours).
- Argent : `Cents` (entiers) ; taux en points de base ; arrondi half-up au centime par ligne ; arrondi aux 5 ct sur le total si paramétré.
  Règle ESLint interdisant les littéraux flottants dans le moteur.
- `ENGINE_VERSION` enregistré dans `quotes.engine_version` ; une modification de règle = nouvelle version + jeu de tests de non-régression.
- **Statut « NON VALIDÉ »** tant que les ≥ 40 devis de référence Soufflet ne sont pas passés à 0 rouleau / 0 CHF d'écart. Ce statut est
  exposé par `/health` et dans l'admin ; l'envoi d'un devis est bloqué tant qu'il est actif (levée explicite par l'admin après validation).
- Règles non confirmées (marge de coupe, ouvertures, lots fournisseur, arrondi) = paramètres `organizations.quote_settings` avec défauts documentés.

## Conséquences
- Le serveur ne recalcule jamais « à sa façon » : il exécute le même package pour le PDF et vérifie l'égalité avec les totaux soumis par l'app.
- Les devis de référence Soufflet deviennent des tests (`packages/quote-engine/test/reference/*.json`) — ils sont la condition de sortie de la Phase 1.
- Aucune IA dans le calcul ; une IA peut au mieux proposer une référence de papier peint, jamais un prix ni une quantité.
