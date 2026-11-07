# Mesure précise des murs — base de brainstorm (v0, à discuter ensemble)

Owner : lead-architect + measurement-engineer · 2026-11-07 · Statut : **proposition pour discussion**, rien n'est figé.

## 0. Ce que « précision chirurgicale » veut dire pour un devis de papier peint

Le devis dépend de nombres **discrets** : des lés entiers, des rouleaux entiers. L'erreur de mesure ne coûte rien tant qu'elle ne
fait pas basculer un arrondi, et coûte un lé ou un rouleau entier quand elle le fait. Exemples avec un rouleau 70 cm × 10,05 m :

| Mesure réelle | Seuil le plus proche | Conséquence d'une erreur de mesure |
|---|---|---|
| Largeur 4,18 m → 5,97 lés → 6 lés | 4,20 m (6 lés exactement) | +3 cm → 6,01 → **7 lés** : un lé de plus, parfois un rouleau |
| Hauteur 2,40 m → lé de 2,50 (avec 5 + 5 cm) → 10,05 / 2,50 = **4 lés par rouleau** | 2,41 m | +2 cm → lé de 2,52 → 3,99 → **3 lés par rouleau** : jusqu'à un tiers de rouleaux en plus. Les plafonds à 2,40 m sont courants : c'est le cas le plus sensible |
| Hauteur 2,60 m → lé de 2,70 → 3 lés par rouleau | 3,25 m (passage à 2 lés) | +6 cm → toujours 3 : aucune |
| Raccord 64 cm, hauteur 2,50 → lé de 2,60 → arrondi à 5 raccords = 3,20 m → 3 lés par rouleau | 3,10 m (6 raccords = 3,84 m → 2 lés par rouleau) | les seuils sont des multiples du raccord moins la marge : à ±1 cm d'un seuil, le laser tranche |

