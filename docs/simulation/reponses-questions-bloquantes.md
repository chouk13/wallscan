# Réponses aux 10 questions — v2 (faits vérifiés + simulation calibrée)

> Mise à jour 2026-11-07. Éditeur : **NLPGenerator** (nlp-generator.com). Prospect pilote : **SOUFFLET décoration**.
> Ce qui est **vérifié** vient de sources publiques (registre du commerce, annuaires, sites des éditeurs).
> Ce qui est **simulé** est calibré sur des données réelles du marché genevois et sera remplacé par le flux XML
> de l'entreprise dès réception. Chaque valeur simulée est un paramètre en base, jamais du code.

## Fiche entreprise (vérifié)

| | |
|---|---|
| Raison sociale | **SOUFFLET décoration, papier-peint, revêtements d'intérieur** |
| Forme juridique | **Entreprise individuelle** (raison individuelle), titulaire Nicolas Soufflet, fondée en 2023 |
| Adresse | Rue des Noirettes 9, **1227 Carouge GE** (canton de Genève) |
| Activité | Pose de revêtements muraux haut de gamme (papiers peints panoramiques, texturés, 3D) et peinture intérieure ; CFC depuis 2007 |
| Éditeurs cités | **Élitis, Casamance, Les Dominotiers** |
| Positionnement voulu | « Numéro 1 du papier peint à Genève » : le dirigeant présente lui-même son catalogue, chez le client, sur téléphone |

Conséquences : pas d'équipe de vendeurs ; **un utilisateur principal** (Nicolas) ; la pose est faite **par l'entreprise elle-même** ;
la convention collective applicable à la pose de papiers peints à Genève est la **CCT du second œuvre romand** (plâtrerie-peinture,
« pose de papiers-peints » explicitement incluse), avec le salaire minimum cantonal genevois de CHF 24.59/h en 2026 comme plancher.

## 1. CRM — Octyzen (vérifié)

**Octyzen Sàrl**, Rue du Tir-au-Canon 4, 1227 Carouge GE, inscrite au RC le 27.04.2026 (CHE-346.839.428). « L'agence IA du bâtiment » :
CRM/ERP **sur mesure** et agents IA pour artisans et PME du bâtiment (devis, comptes-rendus, suivi de chantier). Site octyzen.ch.

→ Il n'existe **pas d'API publique documentée** : l'intégration se fera par un adaptateur `octyzen` (REST + webhooks) dont le contrat
sera convenu avec Octyzen (contacts, projets, devis, fichiers, événements). En attendant, `InternalCrm` + `GenericWebhook`.
Le devis **officiel** peut rester dans Octyzen : WallScan pousse le devis structuré (lignes + PDF) et conserve son numéro interne.

## 2. Catalogue et prix — flux XML (déclaré)

Le catalogue arrivera en **XML** (format exact à recevoir : export CRM Octyzen ou flux éditeur). L'import prévoit : SKU, éditeur,
collection, nom, coloris, largeur et longueur de rouleau, raccord (cm) et type, unité de vente (rouleau / m² / panneau), prix
d'achat, prix de vente, délai, classement feu, image HD. **Prévisualisation des différences avant application.**

Tant que le XML n'est pas là, la maquette utilise des **références réelles des trois éditeurs** avec des **prix indicatifs relevés
publiquement en CHF** (revendeurs suisses), marqués « indicatif ».

## 3. Textures (simulé, calibré)

Élitis et Casamance fournissent des visuels HD et des fiches techniques précises (largeur, raccord, type de raccord) : calibration
possible pour ~80 % des références. Les Dominotiers (panoramiques sur mesure) fournissent le visuel complet du décor : le rendu
se fait par **placement du décor entier** sur le mur, pas par tuilage. Maquette : motifs vectoriels originaux étiquetés « DÉMO ».

## 4. Pose — par l'entreprise (vérifié) ; tarifs simulés calibrés Genève

Nicolas pose lui-même. Tarifs **simulés**, calibrés sur le marché genevois (France : 25–35 €/m² pose seule ; Genève ≈ ×1,8–2) :

| Prestation | Unité | Tarif simulé | Note |
|---|---|---|---|
| Pose intissé sans raccord | m² | CHF 55.– | |
| Pose avec raccord (droit / sauté) | m² | CHF 70.– | alignement du motif |
| Pose panoramique sur mesure | m² | CHF 95.– | lés numérotés, tolérance zéro |
| Préparation du support (rebouchage, ponçage, apprêt) | m² | CHF 18.– | optionnel |
| Dépose de l'ancien papier | m² | CHF 14.– | optionnel |
| Taux horaire (petits travaux, retouches) | h | CHF 95.– | cohérent CCT-SOR + charges + marge |
| Déplacement | forfait | CHF 0.– (canton GE) / CHF 80.– hors canton | |
| Minimum de facturation pose | — | 8 m² | |

## 5. Calcul des rouleaux (simulé, règles métier standard)

Rouleaux réels : **Casamance 70 cm × 10,05 m** ; **Élitis 100 cm × 10 m** (certaines références 70 cm) ; **Les Dominotiers** : lés de
70 cm, hauteur sur mesure, vendus au m². Règle appliquée : marge de coupe **5 + 5 cm**, hauteur de lé arrondie au multiple du raccord,
raccord sauté = + offset sur les lés alternés, **+ 1 rouleau de réserve si motif à raccord**, lots fournisseur respectés.
Panoramique : surface = nb de lés × largeur de lé × (hauteur + 10 cm), facturée au m² au prix du décor.

## 6. Portes et fenêtres (simulé)

Déduites de la surface facturable **au-delà de 2 m²** (porte, grande fenêtre) ; jamais déduites du nombre de lés.

