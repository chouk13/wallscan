# Contrats d'API — mesure photo, calepinage, module web (v1)

Référence pour les lots M1–M6 (`docs/specs/mesure-photo-v1.md`). Tout est TypeScript strict, pur (zéro DOM, zéro réseau) dans
`packages/measurement` et `packages/quote-engine` ; le module web (`apps/web/public/prototype`) consomme des **bundles IIFE**
(`esbuild`) exposés en globales `WSMeasure` et `WSQuote`, inlinés par `scripts/build-prototype.mjs`.

## 1. Types partagés (`packages/core`)

```ts
export interface Pt { x: number; y: number }                    // pixels (image de travail) ou cm (plan du mur) selon contexte
export type Quad = [Pt, Pt, Pt, Pt]                              // ordre : haut-gauche, haut-droit, bas-droit, bas-gauche
export interface GrayImage { width: number; height: number; data: Uint8ClampedArray }   // 1 octet/pixel, ligne par ligne
export type ReferenceKind = "mire" | "a4" | "manual_a4"
export interface OpeningV2 { id: string; kind: "window" | "door" | "french_door" | "radiator" | "niche" | "excluded"; rect: { x: number; y: number; w: number; h: number } /* cm, origine haut-gauche du mur */; confidence: number; source: "auto" | "user" }
export interface WallSurvey {
  widthCm: number; heightCm: number;               // moyenne des côtés opposés
  heightLeftCm: number; heightRightCm: number;     // trapèze si écart > 2 %
  uncertaintyPct: number;                           // réelle, propagée
  displayTolerancePct: 3 | 5;                       // 3 si référence détectée automatiquement, 5 si tapée à la main
  reference: ReferenceKind;
  scalePxPerCm: number;                             // dans l'image redressée
  homography: number[];                             // 9 valeurs, image de travail → plan du mur (cm)
  openings: OpeningV2[];
  baseboard: { enabled: boolean; heightCm: number | null; source: "measured" | "auto" | "user" | null }; // hauteur réelle (mesurée ou saisie), jamais de défaut
  checks: { oppositeSidesPct: number; referenceAspectPct: number; distortionPct: number; warnings: string[] };
}
```

## 2. `packages/measurement` → globale `WSMeasure`