Conclusion : il faut (1) une mesure **au centimètre** sur la largeur (c'est elle qui fait basculer les lés), (2) une hauteur à ±1 cm
pour les raccords, (3) et surtout **savoir quand on est près d'un seuil** : l'app doit afficher « 5,97 lés : à 2 cm du 7e lé,
vérifier la largeur au laser ». C'est ça la précision chirurgicale : pas un chiffre à trois décimales, mais **l'incertitude
affichée et exploitée** par le calcul.

Cible proposée : **±1 cm (0,5 %) sur largeur et hauteur du mur, ±2 cm sur les ouvertures**, confiance calculée, et un mode
« laser » qui ramène à ±2 mm quand le seuil est proche.

## 1. Le relevé de mur (objet métier)

Un mur n'est pas un rectangle. Modèle proposé :

```
Wall
  outline: Polygon (cm, repère du plan du mur)   // rectangle par défaut ; trapèze sous combles ; pignon
  zones: [ { kind: "wallpaper" | "excluded", polygon } ]   // ex. au-dessus d'une cimaise seulement
  openings: [ { kind: "door" | "window" | "niche" | "beam" | "fireplace" | "radiator", polygon, depth_cm, deduct: auto|yes|no } ]
  baseline: { kind: "floor" | "plinthe" | "cimaise", offset_cm }   // le papier s'arrête où ?
  ceiling: { kind: "flat" | "sloped" | "corniche", ... }
  measurement: { method, confidence, uncertainty_cm: { w, h }, laser: bool, corrected_by_user }
```

Règles métier à confirmer avec Nicolas (c'est lui qui pose) :
- Portes et fenêtres : déduites de la **surface facturée** au-delà d'un seuil (2 m² ?) ; jamais des lés… sauf si l'ouverture
  traverse toute la hauteur d'un lé (porte-fenêtre du sol au plafond) — là on économise un lé.
- Radiateurs : jamais déduits (on tapisse derrière ou on coupe autour).
- Plinthes : le papier s'arrête en haut de la plinthe → hauteur utile = hauteur sous plafond − plinthe (6 à 12 cm). Cimaise /
  soubassement : zone séparée.
- Combles / pentes : lés de longueurs différentes → calcul lé par lé, pas par formule.

## 2. Calepinage (plan de coupe) : le vrai calcul

La formule actuelle (`nb_lés / lés_par_rouleau`) est celle des calculettes. Le poseur, lui, fait un **calepinage** : lé par lé, il
sait qu'au-dessus d'une porte il ne faut qu'un morceau de 50 cm, qu'au-dessus et au-dessous d'une fenêtre il faut deux morceaux,
et il **récupère** ces chutes dans les rouleaux. Proposition : implémenter le calepinage exact :

1. Découper le mur en lés verticaux de largeur `roll_width` à partir d'un point de départ (choix : coin gauche, centré sur le
   mur ou sur la cheminée — règle du métier : on centre souvent le motif sur le point focal).
2. Pour chaque lé, intersecter avec les ouvertures → liste de **morceaux** (hauteur de chaque morceau + marges de coupe haut/bas).
3. Avec raccord : chaque morceau commence à une position de motif imposée → sa longueur à prélever = longueur utile + attente
   de raccord (jusqu'à un raccord complet ; raccord sauté : décalage d'un demi-raccord un lé sur deux).
4. **Empaquetage** des morceaux dans des rouleaux de 10,05 m (bin packing, premier ajustement décroissant, en respectant la
   position de motif) → nombre de rouleaux exact + plan de coupe imprimable (« rouleau 1 : lé 1 (2,70), lé 2 (2,70), lé 3 (2,70),
   chute 1,95 ; rouleau 2 : … »).
5. Sortie : nb de rouleaux, **chute totale**, plan de coupe, et le fameux `trace[]` (« Pourquoi 7 rouleaux ? »).

Pourquoi c'est le cœur : c'est ce qui rend le devis **juste à zéro rouleau** par rapport au poseur, et ce que personne n'offre au
client en direct. Il faut le valider contre 40 chantiers réels de Nicolas.

## 3. Comment mesurer : les méthodes, leur précision réelle, et quand les utiliser

| Méthode | Comment | Précision réaliste | Détecte les ouvertures ? | Quand |
|---|---|---|---|---|
| **A. AR native (ARCore sur Android, ARKit sur iPhone)** | l'app ouvre la caméra, l'utilisateur balaie le mur 2–3 s, ARCore trouve le plan vertical et l'échelle ; on tape les 4 coins du mur puis les coins de chaque ouverture **sur le plan** | 1–3 cm jusqu'à 3 m, 2–5 cm de 3 à 10 m (murs clairs et unis = pire cas : peu de texture) | non (on les tape) ; iPhone Pro + RoomPlan : oui (LiDAR) | visite à domicile, défaut |
| **B. Télémètre laser Bluetooth** (Bosch GLM 50 C / GLM 100 C, Leica DISTO D2/D510/X3/X4) | le laser envoie chaque mesure à l'app (BLE) ; l'app sait quelle cote elle attend (« largeur », « hauteur », « hauteur de la fenêtre ») | **±1,5–2 mm** | non (géométrie par l'app) | **quand un seuil est proche**, et pour le devis final |
| **C. Photo + référence** (hauteur sous plafond connue, A4, prise 85 mm, porte) + homographie | prototype actuel | 3–5 % | non (tracées à la main) | photo envoyée par le client, showroom |
| **D. Segmentation IA de la photo** (modèle ONNX on-device ou serveur) | propose automatiquement le mur, les fenêtres, les portes, les radiateurs ; l'utilisateur corrige | géométrie seulement (pas d'échelle) | **oui**, c'est son rôle | accélérer le relevé des ouvertures en A et C |
| **E. Profondeur métrique mono-image** (Depth Pro, Metric3D) | une photo → distances en mètres | 10–25 % | non | ordre de grandeur, pré-placement des coins |

Proposition de cascade « chirurgicale » : **A pour la géométrie et la forme (mur + ouvertures), B pour les cotes qui comptent,
D pour aller vite, C en secours, E jamais pour facturer.** L'incertitude de chaque cote est propagée jusqu'au calepinage, qui
signale les seuils proches et demande le laser **seulement là où ça change le devis**.

Le S24 : ARCore oui (Depth API par le mouvement, pas de LiDAR). Bluetooth : oui. Donc A + B + D sont possibles dès la première
version Android ; RoomPlan (ouvertures automatiques) n'existe que sur iPhone/iPad Pro.

## 4. Les pièges géométriques (et comment on les traite)

- **Coplanarité** : l'homographie et le plan AR supposent que tous les points sont dans le plan du mur. Une fenêtre a une
  embrasure : on tape le **nu du mur** (l'angle entre le mur et l'embrasure), pas le vitrage.
- **Distorsion de l'objectif** (photo importée) : grand-angle de téléphone = barillet ; sans correction, 1–2 % d'erreur aux bords.
  Mitigation : EXIF + profil d'objectif pour les appareils connus ; sinon pénaliser la confiance.
- **Murs non rectangulaires** : mesurer les deux hauteurs (gauche/droite) et les deux largeurs (haut/bas) ; le polygone remplace le
  rectangle ; le calepinage gère des lés de longueurs différentes.
- **Plafond rampant** : lés trapézoïdaux → longueur du lé = hauteur max de son intervalle.
- **Plinthe, corniche, cimaise** : la ligne de base n'est pas le sol. Toujours demander « le papier s'arrête où ? ».
- **Angles de pièce** : un mur = un plan ; une pièce = plusieurs murs à relever séparément, mais le **raccord passe d'un mur à
  l'autre** (le motif continue dans l'angle) : le calepinage doit chaîner les murs.
