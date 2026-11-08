# Moteur de mesure v2 — affinage des coins, distorsion, netteté, gardes de fiabilité

Owner : measurement-engineer · 2026-11-08 · Reviewer attendu : qa-engineer (veto mesure), lead-architect.
Périmètre : `packages/measurement` uniquement (+ docs). Principe inchangé : photo seule, référence = mire / A4, 4 coins du plan.
Contrat d'API : `docs/specs/measurement-api.md` §6.

## 1. Résultats avant / après

### 1.1 Banc synthétique (`pnpm -s bench`, 500 cas, graine 20261107, `measurePhoto({ work, full, fullFactor })`)

| Indicateur | Avant (v1) | Après (v2) |
|---|---|---|
| Cas mesurés de bout en bout | 444 / 500 | 444 / 500 |
| **Fausses mesures silencieuses** (erreur > tolérance affichée sans avertissement) | **0** | **0** |
| max(W, H) p50 / p95 / p99 / max | 0,024 / 0,180 / 1,47 / 1,91 % | 0,021 / 0,173 / 1,38 / 1,88 % |
| W p50 / p95 / max | 0,015 / 0,130 / 1,51 % | 0,014 / 0,115 / 0,34 % |
| H p50 / p95 / max | 0,017 / 0,151 / 1,91 % | 0,014 / 0,119 / 1,88 % |
| Mire max(W, H) p95 | 0,081 % | 0,061 % |
| A4 max(W, H) p95 | 0,287 % | 0,230 % |
| Cas < 3 % / < 1 % / < 0,5 % | 100 / 98,0 / 97,1 % | 100 / 98,4 / 97,7 % |
| Coins du mur, erreur max (px image de travail) p50 / p95 | 0,103 / 0,407 | 0,061 / 0,242 |
| Coins du mur < 1 px | 96,8 % | 97,8 % |
| Erreur sur k1 (×10⁻³) p50 / p95 / max | 0,156 / 0,916 / 49,3 | **0,060 / 0,369 / 1,9** |
| Feuille tapée à la main : < 5 % | 98,9 % | 99,1 % |
| Calibration de l'incertitude (erreur ≤ incertitude) | 98,2 % | 98,6 % |
| Temps pipeline p50 / p95, runs alternés de 60 cas sur la même machine | 476–531 / 746–858 ms | 597–602 / 893–1 026 ms |

Les temps du rapport complet (680 → 627 ms p50) **ne sont pas comparables** (charge différente : la machine est partagée).
La mesure appariée ci-dessus donne **+70 à +120 ms en p50** : netteté ≈ 50 ms, échantillonnage dense pour k1 et affinage
pleine résolution ≈ 30–60 ms. On reste à la cible Node de la spécification (< 600 ms en p50), sans marge.

