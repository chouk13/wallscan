# Mire WallScan — géométrie de référence (v1)

Owner : measurement-engineer · 2026-11-07 · Statut : **implémentée dans `packages/measurement` (détection + décodage), PDF imprimable à produire par tech-writer (lot M6)**.

La mire est une feuille A4 imprimée qui sert de référence d'échelle « chirurgicale » (docs/specs/mesure-photo-v1.md §2.1).
Toute la géométrie ci-dessous est codée dans `packages/measurement/src/constants.ts` (`MIRE_LAYOUT`, `mireCodeCells`,
`decodeMireCells`) et utilisée à l'identique par le détecteur (`detectReference`) et par le rasteriseur du banc synthétique.
**Le PDF doit respecter ces cotes à 0,2 mm près** et être imprimé à 100 % (pas d'« ajuster à la page »).

## Cotes (mm), feuille A4 portrait 210 × 297, origine au coin haut-gauche de la feuille

| Élément | Position (x, y) | Taille | Couleur |
|---|---|---|---|
| Marge blanche | 0, 0 | 210 × 297 | blanc (papier) |
| **Cadre noir, bord extérieur** | 10, 10 | **190 × 277** | noir plein |
| Cadre noir, épaisseur | — | 10 | — |
| Intérieur blanc | 20, 20 | 170 × 257 | blanc |
| Carrés de repère (4) | à 30 mm des bords extérieurs du cadre : (40, 40), (150, 40), (150, 237), (40, 237) | 20 × 20 | noir |
| Code 4 × 4 | centré sur le cadre : origine (75, 118,5), cellules de 15 × 15 | 60 × 60 | noir / blanc |

La **dimension mesurée** par le pipeline est le bord extérieur du cadre noir : **190 × 277 mm** (`MIRE_OUTER_CM`). Les coins sont
affinés en sous-pixel sur la transition blanc → noir, nette à l'impression laser ; c'est pour cela que la mire est plus précise
qu'une feuille blanche dont le bord est lu contre un mur de teinte variable.

## Code (16 cellules, ligne par ligne, cellule noire = 1)

- Cellule 0 (haut-gauche) = noire ; cellules 3, 12, 15 (autres coins) = blanches → **orientation** (les 4 rotations sont essayées
  au décodage, une seule passe).
- 12 cellules restantes dans l'ordre `[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]` : les 6 premières portent l'identifiant (6 bits,
  0–63, bit 0 en premier), les 6 suivantes son **complément** bit à bit → validation sans ambiguïté (une fenêtre, un cadre ou un
  tableau ne décodent jamais).
- Identifiant v1 : **22** (réservé « mire WallScan A4 v1 ») ; les autres valeurs restent disponibles pour de futurs formats
  (A3, mire d'angle). Le détecteur accepte tout identifiant et le renvoie dans `code`.

## Conditions de lecture (mesurées sur le banc synthétique, image de travail 2048 px)

- Détection fiable dès ~45 px de côté court sur l'image de travail (feuille à ≤ 5 m du téléphone pour un mur de 5,5 m) ;
  avertissement `reference_too_small` sous 40 px.
- Cadre noir : seuillage adaptatif « sombre » (seuil ≥ 20 niveaux) ; contraste cadre / papier exigé ≥ 40 niveaux ; au plus 2
  échantillons incohérents sur 68 (ligne médiane du cadre, marges, carrés).
- Pose : bien à plat (ruban aux quatre coins), n'importe quelle orientation (portrait ou paysage), rotation quelconque.
