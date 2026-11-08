# Banc synthétique — mesure d'un mur depuis une photo

Généré par `pnpm --filter @wallscan/measurement bench` — 500 cas, graine 20261107, 2026-11-08.

## Protocole

- Rasteriseur maison (`packages/measurement/bench/raster.ts`) : pièce vue de l'intérieur (mur du fond, plafond, sol avec lames, murs latéraux), caméra sténopé avec distorsion radiale (modèle de division, k1 ∈ [−0,02 ; 0,02]), focale 24–28 mm équiv., distance 2,5–5 m, angles lacet/tangage/roulis ±15°, images 12 Mpx (4000 × 3000 majoritaire, portrait 3000 × 4000, 8 Mpx), flou d'objectif σ 0,6–1,2 px, bruit gaussien σ 1,5–4, éclairage dégradé ±12 %, vignettage ≤ 15 %.
- Mur W ∈ [250 ; 550] cm × H ∈ [230 ; 300] cm, teinte blanche (30 %), claire (40 %) ou foncée (30 %) ; plinthe réelle de 5–14 cm dans 85 % des cas ; 0–2 fenêtres, 0–1 porte, 0–1 radiateur, prises et cadre comme distracteurs ; feuille A4 ou mire (50/50) au centre, à hauteur des yeux, tournée de ±2°.
- Pipeline **sans intervention humaine** : `measurePhoto` = `detectReference` (sur l'image de travail ≤ 2048 px, coins affinés sur l'image pleine résolution) → `proposeWallCorners` → `estimateRadialDistortion` → `refineCorners` → `rectify` → `warpToPlane` → `proposeBaseboard` → `proposeOpenings`.
- Un cas compte comme **mesuré** seulement si la référence est détectée (bonne nature, coins à < 6 px de la vérité) et les coins du mur proposés sont à < 40 px ; tout autre cas est un **échec signalé** (`null` / avertissement), jamais une mesure silencieuse.

## Résultats globaux

| Indicateur | Valeur |
|---|---|
| Référence détectée (bonne nature, coins < 6 px) | 480 / 500 (96.0 %) |
| Fausses détections de référence (mauvaise nature ou > 6 px) | 7 |
| Coins du mur proposés (non nul) | 463 / 500 |
| Coins du mur à < 3 px / < 10 px de la vérité | 98.1 % / 98.1 % |
| Cas mesurés automatiquement de bout en bout | 444 / 500 |
| Temps pipeline par image (p50 / p95) | 627 ms / 866 ms |
| Temps de rendu par image (p50) | 1107 ms |

## Erreur sur W et H (cas mesurés)

| Série | n | p50 | p95 | max |
|---|---|---|---|---|
| mire — largeur W | 231 | 0.01 % | 0.04 % | 0.11 % |
| mire — hauteur H | 231 | 0.01 % | 0.04 % | 1.87 % |
| a4 — largeur W | 213 | 0.02 % | 0.15 % | 0.34 % |
| a4 — hauteur H | 213 | 0.02 % | 0.20 % | 1.88 % |
| feuille tapée à la main (σ 2 px) — W | 463 | 1.05 % | 3.40 % | 7.69 % |
| feuille tapée à la main (σ 2 px) — H | 463 | 0.73 % | 2.40 % | 4.61 % |
| cas mesurés sans avertissement — max(W, H) | 290 | 0.02 % | 0.15 % | 1.67 % |
| cas mesurés avec avertissement(s) — max(W, H) | 154 | 0.03 % | 0.34 % | 1.88 % |

| Cible | Résultat |
|---|---|
| Feuille A4 détectée : 95 % des cas < 3 % (W et H) | 100.0 % des cas < 3 % (p95 = 0.23 %) |
| Mire : p95 < 1 % | p95 = 0.06 % |
| Feuille tapée à la main : 95 % < 5 % | 99.1 % des cas < 5 % |
| Aucune fausse mesure silencieuse | 7 fausse(s) détection(s) de référence ; 0 quad(s) de mur faux non mesurés ; cas mesurés avec erreur > tolérance affichée sans avertissement : 0 |

## Par type de mur (cas mesurés, erreur max(W, H))

| Type de mur | Référence | Cas | Détection réf. | p50 | p95 | max |
|---|---|---|---|---|---|---|
| white | mire | 74 | 74 / 74 | 0.02 % | 0.06 % | 1.87 % |
| white | a4 | 83 | 67 / 83 | 0.10 % | 0.38 % | 1.30 % |
| light | mire | 100 | 100 / 100 | 0.02 % | 0.04 % | 0.11 % |
| light | a4 | 96 | 94 / 96 | 0.03 % | 0.13 % | 1.74 % |
| dark | mire | 78 | 78 / 78 | 0.02 % | 0.07 % | 0.83 % |
| dark | a4 | 69 | 67 / 69 | 0.02 % | 0.04 % | 1.88 % |

## Précision des étapes

