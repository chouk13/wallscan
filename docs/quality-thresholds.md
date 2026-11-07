# Seuils de qualité (qa-engineer) — v0, à confirmer avec le benchmark terrain

| Domaine | Seuil | Mesure |
|---|---|---|
| Couverture `quote-engine`, `measurement` | 100 % lignes/branches/fonctions | vitest coverage (CI bloquante) |
| Devis de référence Soufflet | 0 rouleau et 0 CHF d'écart sur ≥ 40 cas | tests `quote-engine/test/reference` |
| Mesure AR | écart ≤ 2 % vs laser sur 20 murs | benchmark terrain |
| Mesure objet de référence | écart ≤ 5 % vs laser ; confiance < 0.8 si objet < 60 px | benchmark terrain |
| Corrections manuelles | < 20 % des mesures à 3 mois | métriques prod |
| Rendu | prévisualisation < 100 ms (milieu de gamme), HD < 3 s | Maestro / Playwright + traces |
| i18n | 0 clé manquante | test `i18n` |