```ts
toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage
detectReference(img: GrayImage, hint?: { kind?: ReferenceKind; near?: Pt }): { kind: "mire" | "a4"; quad: Quad; confidence: number; code?: number } | null
refineCorners(img: GrayImage, quad: Quad, radiusPx?: number): Quad        // sous-pixel sur le gradient
proposeWallCorners(img: GrayImage): { quad: Quad; confidence: number; lines: Array<{ a: Pt; b: Pt; kind: "ceiling" | "floor" | "left" | "right" }> } | null
snapToEdge(img: GrayImage, p: Pt, radiusPx?: number): Pt                  // aimantation d'une poignée
estimateRadialDistortion(img: GrayImage, lines: Array<{ a: Pt; b: Pt }>): { k1: number; residualPct: number }
rectify(args: { wallQuad: Quad; refQuad: Quad; refSizeCm: { w: number; h: number }; refKind: ReferenceKind; k1?: number; imageSize: { w: number; h: number } }): WallSurvey   // sans ouvertures
warpToPlane(img: GrayImage, H: number[], outW: number, outH: number): GrayImage   // image redressée (pour l'UI et les ouvertures)
proposeOpenings(rectified: GrayImage, scalePxPerCm: number, survey: WallSurvey): OpeningV2[]
measureBaseboard(survey: WallSurvey, pointInImage: Pt): { heightCm: number; uncertaintyCm: number }   // haut de plinthe tapé sur la photo
applyBaseboard(survey: WallSurvey, enabled: boolean, heightCm: number | null, source: "measured" | "auto" | "user" | null): WallSurvey   // hauteur inconnue → warning, pas de réduction
surveyBounds(survey: WallSurvey): { low: WallSurvey; high: WallSurvey }   // −tol / +tol pour la fourchette
```
Règles : déterministe ; aucune exception vers l'UI (retours `null` / `warnings`) ; performance cible : pipeline complet < 1,5 s sur
une image 2 048 px dans un téléphone milieu de gamme (mesurer en Node sur l'image synthétique, cible < 600 ms).

## 3. `packages/quote-engine` → globale `WSQuote` (calepinage)

```ts
export interface StripPlanInput {
  wall: { widthCm: number; heightLeftCm: number; heightRightCm: number; openings: OpeningV2[]; baseboard: { enabled: boolean; heightCm: number | null } }   // enabled sans hauteur → refus explicite, jamais 8 cm
  paper: { rollWidthCm: number; rollLengthCm: number; patternRepeatCm: number; matchType: "free" | "straight" | "half_drop" | "offset"; offsetCm: number; saleUnit: "roll" | "m2"; minOrderRolls: number }
  settings: { cutTopCm: number; cutBottomCm: number; start: "left" | "centered"; centerAtCm?: number; deductAboveM2: number; safetyRollIfPattern: boolean; phaseOffsetCm?: number /* continuité de motif depuis le mur précédent */ }
}
export interface StripPiece { stripIndex: number; fromCm: number; toCm: number; lengthCm: number /* avec marges */; patternStartCm: number; reason: "full" | "above_opening" | "below_opening" | "between" }
export interface StripPlan {
  strips: Array<{ index: number; xFromCm: number; xToCm: number; pieces: StripPiece[]; skipped?: "french_door" }>
  rolls: Array<{ index: number; cuts: Array<{ stripIndex: number; pieceIndex: number; lengthCm: number }>; wasteCm: number }>
  rollCount: number; m2Decor?: number; billableAreaM2: number; wasteTotalCm: number; phaseOutCm: number; trace: string[]
}
planStrips(input: StripPlanInput): StripPlan
planRoom(walls: StripPlanInput[]): { walls: StripPlan[]; rollCount: number; trace: string[] }   // chaînage du motif, empaquetage commun
quoteRange(input: QuoteInput, tolerancePct: number): { low: QuoteOutput; mid: QuoteOutput; high: QuoteOutput; thresholdInside: boolean }
```
Règles : empaquetage premier-ajustement-décroissant avec respect de la position de motif ; `trace[]` lisible (« Lé 3 : fenêtre de
120 × 140 cm à 95 cm du sol → deux morceaux, 72 cm au-dessus et 105 cm en dessous ») ; déductions par défaut : surface déduite
si ouverture > 1 m², lés jamais réduits sauf `french_door` pleine hauteur, radiateurs jamais déduits, `excluded` = zone exclue.

### 3.1 Implémentation (quote-engineer, `packages/quote-engine/src/{strips,layout,packing,quote}.ts`)

- **Aucune exception** : un refus renvoie un `StripPlan` vide avec `error` ∈ `baseboard_height_missing | invalid_wall |
  invalid_paper | piece_longer_than_roll` et une `trace` d'une ligne « Refus (code) : … ». `planRoom` propage l'erreur du
  premier mur fautif (`walls[i].error`). Plinthes : `enabled` vrai + `heightCm` null → `baseboard_height_missing`, jamais de défaut.
- **Millimètres entiers** en interne (arrondi au mm), sortie en cm ; surfaces au centième de m².
- **Découpe** : seules les ouvertures qui couvrent **toute la largeur** du lé le coupent en morceaux (`window`, `door`, `french_door`,
  `niche`, `excluded` ; jamais `radiator`) ; une ouverture partielle en largeur laisse le lé entier (évidé à la pose). Un lé sans
  aucun morceau est `skipped` (`french_door`, ou `full_height_opening` pour toute autre ouverture pleine hauteur — ajout au contrat).
- **Raccord** : position du motif au plafond = `phaseOffsetCm` (+ décalage un lé sur deux pour `half_drop` / `offset`, `half_drop` sans
  `offsetCm` = demi-raccord) ; `patternStartCm` d'un morceau = phase du lé + sa position verticale ; `phaseOutCm` = phase du lé virtuel
  suivant (chaînage `planRoom`). Le premier morceau d'un rouleau ne perd rien (le rouleau est entamé au bon motif) ; les suivants
  attendent le prochain raccord (`cuts[].wasteBeforeCm`).
- **Empaquetage** : quatre variantes essayées (morceaux / lés entiers × ordre des lés / décroissant), la moins chère en rouleaux gagne
  (égalité → morceaux, ordre des lés). La variante « lés entiers » garantit `rollCount ≤ simpleRollCount` (formule §5.1 sur les mêmes
  lés). `rollCount` = rouleaux découpés + réserve si raccord, puis minimum fournisseur ; `rolls.length` = rouleaux découpés.
- **Surface** : brute = largeur × hauteur moyenne (trapèze) − bande de plinthe ; déduction = aire de l'**union** des ouvertures
  déduites (chevauchements comptés une fois, jamais négatif) ; `excluded` toujours, `radiator` jamais, sinon `> deductAboveM2`.
- **Vente au m²** : `m2Decor` = lés non sautés × largeur × (hauteur max + marges), `rollCount` 0, `rolls` vide ; les ouvertures ne
  réduisent pas le décor imprimé.
- **Ajouts au contrat** (compatibles) : `StripPlanWall.areaOnlyOpenings` (ouvertures Phase 0 sans position : déduites, jamais
  découpées), `StripPiece.pieceIndex/usefulCm/openingIds`, `StripInfo.heightCm/phaseCm`, `RollCut.startCm/wasteBeforeCm/wallIndex`,
  `RollPlan.usedCm`, `StripPlan.rollsUsed/simpleRollCount/grossAreaM2/deductedAreaM2/stripCount/pieceCount/anchorIndex/error`,
  `RoomPlan.rolls/rollsUsed/separateRollCount/m2Decor/billableAreaM2/wasteTotalCm/error`, `QuoteRange.discreteChanges`.
- **Bundle** : `pnpm --filter @wallscan/quote-engine build:bundle` → `dist/wsquote.iife.js` (globale `WSQuote`, ~53 Ko), vérifié au
  chargement dans Node par `scripts/check-bundle.mjs`.

## 4. Module web

Le module appelle `WSMeasure` depuis l'écran « Vérifier » (image redressée), puis `WSQuote.planStrips` / `quoteRange`. Paramètres
d'URL existants (`mode`, `embed`, `images`, `brand`). Nouveaux écrans : Préparer (feuille / mire), Photographier (niveau),
Vérifier (référence, coins, ouvertures, plinthes), Résultat (dimensions ± tolérance). L'estimation affiche une fourchette quand
`thresholdInside` est vrai.

## 5. Implémentation v1 de `packages/measurement` — compléments au contrat (2026-11-07)

Le contrat du §2 est respecté signature pour signature ; les points suivants le précisent ou l'étendent **sans le casser**
(paramètres optionnels en fin de liste, champs optionnels, fonctions supplémentaires).

### Conventions
- **Coordonnées** : le pixel (i, j) couvre [i, i+1[ × [j, j+1[, centre en (i + 0,5, j + 0,5). Les quads sont en
  coordonnées de l'image de travail (≤ 2048 px côté long, facteur de réduction entier), coins ordonnés TL, TR, BR, BL **dans
  l'ordre image** (le haut-gauche est le coin de plus petit x + y).
- **Distorsion** : modèle de division à un coefficient, rayon normalisé par la demi-diagonale de l'image de travail :
  `p_u = c + (p_d − c) / (1 + k1·r²)`. `WallSurvey.homography` s'applique aux coordonnées **non distordues** ; `WallSurvey`
  porte deux champs optionnels `distortionK1` et `imageSize` pour que `imageToWallCm(survey, p)` / `measureBaseboard` fassent
  la correction eux-mêmes.
- **Avertissements** = codes stables (clés i18n, jamais de texte) : `degenerate_geometry`, `reference_orientation_invalid`,
  `reference_aspect_mismatch`, `wall_corners_inconsistent`, `wall_trapezoid`, `reference_too_small`,
  `uncertainty_above_display_tolerance`, `distortion_high`, `geometry_check_unavailable`, `baseboard_height_required`,
  `floor_line_ambiguous` (voir `constants.ts` pour la correspondance FR).

### Signatures étendues
```ts
refineCorners(img, quad, radiusPx = 6, k1 = 0)                  // k1 : ajustement dans l'espace non distordu
refineCornersDetailed(img, quad, { radiusPx?, k1?, minStrength?, maxSamples?, polarity? })  // + diagnostic par côté
proposeWallCorners(img, hint?: { inside?: Pt })                // point connu dans le mur (centre de la référence)
rectify({ …contrat…, refCornerSigmaPx?, focalPx?, distortionResidualPct? })
warpToPlane(img, H, outW, outH, k1 = 0)                         // H : image (non distordue) → pixels de sortie
measureBaseboard(survey, pointInImage)                           // utilise survey.imageSize / distortionK1
```

### Fonctions supplémentaires
```ts
measurePhoto({ work, full?, fullFactor?, referenceHint?, wallQuad?, reference?, focalPx?, rectifiedScalePxPerCm?, proposeOpenings?, proposeBaseboard? }): AutoSurveyResult
  // pipeline complet sans intervention ; `wallQuad` / `reference` fournis par l'utilisateur court-circuitent la détection
proposeBaseboard(rectified, scalePxPerCm, survey): { heightCm, confidence, coverage } | null   // proposition « auto »
findHorizontalStep(img, yMin, yMax, minCoverage?)                // ligne de marche horizontale (plinthe, contrôle du sol)
usableHeightCm(survey)                                           // hauteur utile (plinthe activée et hauteur réelle connue)
imageToWallCm(survey, p, imageSize?)                             // photo → plan du mur (cm), distorsion comprise
referenceSizeCm(kind, quad)                                      // 21 × 29,7 / 19 × 27,7 orientés portrait ou paysage
scaleHomography(H, s), translateHomography(H, tx, ty), scaleSurvey(survey, factor)
wallLineCandidates(img, hint?), selectWallQuad(cands)            // étapes intermédiaires exposées (tests, débogage)
```

### Sémantique des contrôles (`checks`)
- `oppositeSidesPct` : écart entre hauteurs gauche et droite du mur redressé par points de fuite avec la focale la plus
  favorable (EXIF ± 5 % si fournie, sinon balayage 22–35 mm équiv.). > 1 % → `wall_corners_inconsistent` ; > 2 % →
  `wall_trapezoid` et `heightLeftCm` ≠ `heightRightCm`. Sans EXIF, un vrai trapèze peut être partiellement « expliqué » par
  la focale : contrôle conservateur (pas de fausse alerte, détection atténuée).
- `referenceAspectPct` : distance (%) entre les proportions W/H données par la référence et la plage de proportions compatibles
  avec la géométrie du quad ; > 1,5 % → `reference_aspect_mismatch` (feuille pas à plat / mal placée / coin de référence faux).
- `distortionPct` : déplacement radial maximal appliqué aux coins du mur ; > 2 % → `distortion_high`.
- `floor_line_ambiguous` : une autre ligne de marche nette existe 3–30 cm sous le bord inférieur retenu (haut de plinthe pris
  pour le sol, ou sol pris pour un joint) — l'UI demande de confirmer le bas du mur.

### Incertitude
`uncertaintyPct` = max sur W et H de √(σ_ref² / taille_ref_px² + σ_mur² / taille_mur_px² + résidu_distorsion²), avec
σ_ref = 0,5 px (mire), 1,5 px (A4 détectée), 4 px (A4 manuelle) — divisés par le facteur de réduction quand les coins ont été
affinés sur l'image pleine résolution —, σ_mur = 3 px, résidu = max(0,3 %, résidu mesuré). `displayTolerancePct` = 3 ou 5.

## 6. Moteur v2 (2026-11-08, measurement-engineer) — ajouts au contrat, sans rupture

Rapport et chiffres : `docs/reports/measurement-v2-engine.md`. Tout est exporté par `src/index.ts`, donc présent dans `WSMeasure`.
Aucune signature existante n'a changé ; les ajouts sont des fonctions, des champs optionnels et des codes.

### 6.1 Affinage du quad du mur par droites (`src/wallRefine.ts`)
```ts
refineWallQuad(full: GrayImage, quadPx: Quad, opts?: { searchPx?: number; samples?: number; k1?: number; minStrength?: number }): {
  quad: Quad;                                                     // pixels de `full`
  lines: { ceiling, right, floor, left: { p: Pt; d: Pt; inliers: number; residualPx: number } | null };
  residualPx: number;                                             // pire RMS des côtés ajustés (0 si aucun)
  confidence: number;                                             // moyenne par côté de couverture × (1 − résidu / 4 px)
  refined: boolean;                                               // 4 côtés ajustés ET 4 coins acceptés
}
sampleQuadEdges(img, quad, opts?) → Array<{ side, points: Pt[], requested, polarity }>      // 40–120 profils par côté
sampleQuadEdgesDense(img, quad, { searchPx? }?) → Pt[][]          // 1 profil / 3 px, 3–97 % du côté (distorsion)
sampleEdgePolyline(img, a, b, { count, minStrength, searchPx?, spanStart?, spanEnd? }) → { points, polarity }
profileEdge(img, s, n, d, r, minStrength) → { p, strength } | null
fitEdgeLine(pts, minInliers, minSpan?) → { p, d, inliers, residualPx } | null
wallRefineSampleCount(len, samples?) → number                    // round(len / 12) borné à [40 ; 120]
```
- Profils : ±`searchPx` (défaut 6 px) le long de la normale, pas 0,5 px, moyennés sur ±2 px le long de l'arête, lissés [1 2 1] ;
  transition = maximum de |dérivée| (polarité libre puis majoritaire par côté), parabole sous-pixel ; échantillons à < 40 % de
  l'amplitude médiane écartés ; seuil de dérivée max(1, bruit).
- Droite : RANSAC déterministe (paires i, i + n/2 ; tolérance 1 px) puis moindres carrés totaux itératifs, rejet à 2,5 σ
  (σ = 1,4826 × médiane des |résidus|, plancher 0,2 px).
- Côté rejeté (`null`) si : < max(12, 35 % des profils) inliers, inliers couvrant < 30 % du côté, ou RMS > 2 px. Il garde la
  droite du quad d'entrée. Un coin qui bougerait de plus de max(12 px, 3 × `searchPx`) garde sa position d'entrée.
- `k1` fourni : droites ajustées dans l'espace non distordu (normalisation sur `full`), coins re-distordus.

### 6.2 Distorsion sur polylignes (`src/distortionEstimate.ts`)
```ts
estimateRadialDistortionFromPolylines(polylines: ReadonlyArray<readonly Pt[]>, imageSize: { w; h }): { k1; residualPct; linesUsed; rawK1? }
lineDistortionLeverPx(pts, size) → number          // flèche (px) induite par k1 = 0,02 sur la ligne, composante affine retirée
robustParabolaInliers(pts, a, b) → Pt[]            // 1,5 px puis 3 passes à max(0,25 px, 3 σ)
parabolaResiduals(pts, a, b) → number[] | null
DistortionEstimate.rawK1?: number                  // optimum brut ; si l'estimation est rejetée (≥ 0,045), optimum sur ±0,15
```
Toute polyligne (arêtes du mur, haut de plinthe, montants de portes/fenêtres) est acceptée si : ≥ 20 points, longueur
≥ 15 % du petit côté, levier ≥ 0,1 px. Coût pondéré par la longueur (poids par point = longueur / nb de points). Consensus
(±0,01) et rejet (|k1| ≥ 0,045 → 0) inchangés. `estimateRadialDistortion(img, lines)` (v1) est inchangé ; il renvoie en plus `rawK1`.

### 6.3 Qualité (`src/quality.ts`)
```ts
sharpness(img: GrayImage, roi?: { x; y; w; h }): { score: number; verdict: "sharp" | "soft" | "blurry"; blurPx: number; edgePixels: number }
fuseQuads(quads: Quad[], opts?: { maxSpreadPx?: number }): { quad: Quad; spreadPx: number; used: number } | null
consistency(survey: { heightCm: number }, knownHeightCm: number): { deltaPct: number; verdict: "ok" | "check" | "mismatch" }
```
- `sharpness` : largeur de flou gaussienne équivalente `blurPx`, mesurée sur l'image lissée σ 1 aux crêtes de bords nets
  (contraste ≥ max(24, 6 × bruit) sur ±8 px, marche monotone), σ = C / (√(2π) · pic du gradient), lissage retranché en
  quadrature, médiane par direction (x, y), direction la plus floue retenue. `score` = 1 / `blurPx`. Seuils pour l'**image de
  travail** (≤ 2 048 px) : `blurPx` ≥ 2,1 → `blurry` (refus) ; ≥ 1,75 → `soft` ; sinon `sharp`. Aucun bord mesurable →
  `blurry`, `blurPx = +∞`, `score = 0`. Rampes (σ > 6 px) ignorées, bords à 3,2–6 px comptés à 3,2 px.
- `fuseQuads` : médiane coin par coin (x et y séparément, moyenne des deux centrales si pair), rejet des quads dont un coin
  est à > `maxSpreadPx` (défaut 8 px) du coin médian, médiane recalculée ; `spreadPx` = médiane des distances au coin médian ;
  `null` si < 2 quads valides (finis et non rejetés). Usage : 5 dernières images de l'aperçu, rafale de 3 photos.
- `consistency` : `deltaPct` signé = (mesure − connue) / connue × 100 ; |Δ| ≤ 1,5 % `ok`, ≤ 4 % `check`, sinon `mismatch`.
  Hauteur connue ≤ 0 ou non finie, ou mesure non finie → `{ deltaPct: NaN, verdict: "check" }`.

### 6.4 Pipeline
```ts
measurePhoto({ …, refineWallQuad?: boolean, checkSharpness?: boolean }) → AutoSurveyResult & {
  wallRefinement: WallQuadRefinement | null;   // repère pleine résolution
  sharpness: SharpnessResult | null;
  confidence: number;                          // < 0,8 ⇒ bannière « Mesure à vérifier avant d'envoyer le devis »
}
withQualityWarnings(survey, { sharpness, reference, distortion }, refQuad) → WallSurvey   // étape exposée (tests, module)
ReferenceDetection.candidates?: Array<{ kind; quad; score }>   // meilleur d'abord ; à proposer à l'utilisateur si ambiguë
ReferenceDetection.ambiguous?: boolean                          // second score > 0,7 × le meilleur
```
- Avec `full` : arêtes du mur échantillonnées sur l'originale → k1 sur polylignes denses (repli v1 si < 2 lignes) →
  `refineWallQuad(full, quad × facteur, { searchPx: 2 × facteur + 4, k1 })` ; les coins ne sont remplacés que si `refined`.
  Coins fournis par l'utilisateur : non affinés sauf `refineWallQuad: true`.
- `confidence` = min(confiance de la référence, confiance des coins), plafonnée à 0,5 si un code de refus,
  `reference_ambiguous` ou `reference_scale_suspect` est présent, à 0,79 si un autre avertissement de fiabilité est présent
  (`baseboard_height_required` exclu). 0 en cas d'échec.

### 6.5 Codes d'avertissement ajoutés (`WARN`, clés i18n, jamais de texte)
Seuils de docs/quality-thresholds.md (« Banc de réalisme »). Les codes de **refus** sont listés dans `REFUSAL_WARNINGS` : l'UI demande une
reprise et bloque l'envoi du devis tant que la mesure n'est ni corrigée ni confirmée.

| Code | Émis par | Condition | Nature |
|---|---|---|---|
| `measure_implausible` | `rectify` | H ∉ [180 ; 450] cm ou W ∉ [100 ; 1 200] cm | refus |
| `reference_scale_suspect` | `rectify` | f = grand côté de la référence / H ∉ [4 % ; 14 %] (A4 : H < 2,12 m ou > 7,4 m) | avertissement fort (confiance ≤ 0,5) |
| `reference_small` | `rectify` | petit côté de la référence 40–55 px (image de travail) | avertissement |
| `reference_too_small` (existant) | `rectify` | < 40 px | refus |
| `reference_ambiguous` | `measurePhoto` | `ambiguous`, ou centre de la référence hors du tiers central en largeur / hors [15 % ; 85 %] en hauteur du mur | avertissement fort (confiance ≤ 0,5) |
| `image_soft` | `measurePhoto` | `sharpness` = `soft` (flou σ ≈ 1,5–2 px, bougé ≈ 4–6 px) | avertissement |
| `image_blurry` | `measurePhoto` | `sharpness` = `blurry` (flou σ ≥ 2 px, bougé ≥ 6–8 px) | refus |
| `distortion_strong` | `measurePhoto` | max(\|k1\|, \|rawK1\|) > 0,05 | avertissement |
| `distortion_extreme` | `measurePhoto` | max(\|k1\|, \|rawK1\|) > 0,10 | refus |

Non constatable par le moteur, à la charge de l'UI : gondolage de la feuille (seul `reference_aspect_mismatch` en capte une partie),
surexposition de la feuille, inclinaison du téléphone (capteurs). Correction documentaire : dans le modèle de division du dépôt,
**k1 < 0 = barillet** (commentaire de `src/distortion.ts` corrigé).
