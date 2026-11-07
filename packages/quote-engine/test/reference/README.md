# Cas de référence du moteur de devis (DÉMO, simulés — à remplacer par les ≥ 40 devis réels de Soufflet)

## `cases.json` — devis A–F (règle « Léa », formule simple §5.1)

Calculés à la main selon docs/simulation/reponses-questions-bloquantes.md §5–7 : rouleau 53 × 1005 cm sauf mention,
marge 5 + 5 cm, hauteur de lé arrondie au raccord (+ décalage sur chaque lé si raccord sauté), rouleau de réserve si raccord,
ouvertures > 2 m² déduites de la surface facturable (jamais des lés), TVA 8,1 %, total TTC arrondi aux 5 ct.

`reference.test.ts` vérifie trois choses :
1. `computeRollsSimple` redonne exactement les valeurs attendues (hauteur de lé, lés, lés par rouleau, rouleaux, surface) ;
2. `planStrips` avec les mêmes ouvertures **non positionnées** (`areaOnlyOpenings`) redonne les **mêmes rouleaux** ;
3. `computeQuote` sur A et B redonne les lignes, la TVA et le total **au centime** (80 645 et 98 910).

### Écarts documentés (les deux valeurs sont conservées dans les tests)
| Cas | Formule simple | Calepinage avec ouverture positionnée | Pourquoi |
|---|---|---|---|
| C — porte 90 × 210 à x = 200 | 3 rouleaux | **2** | le lé au-dessus de la porte ne fait que 60 cm et tient dans la chute du rouleau 1 |
| D — fenêtre 180 × 140 à x = 160, raccord 32 | 5 (4 + réserve) | **4** (3 + réserve) | deux lés coupés en 20 + 105 cm placés dans les chutes |
| E — raccord sauté 53 / 26,5 | 3 | 3 | l'alternance exacte des phases coûte ici autant que « + offset sur chaque lé » |
| A, B, F | 3 / 4 / 2 | identiques | murs nus : le calepinage redonne la formule simple |

Le calepinage ne commande **jamais plus** de rouleaux que la formule simple (test paramétrique sur 400 murs aléatoires) :
la variante « lés entiers, ordre des lés » reproduit la borne de la formule simple, et la variante « morceaux » ne gagne que
lorsqu'elle économise réellement un rouleau.

## `calepinage.json` — calepinage lé par lé (contrat `measurement-api.md` §3)

22 murs + 2 pièces calculés à la main (`explanation` dans chaque cas) : mur simple, porte, fenêtre, deux fenêtres,
porte-fenêtre pleine hauteur (lés sautés), plinthes mesurées / plinthe manquante (refus `baseboard_height_missing`),
trapèze, raccord droit, raccord sauté (pair et impair → phase de sortie), départ centré (axe et point), panoramique au m²,
zone exclue, radiateur, minimum fournisseur, niches superposées (morceau « entre »), ouverture minuscule (lés entiers
retenus), rouleau échantillon (formule simple inapplicable), lé plus long que le rouleau (refus), pièce de 3 murs
(empaquetage commun 9 au lieu de 11), pièce de 2 murs en raccord sauté (phase chaînée dans l'angle).

Conventions : marges 5 + 5 cm, seuil de déduction 1 m² (défaut spec v1), radiateur jamais déduit, zone exclue toujours
déduite, réserve si raccord ; toutes les longueurs sont arrondies au mm par le moteur.
