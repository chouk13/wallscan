# Banc réel — journal (lot M7)

Photos prises au Samsung Galaxy S24 par NLPGenerator. Les photos restent hors du dépôt public (`bench-real/`, ignoré par git) :
ce sont des intérieurs privés. Chaque entrée : conditions, ce que le moteur a trouvé, écart si la cote réelle est connue.

| # | Date | Scène | Référence | Résolution reçue | Moteur avant correctif | Moteur après correctif | Cote réelle | Écart |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-08 | Pan de mur étroit (entrée) entre un angle rentrant et une armoire ; plinthe ~8 cm ; interrupteur ; **plafond hors cadre** ; mire imprimée, scotchée en haut seulement (léger gondolement) | mire v1 | 1659 × 2212 (copie transmise par le chat, pas l'original) | mire **non détectée** (deux causes : taille max 12,5 % du grand côté dépassée ; motif/repères du détecteur ≠ PDF imprimé) ; coins du mur : aucun (pas de plafond) → mesure manuelle fausse 0,29 × 0,48 m | mire détectée (confiance 1,00, code lu) ; lignes sol / gauche / droite trouvées, plafond absent signalé ; en direct : 115 ms par image à 560 px | à mesurer au mètre | — |

## Correctifs issus de la photo 1

1. `detectReference` : taille maximale de la référence portée de 12,5 % à 40 % du grand côté (70 % en direct) — l'utilisateur
   peut être proche ou ne cadrer qu'une partie du mur.
2. Mire : détecteur et spec alignés sur le PDF imprimé (repères 15 mm à 20 mm du cadre, code 5 × 5 de 10 mm, motif fixe).
   Voir `docs/specs/mire.md`, historique.
3. Analyse de la photo : la mire est cherchée avant la feuille quel que soit le choix annoncé ; quand les 4 bords ne sont pas
   tous visibles, un quad partiel est construit et l'écran dit lequel manque au lieu d'un cadre par défaut muet.
4. Viseur : guidage en direct (feuille/mire détectée et bien placée, plafond / sol / bords, coins proposés) — demande du client
   après la photo 1.

## Protocole pour les photos suivantes

Mire ou A4 bien à plat (ruban aux 4 coins), à hauteur des yeux au milieu du mur ; photo de face à 2–3 m, **plafond et sol dans le
cadre**, pas de ×0,5 ; puis largeur et hauteur du mur au mètre (et hauteur de plinthe). Transmettre la photo **originale** (pas
une copie compressée par une messagerie) et les cotes.