| Étape | n | p50 | p95 | max |
|---|---|---|---|---|
| Coins de la référence (px, image de travail) | 480 | 0.04 px | 0.28 px | 1.28 px |
| Coins du mur (px, image de travail) | 463 | 0.06 px | 0.24 px | 20.96 px |
| Erreur sur k1 (×1000) | 463 | 0.06  | 0.37  | 1.89  |
| Hauteur de plinthe (cm) | 372 | 0.13 cm | 0.25 cm | 8.31 cm |
| Incertitude propagée (cas mesurés) | 444 | 0.76 % | 1.49 % | 1.81 % |

Plinthe : 370 / 372 proposées automatiquement quand elle existe (cas mesurés) ; 1 proposition(s) sans plinthe réelle ; erreur < 1 cm dans 98.7 % des propositions.
Calibration de l'incertitude : erreur réelle ≤ incertitude propagée dans 98.6 % des cas mesurés.

## Ouvertures (cas mesurés)

| Indicateur | Valeur |
|---|---|
| Ouvertures réelles | 393 |
| Retrouvées (IoU ≥ 0,5) | 329 (83.7 %) |
| … avec le bon type | 310 (94.2 % des retrouvées) |
| Propositions sans ouverture réelle | 99 |
| window : retrouvées avec le bon type | 172 / 207 |
| door : retrouvées avec le bon type | 79 / 104 |
| radiator : retrouvées avec le bon type | 59 / 82 |

## Échecs et avertissements

| Cause | Cas |
|---|---|
| no_wall_corners | 36 |
| no_reference | 13 |
| reference_false | 7 |

| Avertissement (cas mesurés) | Cas |
|---|---|
| reference_small | 133 |
| reference_ambiguous | 14 |
| floor_line_ambiguous | 8 |
| reference_too_small | 3 |
| wall_corners_inconsistent | 2 |
| wall_trapezoid | 1 |

## Pires cas mesurés

| Cas | Mur | Réf. | Réf. px | Angles | k1 | Err W | Err H | Incert. | Coins réf. px | Coins mur px | Avertissements |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 342 | 534 × 272 dark | a4 | 92 | -8/-3/5 | 0.001 | 0.02 % | 1.88 % | 1.67 % | 0.05 | 12.3 | reference_small |
| 481 | 501 × 283 white | mire | 90 | 9/8/-4 | 0.004 | 0.03 % | 1.87 % | 0.68 % | 0.04 | 12.8 | reference_small |
| 443 | 516 × 252 light | a4 | 116 | -11/-5/5 | 0.018 | 0.02 % | 1.74 % | 1.34 % | 0.03 | 14.9 | reference_ambiguous |
| 147 | 375 × 264 dark | a4 | 124 | -6/4/-12 | -0.002 | 0.00 % | 1.67 % | 1.28 % | 0.03 | 13.2 |  |
| 100 | 380 × 291 white | mire | 114 | -8/5/-12 | -0.006 | 0.07 % | 1.44 % | 0.59 % | 0.06 | 12.9 |  |
| 222 | 547 × 254 white | a4 | 101 | 13/0/-4 | 0.012 | 0.02 % | 1.30 % | 1.53 % | 0.98 | 0.0 | reference_small |
| 291 | 431 × 241 light | a4 | 121 | 11/2/-0 | -0.015 | 0.05 % | 1.23 % | 1.34 % | 0.12 | 21.0 | wall_corners_inconsistent |
| 398 | 501 × 279 white | a4 | 125 | 10/10/3 | 0.010 | 0.34 % | 0.94 % | 1.26 % | 0.80 | 11.5 |  |

## Banc « coins parfaits » (sans rendu : vérité terrain projetée → `rectify`)

Isole la géométrie de la rectification de la détection : coins exacts du mur et de la référence, avec et sans correction de distorsion, et feuille tapée à la main (bruit gaussien σ 2 px pleine résolution sur les coins de la référence, σ 1,5 px sur ceux du mur).

| Série | n | p50 | p95 | max |
|---|---|---|---|---|
| W, k1 connu | 500 | 0.00 % | 0.00 % | 0.00 % |
| H, k1 connu | 500 | 0.00 % | 0.00 % | 0.00 % |
| W, sans correction de distorsion (k1 ∈ ±0,02) | 500 | 0.31 % | 0.76 % | 0.97 % |
| H, sans correction de distorsion | 500 | 0.31 % | 0.74 % | 0.99 % |
| W, feuille manuelle (σ 2 px) + coins du mur ±1,5 px | 500 | 1.11 % | 3.45 % | 6.12 % |
| H, feuille manuelle (σ 2 px) + coins du mur ±1,5 px | 500 | 0.88 % | 2.60 % | 4.83 % |

## Lecture des résultats