- **Éclairage** et murs blancs : ARCore décroche sur un mur uni sans texture → l'app guide : « vise le coin, la prise, la plinthe ».
- **Erreur humaine** : le vendeur tape un coin à 3 cm du vrai coin. Aides : zoom loupe au doigt, aimantation sur les arêtes
  détectées (détection de lignes dans l'image autour du doigt), confirmation par la cote laser.

## 5. Le parcours « relevé chirurgical » (UX proposée)

1. **Cadrer** : caméra live, ARCore trouve le plan → halo sur le mur, « Mur détecté, 2,8 m de distance ».
2. **Coins** : 4 taps avec loupe et aimantation ; l'app dessine le rectangle sur le mur ; cotes affichées en direct avec ± : « 4,18 m ± 2 cm ».
3. **Base et haut** : « Le papier commence en haut de la plinthe ? » (oui / sol / cimaise) ; « Plafond droit ? » (droit / rampant).
4. **Ouvertures** : « Ajoute une fenêtre » → 2 taps (coins opposés) ; propositions automatiques par segmentation à confirmer ;
   type (porte/fenêtre/niche/radiateur) ; profondeur d'embrasure si on tapisse dedans.
5. **Seuils** : l'app calcule le calepinage pour le papier choisi (ou un rouleau standard) et dit : « 5,97 lés : à 2 cm du 7e lé.
   Mesure la largeur au laser ? » → cote BLE reçue → recalcul → « 6 lés confirmés ».
6. **Photo** : au déclenchement, l'app enregistre la photo **et** la géométrie (coins, ouvertures, pose de caméra) → le rendu est
   exact et les lés s'affichent au bon endroit, les ouvertures sont exclues du rendu automatiquement.
7. **Relevé** : fiche de mesure horodatée (méthode, incertitudes, laser oui/non, qui a mesuré) attachée au devis — c'est aussi la
   preuve en cas de litige.

## 6. Comment on prouve la précision

- **Banc d'essai** : 20 murs réels (chantiers de Nicolas), chacun mesuré au laser (vérité terrain) ; pour chaque méthode on note
  l'écart en cm et le nombre de fois où le calepinage change. Rapport `docs/reports/measurement-benchmark.md`.
- Seuils de sortie Phase 1 : AR ≤ 2 cm d'écart médian jusqu'à 4 m ; photo + référence ≤ 4 % ; **0 rouleau d'écart** sur 40 devis
  quand le laser est utilisé aux seuils.
- Tests unitaires du calepinage : cas de référence construits à la main (porte, fenêtre, deux fenêtres, raccord sauté, combles),
  100 % de couverture.

## 7. Décisions à prendre ensemble

1. **Télémètre laser** : Nicolas en a-t-il un ? Quelle marque (Bosch GLM C / Leica DISTO) ? Si oui, on branche le BLE en priorité : c'est
   le levier de précision le moins cher (protocole Bosch MT documenté par la communauté ; Leica DISTO compatible BLE, SDK officiel sur demande).
2. **Règles de déduction** exactes (seuil, porte-fenêtre, radiateur, plinthe, cimaise) : à écrire avec Nicolas, elles deviennent des tests.
3. **Point de départ du calepinage** : coin gauche ou motif centré ? (règle d'atelier)
4. **Segmentation IA des ouvertures** : on l'investit en Phase 2 (modèle ONNX ~10 Mo on-device) ou on reste manuel (2 taps par ouverture) ?
5. **Multi-murs et angles** : la pièce entière dès la v1 (raccord dans les angles) ou mur par mur ?
6. **Qui mesure** : seulement Nicolas (mode pro, laser) ou aussi le client sur le site (mode client, photo + hauteur sous plafond,
   estimation ±5 % clairement annoncée) ? Les deux probablement, avec des promesses différentes.
7. **Tolérance affichée au client** : montrer « ± 3 % » sur l'estimation web, ou seulement « estimation, devis après visite » ?