Le synthétique était déjà très favorable (coins à 0,1 px) ; les gains visibles sont surtout la **queue** (W max 1,51 → 0,34 %)
et **k1** (×2,5 en p50 et en p95, plus d'aberrant à 0,05). Les pires cas (H ≈ 1,9 %) restent ceux d'une plinthe basse prise
pour le sol (coins à 12–21 px) : l'affinage local (fenêtre de 8 px) ne peut pas et ne doit pas les déplacer.

### 1.2 Banc « coins tapés » (`bench/wallRefine.ts`, 120 cas : coins vérité + bruit σ 3 px image de travail, référence vérité)

| Série | p50 | p95 | max |
|---|---|---|---|
| Coins tapés : erreur max des 4 coins (px) | 6,05 | 8,90 | 12,3 |
| Après `refineWallQuad` (px) | **0,06** | **0,55** | 3,7 |
| Coins tapés : erreur max(W, H) | 0,35 % | 0,84 % | 1,03 % |
| Après `refineWallQuad` | **0,00 %** | **0,05 %** | 0,43 % |
| Quads entièrement affinés (`refined`) | 114 / 120 (95 %) | | |
| Temps `refineWallQuad` (12 Mpx) | 8,7 ms | 12,9 ms | 22,8 ms |

C'est le cas d'usage principal (coins posés au doigt avec la loupe). Les 6 quads non entièrement affinés gardent leurs côtés
d'entrée là où l'arête est trop faible (angle entre deux murs de même teinte) : jamais de déplacement vers une autre arête.

### 1.3 Banc de réalisme (`pnpm -s bench:realism`, 32 conditions × 20 scènes, image de travail seule)

| Indicateur | Avant | Après |
|---|---|---|
| **Fausses mesures silencieuses** | **4 / 640** (scène 14 : blur-3, motion-14, warp-8, roll-8) | **0 / 640** |
| Crashs | 0 | 0 |
| Mesures rendues / échecs déclarés | 405 / 235 | 405 / 235 (inchangé) |
| Mesures > 5 % annoncées | 12 | 16 (les 4 anciennes silencieuses + 0 nouvelle) |
| Mesures > 5 % portant un code de **refus** | — | 10 / 16 |
| Bonnes mesures (< 3 %) avec un avertissement | 53 / 383 | 136 / 383 |

Rapport complet : `docs/reports/measurement-realism-bench.md` (colonne avant → après générée par le script).

### 1.4 Netteté (`bench/sharpness.ts`, protocole du banc de réalisme : rendu direct à 2 048 px, bruit ajouté après le flou)

`blurPx` (largeur de flou estimée, px), 20 scènes de calibration (0–19) / 20 scènes disjointes (100–119) :

| Condition | blurPx p50 (cal. / valid.) | max | sharp / soft / blurry (cal. + valid.) | Attendu (quality-thresholds) |
|---|---|---|---|---|
| Nominal (optique σ 0,6–1,2) | 1,21 / 1,22 | 1,54 | 40 / 0 / 0 | sans réserve |
| Bruit σ 8 | 1,22 / 1,28 | 1,69 | 40 / 0 / 0 | sans réserve |
| Flou ajouté σ 1 | 1,56 / 1,61 | 1,92 | 36 / 4 / 0 | sans réserve |
| σ 1,5 | 1,92 / 1,97 | 2,29 | 0 / 36 / 4 | avertir |
| σ 2 | 2,33 / 2,36 | 2,74 | 0 / 0 / 40 | **refuser** |
| σ 3 | 3,04 / 3,04 | 3,04 | 0 / 0 / 40 | **refuser** |
| Bougé 4 px | 1,73 / 1,78 | 1,98 | 19 / 21 / 0 | sans réserve / avertir |
| Bougé 6 px | 2,29 / 2,32 | 2,45 | 0 / 0 / 40 | avertir |
| Bougé 8 px | 2,90 / 2,97 | 3,04 | 0 / 0 / 40 | **refuser** |
| Bougé 14 px | 3,04 / 3,04 | 3,04 | 0 / 0 / 40 | **refuser** |

Résultat : 400/400 verdicts conformes, **0 image nette écartée** (exigence ≤ 5 %). Sur le banc de réalisme : σ 2 / σ 3 / bougé 8 /
bougé 14 → 80/80 `blurry`, nominal + bruit + exposition → 0 `blurry`. Écart : le bougé de 6 px est déjà « blurry » (la politique
QA dit « avertir » jusqu'à 8 px) ; avec une boîte de L px, l'estimateur donne σ ≈ L / √(2π) + optique, et la marge entre
σ 1,5 (max 2,29) et σ 2 (min 2,21) ne laisse pas de place pour distinguer bougé 6 et 8. Je préfère refuser à 6 px.

## 2. Ce qui a changé

1. **`refineWallQuad`** (`src/wallRefine.ts`, nouveau) : 40–120 profils par côté sur l'image pleine résolution, profil moyenné
   sur ±2 px le long de l'arête et lissé, transition par parabole sur |dérivée| (polarité libre puis majoritaire), droite par
   RANSAC déterministe puis moindres carrés itératifs avec rejet à 2,5 σ, coins = intersections (dans l'espace non distordu si k1).
   Côté rejeté (< 35 % d'inliers, couverture < 30 %, RMS > 2 px) → `null` et droite d'entrée ; coin déplacé de > max(12, 3 × fenêtre)
   → coin d'entrée. Seuil de dérivée abaissé à max(1, bruit) : le seuil v1 (2 × bruit sur profil brut) perdait les angles peu
   contrastés (9 côtés sur 40 cas → 1).
2. **Distorsion sur polylignes** : `estimateRadialDistortionFromPolylines` accepte toute polyligne (arêtes, haut de plinthe,
   montants) ; poids = longueur ; rejet itératif à 3 σ autour de la parabole (un bas de porte décalé de 1 px biaisait le sol) ;
   lignes quasi radiales (levier < 0,1 px) écartées. Le pipeline l'alimente avec un **échantillonnage dense** (1 profil / 3 px,
   3–97 % du côté) : c'est lui qui fait le gain (avec 120 profils / côté, p90 était pire que la v1 ; avec la densité : 74 % des
   cas meilleurs). `rawK1` expose l'optimum brut (±0,15) quand l'estimation est rejetée.
3. **`sharpness`** réécrite (le premier jet, variance du laplacien normalisée, ne discriminait pas quand le bruit est ajouté après
   le flou — constat QA confirmé) : largeur de flou gaussienne équivalente aux crêtes de bords nets, après lissage binomial σ 1,
   médiane par direction, direction la plus floue ; rampes (σ > 6 px) ignorées.
4. **`fuseQuads`**, **`consistency`** (nouveaux, `src/quality.ts`).
5. **Gardes de fiabilité** (correctif bloquant QA) : `measure_implausible` (H ∉ [180 ; 450], W ∉ [100 ; 1 200] cm),
   `reference_scale_suspect` (feuille > 14 % ou < 4 % de la hauteur du mur), `reference_ambiguous` (second candidat > 70 % du
   meilleur, ou feuille hors du tiers central en largeur / hors [15 ; 85 %] en hauteur), `reference_small` (40–55 px),
   `image_soft` / `image_blurry`, `distortion_strong` / `distortion_extreme`. `REFUSAL_WARNINGS` liste les codes de refus.
   `detectReference` expose `candidates` (quad + score) et `ambiguous`. `measurePhoto` expose `confidence` (plafonnée à 0,5 sur un
   code de refus ou de référence douteuse, 0,79 sur tout autre avertissement : < 0,8 ⇒ bannière), `sharpness`, `wallRefinement`.
6. **Pipeline** : avec `full`, k1 sur les arêtes pleine résolution (repli v1), puis `refineWallQuad` ; coins utilisateur affinés
   seulement sur `refineWallQuad: true`. API v1 inchangée (vérifié : 161 exports, bundle 130 Ko, `check-bundle` OK).
7. Commentaire de `src/distortion.ts` corrigé : **k1 < 0 = barillet** dans le modèle de division (la v1 disait l'inverse ; le code
   était juste, seul le commentaire était faux).

## 3. Limites

- **Tout est synthétique.** Bords parfaits, pas de JPEG ni d'accentuation de téléphone, pas de rolling shutter : la précision
  sous-pixel (0,06 px) et les seuils de netteté sont optimistes. Le banc réel de 20 murs (`docs/reports/measurement-benchmark.md`)
  reste **indispensable** avant tout chiffre devant un client ; les seuils de `sharpness` (1,75 / 2,1 px) devront y être recalés.
- **Fausses alertes** : sur le banc synthétique, la part des mesures sans avertissement passe de 428 à 290 / 444. L'essentiel vient de
  `reference_small` (133 cas, feuille 40–55 px sur l'image de travail) alors que ces mesures restent à 0,17 % en p95, parce que la feuille
  est affinée sur l'originale. Le seuil QA a été mesuré **sans** affinage pleine résolution. `reference_ambiguous` : 14 / 444
  (3 / 68 en nominal 2 048 px, tous avec un vrai second rectangle de format A4 ; l'un d'eux était une erreur de 75 %, donc rattrapée).
- `reference_scale_suspect` est, par construction, une borne sur H exprimée en proportion (H < 2,12 m pour une A4) : un vrai mur
  de 2,0–2,1 m (combles) déclenche l'avertissement.
- Un bougé purement horizontal sur une photo sans bord vertical net n'est pas mesurable par `sharpness` (direction ignorée sous
  20 bords) ; dans ce cas les coins du mur ne sont pas non plus détectables.
- Le banc de réalisme n'exerce pas le chemin pleine résolution (image de travail seule) : les gains §1.1–1.2 n'y apparaissent pas.
- Gondolage de la feuille, surexposition : non constatables par le moteur (seul `reference_aspect_mismatch` capte une partie
  du gondolage). L'UI doit guider (« plaquer la feuille »).
- `WALL_CORNER_SIGMA_PX` (3 px) n'a pas été abaissé après affinage : l'incertitude propagée reste conservatrice.

## 4. Décisions à valider

1. **`reference_small` quand la feuille a été affinée sur l'originale** : garder le seuil QA tel quel (proposition QA, retenue
   ici) ou le rapporter au petit côté en pixels pleine résolution (diviserait les fausses alertes par ≈ 4 sur le synthétique) ?
   → qa-engineer + lead-architect.
2. **Bougé 6 px = refus** (au lieu d'« avertir » jusqu'à 8 px) : voir §1.4. → qa-engineer.
3. Plafonds de confiance (0,5 / 0,79) et liste `REFUSAL_WARNINGS` : proposition à valider (impact UI : bannière et blocage
   de l'envoi du devis). → lead-architect, product-owner.
4. Requalifier le critère bloquant avec `--n=40` (≈ 20–27 min) : non fait ici, faute de budget machine. → qa-engineer.

## 5. Pistes

- Ajouter le haut de plinthe (`proposeBaseboard`) et les montants d'ouvertures aux polylignes de k1 : il faut une seconde passe,
  puisque la plinthe est trouvée après la rectification.
- Abaisser σ_mur dans l'incertitude quand `wallRefinement.refined` (résidu mesuré disponible par côté).
- `fuseQuads` sur une rafale de 3 photos dans le module, et `refineWallQuad` systématique après validation des coins par
  l'utilisateur (`refineWallQuad: true`).
- Accélérer `wallCorners` (≈ 200 ms, premier poste du pipeline) pour retrouver de la marge sous 600 ms.

## 6. Reproduire

```
pnpm --filter @wallscan/measurement bench                 # synthétique 500 cas (≈ 8–14 min)
pnpm --filter @wallscan/measurement bench:realism         # réalisme 640 cas (≈ 6–10 min)
cd packages/measurement && npx esbuild bench/wallRefine.ts --bundle --platform=node --format=esm --outfile=dist/wallrefine.mjs && node dist/wallrefine.mjs 120
npx esbuild bench/sharpness.ts --bundle --platform=node --format=esm --outfile=dist/sharpness.mjs && node dist/sharpness.mjs 20 0 && node dist/sharpness.mjs 20 100
```