- Les erreurs W/H sont mesurées sur les cas **mesurés** (référence détectée et coins du mur à < 40 px) : ce sont les cas où le pipeline rend un `WallSurvey` sans échec. Les cas restants sont des échecs **signalés** (`failure` non nul) que l'UI renvoie vers la saisie manuelle (loupe) : ils ne produisent jamais de chiffre.
- `floor_line_ambiguous` accompagne les cas où le bas du mur a été descendu d'un haut de plinthe au vrai sol (ou pourrait l'être) : la mesure est correcte dans la très grande majorité des cas mais l'UI doit faire confirmer le bas du mur.
- La ligne « feuille tapée à la main » simule la saisie des 4 coins de la feuille avec une erreur gaussienne de 2 px (pleine résolution) sur chaque coordonnée, les coins du mur étant ceux proposés automatiquement : c'est la tolérance affichée ± 5 %.
- `no_wall_corners` (36 cas, dont 23 murs blancs) : la sélection des lignes exige que chaque arête explique son côté (une arête de porte prise pour l'angle du mur est éliminée plutôt que de produire un mur faux mais cohérent) ; sur un mur blanc sous un plafond blanc, l'arête du plafond est souvent trop faible → repli manuel assumé. Les pires cas mesurés (erreur sur H de 1,5–2 %, sans avertissement) correspondent à une plinthe basse (≈ 5 cm) dont le haut a été pris pour le sol sans que le contrôle du dessous ne tranche ; l'erreur reste sous la tolérance affichée et le quad est soumis à confirmation visuelle.
- L'incertitude propagée est calibrée : la ligne « Calibration » donne la part des cas où l'erreur réelle est inférieure à l'incertitude annoncée (1σ propagée avec les hypothèses de la spécification ; sur des bords synthétiques l'erreur réelle des coins est bien plus faible que ±1,5 px, d'où une incertitude conservatrice).

## Limites du banc (à garder en tête avant le banc réel)

- Images **synthétiques** : bords nets (flou gaussien seul), bruit gaussien, pas d'artefacts JPEG, pas de flou de bougé, pas de reflets ni de textures murales (papier peint existant, crépi), pas de meubles devant le mur. La précision sous-pixel (0,04 px p50 sur la référence) est optimiste ; le banc réel de 20 murs (`docs/reports/measurement-benchmark.md`, lot M7) est indispensable.
- Distorsion : le même modèle de division sert au rendu et à la correction ; sur un vrai objectif (termes d'ordre supérieur, distorsion tangentielle), un résidu de 0,2–0,5 % est attendu. Le pipeline refuse les k1 implausibles (|k1| ≥ 0,045) et signale `distortion_not_estimated`.
- Murs rectangulaires uniquement (pas de pente de plafond) ; la détection de trapèze n'est validée que par tests unitaires avec focale EXIF.
- La feuille A4 sur mur blanc (contraste ≤ 15 niveaux) n'est détectée que dans une partie des cas : c'est le cas « le client tape les 4 coins avec la loupe » de la spécification, pas un défaut du banc.
- Les lignes de sol invisibles (sol de la teinte de la plinthe, sans joint ni ombre) ne peuvent pas être trouvées : le haut de plinthe est alors retenu ; c'est l'un des cas où la confirmation visuelle du bas du mur par l'utilisateur, sur l'image redressée, reste nécessaire.
- Les ouvertures sont des rectangles idéaux (cadres uniformes) ; les faux positifs du banc sont surtout des tableaux encadrés classés « fenêtre » et des bords intérieurs de cadres : l'UI fait confirmer chaque proposition (rien n'est déduit sans confirmation).

## Ce que l'UI doit savoir

- Appeler `measurePhoto({ work, full, fullFactor })` avec l'image de travail (≤ 2048 px) **et** l'originale : l'affinage des coins de la référence sur l'originale divise son incertitude par le facteur de réduction.
- `failure === "no_reference"` → écran « tapez les 4 coins de la feuille » (loupe), puis rappeler `measurePhoto` avec `reference: { quad, kind: "manual_a4" }` (tolérance affichée 5 %). `failure === "no_wall_corners"` → placer les 4 coins (aimantation `snapToEdge`), rappeler avec `wallQuad`.
- Toujours afficher les coins proposés sur l'image redressée (`rectified`) et faire confirmer ; afficher les avertissements (codes i18n) : `floor_line_ambiguous` (confirmer le bas du mur), `reference_aspect_mismatch` (feuille pas à plat / coin faux), `wall_corners_inconsistent` / `wall_trapezoid` (coin mal placé ou mur non rectangulaire), `distortion_not_estimated`, `reference_too_small`, `uncertainty_above_display_tolerance`.
- Plinthes : `survey.baseboard` arrive avec `enabled: false` et, si une ligne a été trouvée, `heightCm` + `source: "auto"` ; la bascule passe par `applyBaseboard(survey, true, heightCm, source)` ; sans hauteur réelle, l'option reste inactive et `baseboard_height_required` est levé. Le point tapé sur la photo → `snapToEdge` puis `measureBaseboard`.
- Ouvertures : `survey.openings` (source `auto`, `confidence`) sont des propositions à confirmer/ajuster/typer ; `surveyBounds(survey)` donne les deux surveys −tol/+tol pour l'estimation en fourchette.

## Reproduire

`pnpm --filter @wallscan/measurement bench` (500 cas, graine 20261107, ≈ 8 min sur 2 cœurs ; résultats bruts dans `dist/bench-results.json`, `pnpm bench:report` regénère ce fichier sans recalcul). Banc « coins parfaits » : `pnpm --filter @wallscan/measurement bench:perfect`.
