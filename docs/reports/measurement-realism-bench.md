# Banc de réalisme terrain — mesure d'un mur depuis une photo de téléphone

Généré le 2026-11-08 par `pnpm -s --filter @wallscan/measurement bench:realism` — 20 scènes par condition, graine 20261108, 640 cas.

**Relancer** : `pnpm -s --filter @wallscan/measurement bench:realism` (écrit ce rapport et `dist/realism-results.json`). Durée mesurée : 10 à 13,5 min (3 runs) sur la machine de développement (2 cœurs partagés avec d'autres agents, charge 3–5) avec **n = 20 scènes par condition au lieu de 40** pour rester dans le budget ; ≈ 8 min estimées si les deux cœurs sont libres. `--n=40` pour la version complète (≈ 16–27 min). Comparer à un run antérieur : copier `dist/realism-results.json` vers `dist/realism-before.json`, relancer, puis `node dist/realism.mjs --n=20 --json=dist/realism-after.json --before=dist/realism-before.json --out=<rapport>`. Rejeu d'un cas : `node dist/realism.mjs --only=<condition> --scene=<n°> --verbose=1`.

Runs consignés : « avant » = `src` tel qu'au début de la session (16:45, avant `quality.ts`/`wallRefine.ts`) ; « après » = `src` à 17:19 (`sharpness`, `refineWallQuad`, `fuseQuads` exportés mais non appelés par `measurePhoto`) ; un run intermédiaire à 17:01 a donné exactement les mêmes chiffres.

Exports de `src/index.ts` au moment du run : measurePhoto ✓, detectReference ✓, proposeWallCorners ✓, rectify ✓, refineWallQuad ✓, sharpness ✓, fuseQuads ✓.

## Protocole

- Scènes : `generateCase` du banc synthétique (mur 250–550 × 230–300 cm, plinthe, 0–2 fenêtres, porte, radiateur, prises, cadre, A4 ou mire alternées), rendues par `renderScene` à **2048 px côté long** (le pipeline de production travaille à 2048 px ; pas d'affinage plein résolution ici, donc un peu plus sévère que `bench`). Les **mêmes 20 scènes** servent à toutes les conditions (comparaison appariée), sauf « distance » où une scène non cadrable avec la feuille à X % est remplacée par la suivante.
- Pose nominale « client » (hors dégradation) : lacet ±10°, tangage ±3°, roulis ±1,5°, k1 ∈ ±0,02, distance 2,5–5 m (augmentée si le mur ne tient pas dans le cadre), hauteur d'yeux 1–1,7 m. Une dégradation remplace seulement le paramètre concerné. Inclinaison et roulis modifient la **projection** (matrice de caméra), pas l'image ; signe tiré au hasard par scène.
- Dégradations dans l'image : flou gaussien composé au flou d'objectif (σ0,6–1,2 px) ; bougé = moyenne glissante horizontale ; exposition en lumière linéaire (γ 2,2) avec écrêtage, bruit σ 5 ajouté après la courbe en sous-exposition ; vignettage 30 % = atténuation `1 − 0,3·r²` (r = 1 au coin) ; bruit gaussien final de σ indiqué (nominal 1,5–4) ; feuille gondolée = déplacement sinusoïdal 2D (λ = 0,55 × grand côté de la feuille, amplitude en mm convertie par l'échelle locale, bord de la feuille compris) ; feuille de travers = rotation dans le plan du mur ; meuble = rectangle sombre au sol (teinte 35–70) couvrant X % de la **surface** du mur, hauteur ≤ 120 cm (sous la feuille) ; distance = caméra placée pour que le grand côté de la feuille (29,7 cm) occupe X % du grand côté de l'image.
- Distorsion k1 : modèle de division du dépôt (`src/distortion.ts`), k1 < 0 = barillet (ultra grand-angle). Le moteur n'est pas informé (pas de `distortion` en entrée) et estime k1 sur les lignes du mur.
- Pipeline : `measurePhoto({ work, proposeOpenings: false })` seul (les ouvertures ne changent pas W/H ; gain de temps), **sans aucune intervention** (ni coins, ni référence, ni focale EXIF).
- Erreur = |mesuré − vérité| / vérité sur W et H ; « pire » = max(W, H). Les colonnes `<3 %` et `<5 %` sont des taux **parmi les mesures rendues** ; l'échec déclaré (`failure` non nul : référence ou coins du mur non trouvés, géométrie dégénérée) est compté à part et reste acceptable puisqu'annoncé.
- **Fausse mesure silencieuse** = mesure rendue avec erreur > 5 % et **aucun avertissement de fiabilité** (`survey.checks.warnings` privé de `baseboard_height_required`, simple demande de saisie). Critère bloquant : doit être 0. « Annoncées » = erreur > 5 % avec au moins un avertissement.

## Verdict

- Fausses mesures silencieuses : **0** sur 640 cas — critère bloquant respecté.
- Crashs (exception dans le moteur) : 0.
- Mesures rendues : 405 ; échecs déclarés : 235 ; mesures erronées > 5 % mais annoncées : 16.

## Résultats par condition et par niveau

### Nominal (témoin)

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| aucune dégradation | 20 | 17 | 3 | 0 | 0.03 % | 0.14 % | 0.06 % | 0.23 % | 100 % | 100 % | 0 | **0** | 90 % | 632 ms |

### Flou gaussien

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| σ 1 px | 20 | 17 | 3 | 0 | 0.11 % | 0.89 % | 0.09 % | 0.63 % | 100 % | 100 % | 0 | **0** | 90 % | 525 ms |
| σ 2 px | 20 | 9 | 11 | 0 | 0.10 % | 43.68 % | 0.41 % | 46.20 % | 89 % | 89 % | 1 | **0** | 40 % | 496 ms |
| σ 3 px | 20 | 4 | 16 | 0 | 33.66 % | 71.32 % | 34.00 % | 74.94 % | 50 % | 50 % | 2 | **0** | 15 % | 441 ms |

### Flou de bougé horizontal

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 px | 20 | 15 | 5 | 0 | 0.22 % | 1.32 % | 0.06 % | 0.26 % | 100 % | 100 % | 0 | **0** | 80 % | 531 ms |
| 8 px | 20 | 9 | 11 | 0 | 0.73 % | 43.74 % | 0.04 % | 45.77 % | 89 % | 89 % | 1 | **0** | 45 % | 511 ms |
| 14 px | 20 | 4 | 16 | 0 | 36.86 % | 179.07 % | 33.88 % | 134.50 % | 0 % | 25 % | 3 | **0** | 15 % | 389 ms |

### Inclinaison (pitch)

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 5° | 20 | 17 | 3 | 0 | 0.08 % | 0.24 % | 0.09 % | 2.65 % | 94 % | 94 % | 1 | **0** | 90 % | 481 ms |
| 10° | 20 | 18 | 2 | 0 | 0.06 % | 0.82 % | 0.12 % | 1.44 % | 94 % | 94 % | 1 | **0** | 90 % | 455 ms |
| 15° | 20 | 17 | 3 | 0 | 0.21 % | 1.22 % | 0.18 % | 2.24 % | 94 % | 94 % | 1 | **0** | 85 % | 424 ms |

### Roulis

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2° | 20 | 18 | 2 | 0 | 0.06 % | 0.29 % | 0.05 % | 2.43 % | 94 % | 94 % | 1 | **0** | 90 % | 540 ms |
| 5° | 20 | 17 | 3 | 0 | 0.04 % | 0.16 % | 0.03 % | 2.40 % | 94 % | 94 % | 1 | **0** | 90 % | 469 ms |
| 8° | 20 | 17 | 3 | 0 | 0.04 % | 13.70 % | 0.06 % | 13.75 % | 94 % | 94 % | 1 | **0** | 85 % | 466 ms |

### Distorsion radiale non annoncée

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| k1 −0,05 | 20 | 18 | 2 | 0 | 1.26 % | 1.82 % | 0.76 % | 1.14 % | 100 % | 100 % | 0 | **0** | 95 % | 402 ms |
| k1 −0,12 | 20 | 8 | 12 | 0 | 1.68 % | 3.22 % | 0.87 % | 1.30 % | 88 % | 100 % | 0 | **0** | 95 % | 400 ms |
| k1 −0,25 | 20 | 1 | 19 | 0 | 1.99 % | 1.99 % | 2.17 % | 2.17 % | 100 % | 100 % | 0 | **0** | 90 % | 387 ms |

### Exposition

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sous-exposition −1,5 IL | 20 | 13 | 7 | 0 | 0.12 % | 0.44 % | 0.08 % | 0.42 % | 100 % | 100 % | 0 | **0** | 80 % | 454 ms |
| surexposition +1 IL (feuille saturée) | 20 | 9 | 11 | 0 | 0.92 % | 2.97 % | 1.65 % | 4.19 % | 56 % | 100 % | 0 | **0** | 75 % | 441 ms |
| vignettage 30 % | 20 | 17 | 3 | 0 | 0.03 % | 0.12 % | 0.05 % | 0.23 % | 100 % | 100 % | 0 | **0** | 90 % | 533 ms |

### Bruit gaussien

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| σ 4 | 20 | 16 | 4 | 0 | 0.03 % | 0.15 % | 0.04 % | 0.23 % | 100 % | 100 % | 0 | **0** | 85 % | 505 ms |
| σ 8 | 20 | 13 | 7 | 0 | 0.10 % | 0.56 % | 0.10 % | 0.41 % | 100 % | 100 % | 0 | **0** | 80 % | 449 ms |
| σ 14 | 20 | 7 | 13 | 0 | 0.44 % | 1.62 % | 0.17 % | 0.54 % | 100 % | 100 % | 0 | **0** | 80 % | 396 ms |

### Feuille gondolée

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 mm | 20 | 18 | 2 | 0 | 0.07 % | 0.32 % | 0.10 % | 0.32 % | 100 % | 100 % | 0 | **0** | 90 % | 487 ms |
| 4 mm | 20 | 10 | 10 | 0 | 0.33 % | 0.62 % | 0.10 % | 0.21 % | 100 % | 100 % | 0 | **0** | 50 % | 518 ms |
| 8 mm | 20 | 7 | 13 | 0 | 0.50 % | 70.61 % | 0.33 % | 73.63 % | 71 % | 71 % | 2 | **0** | 10 % | 474 ms |

### Feuille collée de travers

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3° | 20 | 17 | 3 | 0 | 0.04 % | 0.15 % | 0.04 % | 0.09 % | 100 % | 100 % | 0 | **0** | 90 % | 542 ms |
| 7° | 20 | 17 | 3 | 0 | 0.05 % | 0.11 % | 0.02 % | 0.11 % | 100 % | 100 % | 0 | **0** | 90 % | 536 ms |

### Mur masqué par un meuble

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 % du mur | 20 | 2 | 18 | 0 | 0.00 % | 0.00 % | 0.01 % | 0.01 % | 100 % | 100 % | 0 | **0** | 90 % | 426 ms |
| 25 % du mur | 20 | 2 | 18 | 0 | 0.02 % | 0.02 % | 0.04 % | 0.05 % | 100 % | 100 % | 0 | **0** | 65 % | 392 ms |

### Distance (taille de la feuille)

| Niveau | n | Mesures | Échec déclaré | Crash | W p50 | W p95 | H p50 | H p95 | < 3 % | < 5 % | Annoncées > 5 % | **Silencieuses** | Réf. OK | t p50 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3 % du grand côté | 20 | 15 | 5 | 0 | 0.21 % | 1.05 % | 0.30 % | 1.06 % | 100 % | 100 % | 0 | **0** | 80 % | 488 ms |
| 5 % du grand côté | 20 | 18 | 2 | 0 | 0.06 % | 0.18 % | 0.08 % | 2.06 % | 94 % | 94 % | 1 | **0** | 90 % | 466 ms |
| 9 % visé (plafonné par le cadrage du mur entier) | 20 | 18 | 2 | 0 | 0.03 % | 0.24 % | 0.02 % | 0.12 % | 100 % | 100 % | 0 | **0** | 95 % | 460 ms |

- 3 % du grand côté : grand côté de la feuille réellement à 3.0 % (min 3.0 %) du grand côté de l'image, petit côté 43 px (min 42 px).
- 5 % du grand côté : grand côté de la feuille réellement à 4.9 % (min 3.6 %) du grand côté de l'image, petit côté 71 px (min 53 px).
- 9 % visé (plafonné par le cadrage du mur entier) : grand côté de la feuille réellement à 6.6 % (min 6.1 %) du grand côté de l'image, petit côté 95 px (min 88 px).

## Netteté mesurée par `sharpness` (score ≈ 1 / largeur du flou en px, image de travail)

| Condition | Niveau | Score min | p50 | max | Mesure > 5 % ou échec déclaré parmi les scores < 0,5 |
|---|---|---|---|---|---|
| Nominal (témoin) | aucune dégradation | 0.74 | 0.83 | 1.03 | 0 / 0 |
| Flou gaussien | σ 1 px | 0.58 | 0.64 | 0.73 | 0 / 0 |
| Flou gaussien | σ 2 px | 0.35 | 0.43 | 0.46 | 12 / 20 |
| Flou gaussien | σ 3 px | 0.33 | 0.33 | 0.33 | 18 / 20 |
| Flou de bougé horizontal | 4 px | 0.55 | 0.61 | 0.67 | 0 / 0 |
| Flou de bougé horizontal | 8 px | 0.33 | 0.34 | 0.35 | 12 / 20 |
| Flou de bougé horizontal | 14 px | 0.33 | 0.33 | 0.43 | 19 / 20 |
| Exposition | sous-exposition −1,5 IL | 0.70 | 0.85 | 1.02 | 0 / 0 |
| Exposition | surexposition +1 IL (feuille saturée) | 0.71 | 0.96 | 1.14 | 0 / 0 |
| Exposition | vignettage 30 % | 0.73 | 0.82 | 1.03 | 0 / 0 |
| Bruit gaussien | σ 4 | 0.73 | 0.84 | 1.03 | 0 / 0 |
| Bruit gaussien | σ 8 | 0.72 | 0.85 | 1.02 | 0 / 0 |
| Bruit gaussien | σ 14 | 0.68 | 0.83 | 1.02 | 0 / 0 |
| Distance (taille de la feuille) | 3 % du grand côté | 0.52 | 0.78 | 0.99 | 0 / 0 |
| Distance (taille de la feuille) | 5 % du grand côté | 0.71 | 0.83 | 1.03 | 0 / 0 |
| Distance (taille de la feuille) | 9 % visé (plafonné par le cadrage du mur entier) | 0.75 | 0.92 | 1.03 | 0 / 0 |

## Ce qui dégrade le plus la mesure

Classement par part de scènes non mesurées correctement (échec déclaré + mesures ≥ 5 %), niveau par niveau :

| # | Condition | Niveau | Échec déclaré | Mesures ≥ 5 % (sur n) | W/H p95 pire | Silencieuses |
|---|---|---|---|---|---|---|
| 1 | Flou de bougé horizontal | 14 px | 16 / 20 | 3 / 20 | 179.14 % | 0 |
| 2 | Distorsion radiale non annoncée | k1 −0,25 | 19 / 20 | 0 / 20 | 2.17 % | 0 |
| 3 | Flou gaussien | σ 3 px | 16 / 20 | 2 / 20 | 74.94 % | 0 |
| 4 | Mur masqué par un meuble | 10 % du mur | 18 / 20 | 0 / 20 | 0.01 % | 0 |
| 5 | Mur masqué par un meuble | 25 % du mur | 18 / 20 | 0 / 20 | 0.05 % | 0 |
| 6 | Feuille gondolée | 8 mm | 13 / 20 | 2 / 20 | 73.63 % | 0 |
| 7 | Bruit gaussien | σ 14 | 13 / 20 | 0 / 20 | 1.62 % | 0 |
| 8 | Flou gaussien | σ 2 px | 11 / 20 | 1 / 20 | 46.20 % | 0 |
| 9 | Flou de bougé horizontal | 8 px | 11 / 20 | 1 / 20 | 46.30 % | 0 |
| 10 | Distorsion radiale non annoncée | k1 −0,12 | 12 / 20 | 0 / 20 | 3.22 % | 0 |
| 11 | Exposition | surexposition +1 IL (feuille saturée) | 11 / 20 | 0 / 20 | 4.19 % | 0 |
| 12 | Feuille gondolée | 4 mm | 10 / 20 | 0 / 20 | 0.62 % | 0 |

Témoin nominal : 17/20 mesures, p95 pire(W,H) 0.23 %, < 3 % : 100 %, échec déclaré : 3.

## Ce qui est annoncé correctement

Conditions où le moteur produit des mesures > 5 % **toutes accompagnées d'un avertissement**, ou refuse de mesurer (échec déclaré), et jamais de silencieuse :

| Condition | Niveau | Échec déclaré | Mesures > 5 % annoncées | Silencieuses |
|---|---|---|---|---|
| Flou gaussien | σ 1 px | 3 / 20 | 0 | 0 |
| Flou gaussien | σ 2 px | 11 / 20 | 1 | 0 |
| Flou gaussien | σ 3 px | 16 / 20 | 2 | 0 |
| Flou de bougé horizontal | 4 px | 5 / 20 | 0 | 0 |
| Flou de bougé horizontal | 8 px | 11 / 20 | 1 | 0 |
| Flou de bougé horizontal | 14 px | 16 / 20 | 3 | 0 |
| Inclinaison (pitch) | 5° | 3 / 20 | 1 | 0 |
| Inclinaison (pitch) | 10° | 2 / 20 | 1 | 0 |
| Inclinaison (pitch) | 15° | 3 / 20 | 1 | 0 |
| Roulis | 2° | 2 / 20 | 1 | 0 |
| Roulis | 5° | 3 / 20 | 1 | 0 |
| Roulis | 8° | 3 / 20 | 1 | 0 |
| Distorsion radiale non annoncée | k1 −0,05 | 2 / 20 | 0 | 0 |
| Distorsion radiale non annoncée | k1 −0,12 | 12 / 20 | 0 | 0 |
| Distorsion radiale non annoncée | k1 −0,25 | 19 / 20 | 0 | 0 |
| Exposition | sous-exposition −1,5 IL | 7 / 20 | 0 | 0 |
| Exposition | surexposition +1 IL (feuille saturée) | 11 / 20 | 0 | 0 |
| Exposition | vignettage 30 % | 3 / 20 | 0 | 0 |
| Bruit gaussien | σ 4 | 4 / 20 | 0 | 0 |
| Bruit gaussien | σ 8 | 7 / 20 | 0 | 0 |
| Bruit gaussien | σ 14 | 13 / 20 | 0 | 0 |
| Feuille gondolée | 2 mm | 2 / 20 | 0 | 0 |
| Feuille gondolée | 4 mm | 10 / 20 | 0 | 0 |
| Feuille gondolée | 8 mm | 13 / 20 | 2 | 0 |
| Feuille collée de travers | 3° | 3 / 20 | 0 | 0 |
| Feuille collée de travers | 7° | 3 / 20 | 0 | 0 |
| Mur masqué par un meuble | 10 % du mur | 18 / 20 | 0 | 0 |
| Mur masqué par un meuble | 25 % du mur | 18 / 20 | 0 | 0 |
| Distance (taille de la feuille) | 3 % du grand côté | 5 / 20 | 0 | 0 |
| Distance (taille de la feuille) | 5 % du grand côté | 2 / 20 | 1 | 0 |
| Distance (taille de la feuille) | 9 % visé (plafonné par le cadrage du mur entier) | 2 / 20 | 0 | 0 |

Avertissements présents sur les mesures > 5 % : `measure_implausible` ×9, `reference_ambiguous` ×9, `reference_scale_suspect` ×8, `image_blurry` ×7, `floor_line_ambiguous` ×7, `reference_aspect_mismatch` ×6, `uncertainty_above_display_tolerance` ×2, `reference_too_small` ×1, `reference_small` ×1.
Motifs d'échec déclaré : `no_reference` ×137, `no_wall_corners` ×98.

## Avant / après (même graine, mêmes scènes)

| Condition | Niveau | Échec déclaré avant → après | pire p95 avant → après | < 5 % avant → après | Silencieuses avant → après |
|---|---|---|---|---|---|
| Nominal (témoin) | aucune dégradation | 3 → 3 | 0.23 → 0.23 % | 100 → 100 % | 0 → 0 |
| Flou gaussien | σ 1 px | 3 → 3 | 0.89 → 0.89 % | 100 → 100 % | 0 → 0 |
| Flou gaussien | σ 2 px | 11 → 11 | 46.20 → 46.20 % | 89 → 89 % | 0 → 0 |
| Flou gaussien | σ 3 px | 16 → 16 | 74.94 → 74.94 % | 50 → 50 % | 1 → 0 |
| Flou de bougé horizontal | 4 px | 5 → 5 | 1.32 → 1.32 % | 100 → 100 % | 0 → 0 |
| Flou de bougé horizontal | 8 px | 11 → 11 | 46.30 → 46.30 % | 89 → 89 % | 0 → 0 |
| Flou de bougé horizontal | 14 px | 16 → 16 | 179.14 → 179.14 % | 25 → 25 % | 1 → 0 |
| Inclinaison (pitch) | 5° | 3 → 3 | 2.65 → 2.65 % | 94 → 94 % | 0 → 0 |
| Inclinaison (pitch) | 10° | 2 → 2 | 1.51 → 1.51 % | 94 → 94 % | 0 → 0 |
| Inclinaison (pitch) | 15° | 3 → 3 | 2.52 → 2.52 % | 94 → 94 % | 0 → 0 |
| Roulis | 2° | 2 → 2 | 2.64 → 2.64 % | 94 → 94 % | 0 → 0 |
| Roulis | 5° | 3 → 3 | 2.44 → 2.44 % | 94 → 94 % | 0 → 0 |
| Roulis | 8° | 3 → 3 | 13.77 → 13.77 % | 94 → 94 % | 1 → 0 |
| Distorsion radiale non annoncée | k1 −0,05 | 2 → 2 | 1.82 → 1.82 % | 100 → 100 % | 0 → 0 |
| Distorsion radiale non annoncée | k1 −0,12 | 12 → 12 | 3.22 → 3.22 % | 100 → 100 % | 0 → 0 |
| Distorsion radiale non annoncée | k1 −0,25 | 19 → 19 | 2.17 → 2.17 % | 100 → 100 % | 0 → 0 |
| Exposition | sous-exposition −1,5 IL | 7 → 7 | 0.44 → 0.44 % | 100 → 100 % | 0 → 0 |
| Exposition | surexposition +1 IL (feuille saturée) | 11 → 11 | 4.19 → 4.19 % | 100 → 100 % | 0 → 0 |
| Exposition | vignettage 30 % | 3 → 3 | 0.23 → 0.23 % | 100 → 100 % | 0 → 0 |
| Bruit gaussien | σ 4 | 4 → 4 | 0.23 → 0.23 % | 100 → 100 % | 0 → 0 |
| Bruit gaussien | σ 8 | 7 → 7 | 0.56 → 0.56 % | 100 → 100 % | 0 → 0 |
| Bruit gaussien | σ 14 | 13 → 13 | 1.62 → 1.62 % | 100 → 100 % | 0 → 0 |
| Feuille gondolée | 2 mm | 2 → 2 | 0.44 → 0.44 % | 100 → 100 % | 0 → 0 |
| Feuille gondolée | 4 mm | 10 → 10 | 0.62 → 0.62 % | 100 → 100 % | 0 → 0 |
| Feuille gondolée | 8 mm | 13 → 13 | 73.63 → 73.63 % | 71 → 71 % | 1 → 0 |
| Feuille collée de travers | 3° | 3 → 3 | 0.15 → 0.15 % | 100 → 100 % | 0 → 0 |
| Feuille collée de travers | 7° | 3 → 3 | 0.14 → 0.14 % | 100 → 100 % | 0 → 0 |
| Mur masqué par un meuble | 10 % du mur | 18 → 18 | 0.01 → 0.01 % | 100 → 100 % | 0 → 0 |
| Mur masqué par un meuble | 25 % du mur | 18 → 18 | 0.05 → 0.05 % | 100 → 100 % | 0 → 0 |
| Distance (taille de la feuille) | 3 % du grand côté | 5 → 5 | 1.75 → 1.75 % | 100 → 100 % | 0 → 0 |
| Distance (taille de la feuille) | 5 % du grand côté | 2 → 2 | 2.06 → 2.06 % | 94 → 94 % | 0 → 0 |
| Distance (taille de la feuille) | 9 % visé (plafonné par le cadrage du mur entier) | 2 → 2 | 0.27 → 0.27 % | 100 → 100 % | 0 → 0 |

## Constats (rédigés d'après le run du 2026-11-08, n = 20)

1. **Seul défaut bloquant : une fausse référence A4 acceptée sans avertissement** (4 cas, une seule scène : n° 14, graine 20371974, A4, mur 464,6 × 248,8 cm). Quand la vraie feuille est trop dégradée pour être trouvée (flou σ 3, bougé 14 px, gondolage 8 mm, roulis 8°), le détecteur retient un autre rectangle clair de proportion A4, à ≈ 500 px de la vraie feuille, et le moteur rend **153 × 81 cm** au lieu de 465 × 249 (−67 %) sans aucun avertissement : les coins du mur sont justes (< 3 px) et la fausse feuille a le bon rapport d'aspect, donc aucun des contrôles actuels ne se déclenche. La même scène en nominal est mesurée à 0,02 %. Rejeu : `node dist/realism.mjs --only=blur-3 --scene=14 --verbose=1`. Les quatre mesures rendent une hauteur de mur de 81 cm : une **garde de plausibilité** sur le résultat (hauteur hors [180 ; 450] cm, largeur hors [100 ; 1200] cm → avertissement bloquant « mesure à vérifier ») les aurait toutes annoncées. Les mêmes dégradations sur une mire (scène 13) donnent une fausse mire à 76 % d'erreur, annoncée uniquement parce que son rapport d'aspect est faux (`reference_aspect_mismatch`) : la protection est fortuite.
2. **Erreurs 5–12 % annoncées par un seul avertissement faible.** Scène 17 (mire) : les coins du bas du mur sont faux de ≈ 100 px (ligne de plinthe prise pour le sol), erreur 12 % dans 4 conditions (tangage 5°, roulis 2° et 5°, distance 5 %) ; scène 0 en tangage 10°–15° : coins faux de ≈ 49 px, erreurs 5–7 %. Dans tous ces cas seul `floor_line_ambiguous` (± `uncertainty_above_display_tolerance`) prévient : c'est correct, mais l'interface doit le traiter comme bloquant pour l'envoi du devis, pas comme un conseil.
3. **La précision ne se dégrade pas** avec le tangage (≤ 15°), le roulis (≤ 8°), la feuille de travers (≤ 7°), le vignettage 30 %, le bruit (≤ σ 14) ni la distance : quand une mesure est rendue, elle est dans 3 % (surexposition +1 IL : jusqu'à 4,2 %, 56 % des mesures sous 3 %). **C'est la détection qui s'effondre**, d'où des refus : flou σ ≥ 2 px (11/20 sans référence), bougé ≥ 8 px (11/20), gondolage ≥ 4 mm (10/20, 13/20 à 8 mm), distorsion k1 ≤ −0,12 (12/20 puis 19/20), bruit σ 14 (13/20), meuble (18/20 sans coins du mur : le bas du mur est caché, refus correct mais très fréquent). Ces refus sont déclarés, donc acceptables, mais le vendeur retombe sur la saisie manuelle.
4. **Distorsion non annoncée** : biais systématique sur W de 1,3 % (k1 −0,05) à 1,7 % (−0,12), p95 3,2 % : la correction de distorsion est sous-dimensionnée pour les ultra grand-angle, mais sans fausse mesure.
5. **`sharpness` ne discrimine pas dans ce banc** : sur les 60 images floues gaussiennes et 60 de bougé, aucune ne passe sous le seuil « blurry » (0,26) ; les 60 flous gaussiens (σ 1 à 3) sont tous « soft », mais 11/20 des images nominales aussi (bougé : 58/60). Un seuil de refus à 0,5 écarte 55 images sur 640 dont 17 bonnes mesures et seulement 4 des 16 mesures > 5 %. Piste : dans ce banc le bruit est ajouté **après** le flou (comme sur un capteur), ce qui gonfle les dérivées secondes ; le seuil a été calibré sur bench/sharpness.ts, à recaler avec le bruit après flou et sur de vraies photos JPEG.
6. **Moteur inchangé** : `measurePhoto` n'appelle pas encore `sharpness`, `refineWallQuad` ni `fuseQuads` au moment du run « après » : les colonnes avant/après sont identiques (écarts de la condition « distance » dus au remplacement de scènes non cadrables, pas au moteur).
7. Limites du banc : images de travail à 2048 px rendues directement (pas de JPEG, pas de rolling shutter, pas de HDR, pas de reflets), une seule teinte de feuille, un seul type de meuble ; 20 scènes par condition donnent une borne haute à 95 % de ≈ 14 % de fausses mesures silencieuses par condition (≈ 0,5 % sur les 640 cas, mais les 4 cas observés sont **un seul défaut de scène** : la variété des scènes compte plus que le nombre de dégradations ; relancer avec `--n=40` ou plus avant toute conclusion de type « 0 »).

## Seuils proposés (quand le module doit refuser la photo plutôt que mesurer)

Principe : on refuse (demande de reprise ou de saisie manuelle) quand le banc montre que **la détection échoue plus d'une fois sur deux** ou qu'une mesure fausse peut passer ; on avertit quand la précision se dégrade mais reste < 5 %. Les valeurs sont exprimées sur l'image de travail (2048 px côté long) et sont des **propositions à valider** par `measurement-engineer` ; un seuil ne doit jamais être abaissé pour faire passer le banc (ADR si irréaliste).

| Grandeur | Mesure sans réserve | Avertir (conseil de reprise) | Refuser la photo | Preuve dans le banc |
|---|---|---|---|---|
| Flou gaussien ajouté (σ, px) | ≤ 1 | 1 à 2 | ≥ 2 | σ 1 : 3/20 refus (= nominal), p95 0,9 % ; σ 2 : 11/20 refus + 1 mesure à 46 % ; σ 3 : 16/20 + 1 silencieuse |
| Flou de bougé horizontal (px) | ≤ 4 | 4 à 8 | ≥ 8 | 4 px : 5/20 refus, p95 1,3 % ; 8 px : 11/20 + 1 mesure à 46 % ; 14 px : 16/20 + 1 silencieuse |
| Inclinaison (tangage) | ≤ 15° | — | non justifié jusqu'à 15° | p95 pire 1,5–2,7 % à 5°, 10°, 15° ; au-delà de 15° non testé |
| Roulis | ≤ 8° | — | non justifié jusqu'à 8° | p95 pire ≤ 2,6 % hors scène 14 ; au-delà de 8° non testé |
| Feuille collée de travers | ≤ 7° | — | non justifié | p95 pire 0,15 % à 3° et 7° |
| Taille de la feuille (petit côté, px) | ≥ 55 | 40 à 55 | < 40 (= `REFERENCE_MIN_SIDE_PX`) | 3 % du grand côté (petit côté 42 px) : 5/20 refus, p95 1,1 % ; la précision ne dépend pas de la taille, la détection oui |
| Taille de la feuille (grand côté / grand côté de l'image) | ≥ 3 % | — | < 3 % (non testé : refuser par prudence) | 3 % à 6,6 % testés, p95 pire ≤ 2,1 % ; le cadrage du mur entier plafonne la feuille à ≈ 6,6 % (min 6,1 %) |
| Gondolage de la feuille | ≤ 2 mm | 2 à 4 mm | ≥ 4 mm (invérifiable en pratique : demander de plaquer la feuille) | 2 mm : 2/20 refus ; 4 mm : 10/20 ; 8 mm : 13/20 + 1 silencieuse |
| Distorsion radiale (k1 estimé, valeur absolue) | ≤ 0,05 | 0,05 à 0,10 | > 0,10 | k1 −0,05 : biais 1,3 % ; −0,12 : 12/20 refus, p95 3,2 % ; −0,25 : 19/20 refus |
| Meuble masquant le bas du mur | — | — | coins bas du mur non trouvés (déjà le cas) | 10 % et 25 % : 18/20 refus, aucune fausse mesure |
| Bruit gaussien (σ, niveaux/255) | ≤ 8 | 8 à 14 | > 14 (non testé) | σ 14 : 13/20 refus mais p95 pire 1,6 % |
| Surexposition (feuille saturée) | pas de saturation | feuille ≥ 255 sur > 30 % de ses pixels | — | +1 IL : 11/20 refus, p95 pire 4,2 % |
| **Plausibilité du résultat (nouveau)** | hauteur ∈ [180 ; 450] cm et largeur ∈ [100 ; 1200] cm | — | hors bornes → « mesure à vérifier », envoi du devis bloqué | les 4 fausses mesures silencieuses rendent 81 cm de haut |

Critères du banc en CI (une régression bloque le merge) :
1. **0 fausse mesure silencieuse** sur l'ensemble des conditions, `--n=40` au moins (bloquant).
2. Dans les conditions « sans réserve » (flou ≤ 1 px, bougé ≤ 4 px, tangage ≤ 15°, roulis ≤ 8°, travers ≤ 7°, k1 ≥ −0,05, bruit ≤ σ 8, gondolage ≤ 2 mm, vignettage, sous-exposition, distance 3–9 %) : p95 de max(W, H) ≤ 3 % sur les mesures rendues et refus déclarés ≤ 40 % (nominal : 15 %).
3. Aucun crash (exception) dans aucune condition.
4. Toute mesure > 5 % porte au moins un avertissement de fiabilité ; la part des mesures > 5 % ne reposant que sur `floor_line_ambiguous` est suivie (cible : 0 une fois la ligne de plinthe fiabilisée).

## Mise à jour du 2026-11-08 (measurement-engineer, moteur v2) — à lire avant les « Constats » ci-dessus

Le run de ce rapport a été fait sur le moteur v2 (`src` à 18 h 40) ; la colonne « avant » de la section « Avant / après » est le run
QA de 17 h 19 (`dist/realism-before.json`). Les constats 1, 5 et 6 (texte figé dans `bench/realism.ts`) décrivent l'état **avant**
correctif et sont dépassés :

- **Fausses mesures silencieuses : 4 → 0 / 640.** Les 4 cas de la scène 14 (fausse feuille A4 à ≈ 500 px, 153 × 81 cm) portent
  maintenant `measure_implausible` + `reference_scale_suspect` + `reference_ambiguous` (+ `image_blurry` pour blur-3 et motion-14) ;
  confiance plafonnée à 0,5. Trois gardes indépendantes, aucune ne dépend de la qualité de la fausse feuille.
- **Netteté** : `sharpness` remplacée par une estimation de la largeur de flou (`blurPx`, robuste au bruit ajouté après le flou).
  Sur ce banc : flou σ 2 et σ 3 → 40/40 `blurry` ; bougé 8 et 14 px → 40/40 `blurry` ; nominal, bruit σ 4 / 8 / 14, exposition →
  0 image écartée (`blurry`) ; bougé 4 px → 4/20 `soft`. Le tableau « Netteté » montre `score` = 1 / `blurPx` : < 0,5 ⇔ flou > 2 px.
- Précision et taux d'échec déclaré **inchangés** dans toutes les conditions (le banc n'appelle `measurePhoto` qu'avec l'image de
  travail : l'affinage pleine résolution v2 n'y intervient pas). Coût : les bonnes mesures (< 3 %) portant un avertissement passent de
  53 à 136 / 383, dont 68 `reference_small` (feuille 40–55 px, seuil QA), 25 `reference_ambiguous` (essentiellement une même scène
  répétée, qui contient un second rectangle de format A4), 18 `image_blurry` (photos floues que la politique QA refuse même si la
  mesure est bonne) et 20 codes de distorsion forte / extrême (conditions k1).