## 7. TVA et arrondi (vérifié + à confirmer)

TVA suisse **8,1 %** (taux normal) sur marchandise et pose. Une entreprise individuelle est assujettie dès CHF 100 000 de chiffre
d'affaires : **assujettissement à confirmer** (registre UID). Particuliers : prix **TTC** avec détail HT/TVA ; arrondi aux **5 ct** sur
le total TTC. Conditions générales : droit suisse, for à Genève.

## 8. Remises (simulé)

Pas de vendeur : le dirigeant décide. Remise libre jusqu'à **15 %** sur la marchandise, pas de remise sur la pose ; au-delà, saisie
d'un motif (traçabilité). Pas de validation tierce.

## 9. Appareils (déclaré)

Téléphone en priorité (**Samsung Galaxy S24** du client pilote → Android d'abord, ARCore disponible). Desktop/web secondaires.

## 10. Langues et lieu (vérifié)

Carouge, canton de Genève. **FR** d'abord ; DE/EN/IT disponibles dans l'app, non prioritaires.

---

## Mesure du mur : ce qui existe vraiment (recherche 2026)

| Approche | Ce que c'est | Précision | Verdict pour WallScan |
|---|---|---|---|
| **ARCore (Android, Google Play Services for AR)** | Détection de plans + **Depth API** (profondeur par le mouvement, une seule caméra ; Samsung l'utilise dans Quick Measure). Gratuit, on-device, disponible sur le S24. | ±1–3 % avec un balayage de 2–3 s | **Méthode n°1 en visite** : l'app est ouverte sur la caméra ; pendant le cadrage, ARCore trouve le plan du mur et l'échelle métrique ; au déclenchement on stocke photo + géométrie + dimensions. Module natif Expo (Kotlin). |
| **ARKit / RoomPlan (iOS)** | Équivalent Apple, LiDAR sur Pro | ±1–2 % | Phase 2, pour les clients iPhone |
| **Modèles de profondeur métrique mono-image** : Apple **Depth Pro** (estime aussi la focale), **Metric3D v2** (focale EXIF requise), **UniDepth v2** (licence non commerciale), **YOLO26-depth** (Ultralytics, mètres) | Une photo → carte de profondeur en mètres, côté serveur GPU | **10–25 % d'erreur** typique en intérieur sans référence | **Ordre de grandeur seulement** : utile pour pré-placer les 4 coins et proposer une taille plausible, jamais pour facturer. Dépend d'une licence commerciale (Depth Pro : licence Apple ; YOLO26 : AGPL/entreprise). |
| **Objet de référence** (feuille A4, prise type J 85 mm, porte, **hauteur sous plafond connue**) | Échelle px/cm dans le plan du mur via homographie | ±3–5 % | **Méthode n°2** (photo importée / sans AR). La hauteur sous plafond saisie par le poseur est la référence la plus simple et la plus fiable sur le terrain. |
| **API « mesure de pièce » tierces** (MeltFlex, mSightFlow Depth Anything…) | Profondeur relative + design IA | relative, non métrique | Non retenu pour la mesure |

Décision : **ARCore natif + référence (hauteur sous plafond / A4) + saisie manuelle**, confiance affichée, jamais de devis envoyé
sous 0.8. Une estimation mono-image (Depth Pro côté serveur) peut être ajoutée en Phase 2 pour accélérer le placement des coins.

## Rendu du papier peint : API exploitables

| Solution | Nature | Verdict |
|---|---|---|
| **Wizart Visualizer API** | API REST (AWS Marketplace, facturation au rendu) : pièces, produits, application d'un papier peint sur une surface | Exploitable comme **rendu photoréaliste serveur** optionnel en Phase 2 ; coût par rendu, dépendance externe |
| **Roomvo (Leap Tools)** | Visualiseur clé en main pour fabricants/revendeurs partenaires, intégration par script sur site web, programme fermé | Pas une API pour une app tierce ; non retenu |
| **Moteur maison** (homographie + tuilage à l'échelle + transfert d'éclairage, prototype déjà livré) | Offline, gratuit, maîtrisé, lés visibles | **Base du produit** (Phase 1) |

## Parcours mobile retenu (spécification UX du client)

1. **Ouverture directement sur l'appareil photo** (viseur plein écran) avec **deux cartes premium** : « Photographier un mur » et « Menu / Catalogue » ; bouton menu flottant en bas à droite.
2. **Photo prise → analyse du mur** : détection du plan (ARCore) ou pré-placement des coins, résultat largeur × hauteur × m² avec confiance ; référence rapide (hauteur sous plafond, A4) ; **bouton Valider**.
3. L'app **demande de passer en paysage** : photo plein écran, **roulette verticale à droite** avec toutes les références ; **le scroll change le papier sur le mur** ; Valider.
4. **Devis** immédiat selon les règles ci-dessus, « Pourquoi N rouleaux ? », envoi/copie.
5. **Menu principal** (2e entrée) : rubriques par éditeur, toutes les références avec prix, dimensions, raccord, matière, délai, classement feu ; projets ; paramètres.

## Changements appliqués au dépôt

- Identifiants `com.nlpgenerator.wallscan` ; organisation de démo renommée « SOUFFLET décoration (démo) », Carouge GE.
- `supabase/seed/demo.sql` v2 : 3 éditeurs réels, 15 références réelles (dimensions/raccords réels, prix indicatifs CHF), tarifs de pose ci-dessus, unité de vente `roll | m2`.
- `packages/crm-adapters/octyzen` (stub REST/webhook) ; Bexio reclassé v2.
- Prototype web v2 (`apps/web/public/prototype/`) : parcours mobile ci-dessus.
