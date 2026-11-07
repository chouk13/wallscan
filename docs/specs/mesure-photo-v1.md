# Mesure chirurgicale à partir d'une photo — spécification v1

Owner : lead-architect · measurement-engineer · 2026-11-07 · Statut : **validée et implémentée (lots M1–M6 livrés dans la v5 ; M7 banc réel à faire)**.
Décisions du client (7 nov.) : mesure **depuis une photo** (pas de laser, pas d'AR native) · hauteur **du haut du mur jusqu'en bas**,
avec option **avec / sans plinthes** · calepinage **au choix** (départ coin gauche ou motif centré) · ouvertures **détectées
automatiquement** · **pièce entière** dès la v1 · utilisateur principal : **le client, sur son téléphone, dans le site** ·
tolérance affichée : **± 3 %**.

## 1. Le problème, en une phrase

Une photo n'a pas d'échelle. Pour mesurer un mur au centimètre depuis une photo, il faut **quelque chose de taille connue, posé
dans le plan du mur**, et une géométrie qui transforme les pixels en centimètres **sans dépendre de la position du téléphone**.

## 2. La solution : une feuille A4 (ou la mire imprimée) + le mur lui-même comme règle

### 2.1 Deux références, du plus précis au plus simple
1. **La mire WallScan** (PDF A4 à imprimer depuis le site) : cadre noir de 10 mm, quatre carrés de repère dans les coins, un code
   au centre (pour la reconnaître et l'orienter), dimensions imprimées connues à 0,2 mm près. Détection **automatique** en
   sous-pixel : c'est l'option « chirurgicale ».
2. **Une feuille A4 blanche** (tout le monde en a une) : 210 × 297 mm exactement. Détection automatique si elle contraste avec le mur
   (mur coloré ou foncé) ; sur mur blanc, le client tape ses 4 coins avec la loupe. Précision un peu moindre (bord moins net).

La feuille est fixée **au milieu du mur, à hauteur des yeux**, bien à plat (deux morceaux de ruban). Le client peut aussi donner la
**hauteur sous plafond** s'il la connaît : elle sert de contrôle de cohérence, pas de mesure (le client se trompe souvent de 10 cm).

### 2.2 Pourquoi le mur est la meilleure règle
Les 4 coins d'un mur rectangulaire sont **4 points coplanaires aux côtés parallèles**. Avec ces 4 coins on calcule l'homographie
qui « redresse » la photo en vue de face (perspective annulée), **indépendamment de l'endroit où était le téléphone**. Il ne manque
alors qu'un seul nombre : l'échelle (combien de centimètres par pixel redressé). C'est là que la feuille intervient : mesurée
dans l'image redressée, près de son centre, elle donne l'échelle **en largeur et en hauteur** (deux contrôles indépendants).
Résultat : la feuille n'a pas besoin d'être grande ni d'être lue de loin, parce qu'elle ne sert qu'à l'échelle, pas à la perspective.

### 2.3 Le calcul, étape par étape (packages/measurement, TypeScript pur, testé à 100 %)
1. **Pré-traitement** : image réduite à 2 048 px de côté long (travail), originale conservée pour la loupe. Correction d'orientation EXIF.
2. **Détection de la référence** : seuillage adaptatif + contours + ajustement de quadrilatère ; pour la mire, décodage du code et
   affinage **sous-pixel** des 4 coins (ajustement sur le gradient) ; pour la feuille, affinage sur les bords. Échec → saisie manuelle
   des 4 coins avec loupe ×3.
3. **Proposition des coins du mur** : détection des grandes lignes (plafond, sol/plinthe, angles verticaux) par transformée de Hough
   probabiliste sur l'image réduite ; intersection des lignes dominantes → 4 coins proposés ; **aimantation** : quand le client déplace
   un coin, il s'accroche à l'arête la plus proche (±12 px) ; loupe ×3 avec réticule.
4. **Redressement** : homographie H (coins du mur → rectangle de proportions inconnues) ; les proportions sont fixées par la
   feuille (largeur/hauteur connues) ; vérification : les deux côtés opposés du mur redressé doivent être égaux à ±1 % (sinon
   « coin mal placé » signalé).
5. **Échelle** : px/cm = moyenne pondérée des deux échelles de la feuille (largeur, hauteur) ; écart entre les deux > 1,5 % →
   feuille pas à plat ou mal taquée → on redemande.
6. **Dimensions** : largeur = distance redressée entre coins gauche/droit (moyenne haut/bas) ; hauteur = idem (moyenne gauche/droite) ;
   si les deux hauteurs diffèrent de plus de 2 %, le mur n'est pas rectangulaire → on garde un **trapèze** (les deux hauteurs).
7. **Distorsion d'objectif** (v1 simple) : on mesure la courbure des lignes du plafond et du sol dans la photo ; si > 0,3 %, on
   corrige par un terme radial estimé pour les rendre droites (les téléphones ont 0,5–1,5 % de barillet sur le grand-angle).
   Le client est guidé pour **ne pas utiliser l'ultra grand-angle** (×0,5) : distorsion trop forte.
8. **Incertitude** : propagation de ±0,5 px (mire) ou ±1,5 px (feuille) sur les coins de la référence, ±3 px sur les coins du mur,
   ±0,3 % de distorsion résiduelle → `uncertainty_cm` pour W et H. Affiché « ± 3 % » au client (plafond), valeur réelle en mode pro.

### 2.4 Budget d'erreur (mur 4 m × 2,5 m, photo 4 000 px, feuille à 3,5 m du téléphone ≈ 95 px de large)
| Source | Mire (auto, sous-pixel) | Feuille A4 (bords) | Feuille A4 tapée à la main |
|---|---|---|---|
| Échelle (coins de la référence) | 0,5 % | 1,2 % | 2,5 % |
| Coins du mur (±3 px sur 3 600 px) | 0,1 % | 0,1 % | 0,1 % |
| Distorsion résiduelle | 0,3 % | 0,3 % | 0,3 % |
| Feuille pas parfaitement à plat (2° d'inclinaison) | 0,1 % | 0,1 % | 0,1 % |
| **Total (quadratique)** | **≈ 0,6 % → 2,4 cm** | **≈ 1,3 % → 5 cm** | **≈ 2,5 % → 10 cm** |

Conclusion : la mire tient largement les 3 % ; la feuille tapée à la main est à la limite. D'où la règle : **mire ou feuille
détectée automatiquement → « précision ± 3 % » ; feuille tapée à la main → « estimation ± 5 % »**, et dans tous les cas
l'estimation est présentée **en fourchette** (voir §5).

## 3. Les ouvertures (automatique, confirmé par le client)

1. **Proposition automatique** (v1, sans réseau, dans le navigateur) : dans l'image redressée, recherche de rectangles alignés sur
   les axes : fenêtres = zones très claires ou très contrastées bordées de lignes droites ; portes = rectangles verticaux de
   70–100 cm de large partant du sol ; radiateurs = rectangles bas, sous une fenêtre. Chaque proposition a un type et un score.
2. **Confirmation** : le client voit les rectangles proposés, les ajuste (poignées + loupe), change le type, en ajoute (2 taps : deux
   coins opposés) ou en supprime. Rien n'est déduit sans confirmation.
3. **Phase 2** : modèle de segmentation léger (ONNX, ~8 Mo, chargé à la demande) pour améliorer les propositions sur les cas
   difficiles (fenêtres avec rideaux, portes vitrées).
4. **Règles de déduction (proposées, à confirmer par Nicolas)** : surface déduite pour toute ouverture > 1 m² ; les lés ne sont
   jamais réduits en nombre ; un lé entièrement occupé par une ouverture pleine hauteur (porte-fenêtre) est supprimé ; radiateurs
   et prises : jamais déduits ; cheminée/coffrage en saillie : traité comme une zone exclue.

## 4. Plinthes, hauteur, calepinage

- **Hauteur** : du plafond (ou de la corniche) jusqu'au sol. Bascule **« avec plinthes / sans plinthes »** : avec plinthes, le
  papier s'arrête en haut de la plinthe. La hauteur de plinthe est **toujours réelle** : mesurée sur la photo (le client tape le
  haut de la plinthe, aimantation sur l'arête, conversion en cm par l'homographie ; proposée automatiquement quand deux lignes
  basses parallèles sont détectées) **ou saisie par l'utilisateur**. **Jamais de valeur par défaut** : tant qu'elle n'est ni mesurée
  ni saisie, l'option reste inactive. La simulation visuelle et le devis suivent la bascule.
- **Calepinage** (packages/quote-engine, lé par lé) : deux modes au choix, **départ coin gauche** ou **motif centré** (axe du mur ou
  point tapé par le client, par exemple au-dessus du canapé) ; morceaux calculés par lé en tenant compte des ouvertures et des raccords ;
  empaquetage des morceaux dans les rouleaux ; plan de coupe et chute.
- **Pièce entière (v1)** : une photo **par mur**, les murs sont chaînés dans l'ordre (gauche → droite) ; le raccord continue dans
  l'angle (phase du motif reportée d'un mur au suivant) ; total de la pièce = somme des murs avec empaquetage commun des rouleaux.

## 5. Ce que voit le client (mode client, sur le site, sur son téléphone)

1. **Préparer** — « Fixez une feuille A4 au milieu du mur » (ou « Imprimez la mire → »), schéma animé 3 secondes.
2. **Photographier** — guide dans le viseur : niveau (DeviceOrientation : « redressez le téléphone »), cadre « tout le mur, du plafond
   au sol », rappel « pas de grand-angle ». La photo est prise avec l'appareil natif (`capture=environment`).
3. **Vérifier** — la feuille est détectée (cadre vert) ; les 4 coins du mur sont proposés ; le client ajuste avec la loupe ; les
   ouvertures proposées apparaissent, il confirme. Tout se fait sur l'image **redressée** (vue de face), bien plus facile à juger.
4. **Résultat** — « Mur de 4,18 m × 2,50 m (± 3 %), 9,6 m² hors fenêtre », bascule plinthes (hauteur mesurée sur la photo ou saisie), puis le rendu et l'estimation.
5. **Estimation en fourchette** — parce que ± 3 % peut faire basculer un lé, l'estimation est calculée pour W et H à −3 % et +3 % :
   « Estimation : CHF 1 980 – 2 240 TTC pose comprise. Devis définitif sous 48h après visite. » Quand la fourchette est serrée
   (aucun seuil dans la bande), un seul chiffre est affiché.
6. **Rendu** : les ouvertures confirmées sont **exclues du rendu** (le papier ne couvre plus la fenêtre) ; les lés affichables.

Rien ne quitte le téléphone : la détection tourne dans le navigateur (JavaScript/WebAssembly maison, pas d'OpenCV de 8 Mo),
la photo n'est pas envoyée.

## 6. Comment on prouve les 3 % (avant de montrer quoi que ce soit au client)

1. **Banc synthétique** (tout de suite, automatisable) : on génère des photos de murs de dimensions connues avec une caméra virtuelle
   (perspective réelle, distorsion radiale, bruit, flou, éclairage), feuille ou mire placée, fenêtres et portes dessinées ;
   on fait tourner le pipeline sans intervention humaine ; on mesure l'erreur sur 500 cas. Cible : 95 % des cas < 3 %, mire < 1 %.
2. **Banc réel** : 20 murs photographiés au S24 par un non-expert, mesurés au mètre (vérité terrain) ; rapport dans
   `docs/reports/measurement-benchmark.md`.
3. **Calepinage** : 40 chantiers de Nicolas recalculés, 0 rouleau d'écart.

## 7. Découpage de construction (proposé)

| Lot | Contenu | Owner | Test |
|---|---|---|---|
| M1 | `packages/measurement` : homographie robuste, rectification, échelle par référence, incertitude, trapèze | measurement-engineer | 100 % + banc synthétique |
| M2 | Détection : feuille/mire (seuillage, contours, sous-pixel), lignes du mur (Hough), aimantation | vision-engineer | banc synthétique |
| M3 | Ouvertures : propositions automatiques (rectangles), types, règles de déduction | vision-engineer + quote-engineer | cas de référence |
| M4 | Calepinage lé par lé, deux modes, raccords, pièce entière, empaquetage, plan de coupe | quote-engineer | 100 % + 40 devis |
| M5 | UX client : préparer, photographier (niveau), vérifier sur image redressée, plinthes, fourchette ± 3 % | ui-engineer | captures + Maestro |
| M6 | Mire imprimable (PDF A4) sur le site | tech-writer | impression test |
| M7 | Banc réel 20 murs + rapport | qa-engineer | seuils |

## 8. Points tranchés le 7 novembre (client NLPGenerator)

1. **Mire imprimable + feuille A4** : les deux (mire = `mire-wallscan.pdf`, cadre extérieur 190 × 277 mm, code d'orientation).
2. **Fourchette de prix** affichée quand un seuil de lé ou de rouleau tombe dans les ± 3 % ; chiffre unique sinon.
3. **Règles de déduction** du §3.4 : adoptées comme valeurs par défaut jusqu'à confirmation de Nicolas Soufflet.
4. **Plinthes** : hauteur **mesurée sur la photo ou saisie** — jamais de valeur par défaut (l'option reste inactive sans valeur).

## 9. Résultats du banc synthétique (500 scènes, `docs/reports/measurement-synthetic-bench.md`)

| Cible | Résultat |
|---|---|
| Feuille A4 détectée : 95 % des cas < 3 % | **100 %** des cas < 3 % (p95 = 0,28 %) |
| Mire : p95 < 1 % | **0,10 %** |
| Feuille tapée à la main : 95 % < 5 % | **98,9 %** |
| Aucune fausse mesure silencieuse | **0** (les échecs sont signalés et renvoyés vers la loupe) |
| Plinthe proposée automatiquement | 378 / 379, erreur < 1 cm dans 98,7 % des cas |
| Ouvertures retrouvées (IoU ≥ 0,5) | 83,8 %, bon type dans 94,7 % des cas retrouvés |
| Temps par image (p50 / p95) | 482 ms / 685 ms |

Le banc **réel** (lot M7 : 20 murs photographiés au S24, mesurés au mètre) reste à faire avant tout chiffre devant un client.
