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
| Repères d'angle (4) | à 20 mm des bords extérieurs du cadre : (30, 30), (165, 30), (165, 252), (30, 252) ; centres à 27,5 mm | 15 × 15 (un carré en haut à gauche, trois disques) | noir |
| Code 5 × 5 | centré sur le cadre : origine (80, 123,5), cellules de 10 × 10 | 50 × 50 | noir / blanc, motif fixe |

La **dimension mesurée** par le pipeline est le bord extérieur du cadre noir : **190 × 277 mm** (`MIRE_OUTER_CM`). Les coins sont
affinés en sous-pixel sur la transition blanc → noir, nette à l'impression laser ; c'est pour cela que la mire est plus précise
qu'une feuille blanche dont le bord est lu contre un mur de teinte variable.

## Code (25 cellules, ligne par ligne depuis le haut-gauche en portrait, cellule noire = 1)

- Motif fixe `1011001001110100010110111` (`MIRE_CODE_PATTERN`). Le détecteur essaie les 4 rotations du cadre et accepte le motif
  à **2 cellules près** (`MIRE_CODE_MAX_ERRORS`) ; les trois rotations du motif en diffèrent d'au moins 12 cellules, donc
  l'orientation est sans ambiguïté et une fenêtre, un cadre ou un tableau ne décodent jamais.
- Une seule mire est imprimée en v1 : `code` vaut toujours `0`. Un futur format (A3, mire d'angle) prendra un autre motif.

### Historique — correction du 2026-11-08 (première photo réelle)

La première version de cette spec décrivait des carrés de 20 mm à 30 mm du cadre et un code 4 × 4 de 15 mm portant un
identifiant 6 bits + complément. Le PDF livré (`scripts/build-mire.py`, vérifié à 0,5 mm au banc d'impression) avait été dessiné
avec les cotes ci-dessus (repères 15 mm à 20 mm, code 5 × 5 de 10 mm) : le détecteur ne lisait donc jamais la mire imprimée,
alors que le banc synthétique, qui dessinait la mire selon la spec, la lisait à 100 %. La mire imprimée étant déjà en
circulation et sa dimension mesurée (cadre 190 × 277) inchangée, c'est le détecteur et la spec qui ont été alignés sur le PDF.
Leçon retenue : le PDF est désormais vérifié **contre `MIRE_LAYOUT`** (même source) et toute mire doit être lue sur une photo
réelle avant livraison.

## Conditions de lecture (mesurées sur le banc synthétique, image de travail 2048 px)

- Détection fiable dès ~45 px de côté court sur l'image de travail (feuille à ≤ 5 m du téléphone pour un mur de 5,5 m) ;
  avertissement `reference_too_small` sous 40 px.
- Cadre noir : seuillage adaptatif « sombre » (seuil ≥ 20 niveaux) ; contraste cadre / papier exigé ≥ 40 niveaux ; au plus 2
  échantillons incohérents sur 68 (ligne médiane du cadre, marges, carrés).
- Pose : bien à plat (ruban aux quatre coins), n'importe quelle orientation (portrait ou paysage), rotation quelconque.
