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

## Banc de réalisme (conditions de prise de vue d'un client) — propositions, v0

Source : `docs/reports/measurement-realism-bench.md` (`pnpm -s --filter @wallscan/measurement bench:realism`, 32 conditions (témoin compris) × 20 scènes, graines fixes). Les valeurs ci-dessous sont des **propositions** issues du run du 2026-11-08 ; elles deviennent des seuils contraignants après validation de `measurement-engineer` et `lead-architect`. Un seuil ne s'abaisse pas pour faire passer le banc (ADR si irréaliste).

Critère bloquant (veto `qa-engineer`) : **0 fausse mesure silencieuse** = mesure rendue avec erreur > 5 % sur W ou H et aucun avertissement de fiabilité. **Statut au 2026-11-08 : NON RESPECTÉ** (4 cas sur 640, une seule scène, fausse feuille A4 acceptée ; voir le rapport). Tant que ce n'est pas corrigé, le mode automatique reste « non validé ».

> **Mise à jour measurement-engineer, 2026-11-08 (moteur v2)** — après correctif : **0 fausse mesure silencieuse sur 640** (`--n=20`), les
> 4 cas de la scène 14 portent `measure_implausible`, `reference_scale_suspect` et `reference_ambiguous` (+ `image_blurry` pour blur-3 /
> motion-14). Seuils de ce tableau implémentés en codes (`docs/specs/measurement-api.md` §6.5) pour ce que le moteur constate seul :
> netteté (`image_soft` / `image_blurry`), petit côté de la feuille (`reference_small` / `reference_too_small`), k1 (`distortion_strong` /
> `distortion_extreme`), plausibilité (`measure_implausible`). Gondolage et surexposition : non constatables par le moteur. Statut à
> requalifier par `qa-engineer` avec `--n=40` (critère 1) — non requalifié ici. Détails : `docs/reports/measurement-v2-engine.md`.

| Grandeur (image de travail 2048 px) | Sans réserve | Avertir (reprise conseillée) | Refuser la photo |
|---|---|---|---|
| Flou gaussien ajouté σ | ≤ 1 px | 1 – 2 px | ≥ 2 px |
| Flou de bougé horizontal | ≤ 4 px | 4 – 8 px | ≥ 8 px |
| Inclinaison (tangage) / roulis | ≤ 15° / ≤ 8° | — (au-delà non testé) | — |
| Feuille collée de travers | ≤ 7° | — | — |
| Feuille : petit côté (la ligne « objet < 60 px » ci-dessus reste prioritaire jusqu’à validation) | ≥ 55 px | 40 – 55 px | < 40 px (`REFERENCE_MIN_SIDE_PX`) |
| Feuille : grand côté / grand côté de l'image | ≥ 3 % | — | < 3 % (non testé) |
| Gondolage de la feuille | ≤ 2 mm | 2 – 4 mm | ≥ 4 mm |
| Distorsion radiale, k1 estimé (valeur absolue) | ≤ 0,05 | 0,05 – 0,10 | > 0,10 |
| Bruit gaussien σ (niveaux/255) | ≤ 8 | 8 – 14 | > 14 (non testé) |
| Surexposition (feuille saturée) | pas de saturation | ≥ 30 % de pixels saturés sur la feuille | — |
| Plausibilité du résultat | hauteur 150 – 450 cm, largeur 40 – 1500 cm (élargi le 2026-11-08 : pan de mur réel de 87 cm, murs sous rampant) | — | hors bornes : « mesure à vérifier », envoi du devis bloqué |

Critères de non-régression du banc (CI, bloquants) :
1. 0 fausse mesure silencieuse, `--n=40` minimum.
2. Conditions « sans réserve » : p95 de max(W, H) ≤ 3 % sur les mesures rendues, refus déclarés ≤ 40 % (nominal : 15 %).
3. 0 exception du moteur dans toutes les conditions.
4. Toute mesure > 5 % porte au moins un avertissement de fiabilité.

Limites connues : banc synthétique (pas de JPEG, de reflets ni de rolling shutter), 20 scènes par condition ; ces seuils sont à recaler sur le banc terrain (≥ 50 photos de murs réels annotées) dès qu'il existe.
