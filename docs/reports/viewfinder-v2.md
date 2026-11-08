# Viseur v2 : consensus, déclenchement automatique, rafale, contrôles qualité

Fichier unique : `apps/web/public/prototype/index.html` (module « Visualiser sur mon mur »). Aucun changement de l'habillage existant :
ajouts = un bouton « Auto » (style `.camside`), trois points sur le déclencheur, des cartes `.conf` dans Vérifier / Résultat, une carte « Stable » dans la pile de statut du viseur, un champ facultatif sous les plinthes. Aucune dépendance ajoutée, aucun `alert`, textes en français.

Moteur utilisé quand il existe (`typeof WSMeasure.x === "function"`) : `fuseQuads`, `sharpness`, `refineWallQuad`, `consistency` (présents dans le bundle au moment de la livraison). Repli local sinon : médiane coin par coin avec rejet des aberrants (`fuseQuadsLocal`), variance du laplacien sur les tuiles les plus nettes (`sharpLocal`), pourcentage direct (`consLocal`).

## Ce qui a été ajouté, et où

| # | Fonction | Où (index.html) |
|---|---|---|
| 1 | Consensus : `LIVE.hist` (5 derniers résultats du worker), `liveFuse` (affichage = médiane de la feuille/mire, des 4 lignes et des coins ; un objet reste affiché s'il est dans 3 résultats sur 5), `liveStability` (écart médian des coins en px sur 5 images, pire de la feuille et du mur ; écart-type d'orientation sur 1 s via `ORI`/`oriStats`), chip « Stable » / « Stabilisation… » dans `liveAssess` | section « Consensus multi-images » (≈ l. 1183), `liveResult`, `onOrient` |
| 2 | Auto : `AUTO`, `autoReady`, `autoTick` (100 ms), `autoCount` (3 points × 400 ms), bouton `#autoBtn` dans `.shutwrap` à gauche du déclencheur, mémorisé dans `localStorage["wsAuto"]`, désactivé par défaut. Conditions : `L.ready` (feuille OK, plafond, sol, bords), stable, |roulis| et |tangage| < 2,5°, tenues 700 ms, capteur d'inclinaison requis ; toute perte de condition annule le compte à rebours | section « Déclenchement automatique » (≈ l. 1208), HTML l. 623, CSS `.autobtn`, `.shutter .cd` |
| 3 | Rafale : `capturePhoto` réécrit (3 × `takePhoto` en série, repli canvas), `decodeGray`, choix de la plus nette, `burstFuse` (détection feuille + coins sur chaque image, `fuseQuads` avec `maxSpreadPx` 4 px, initialise `S.refQuad` et `S.quad`) ; métriques dans `S.burst` | ≈ l. 1005-1030, `burstFuse` ≈ l. 1332 |
| 4 | Flou : `S.sharp`, carte `#blurBox` (« Photo floue : reprenez-la » + bouton « Reprendre » → `openCamera()` ; « soft » = avertissement seul) | `qualityCards` ≈ l. 1243 |
| 5 | Réglages caméra : `camTune` (zoom 1, focus / exposition / balance des blancs en continu, chacun dans un try, torche jamais) ; mode pro : `camCapsText` dans `#camFoot` | ≈ l. 984, `openCamera` |
| 6 | Inclinaison : `S.capturePose` (pitch/roll à l'appui sur le déclencheur), carte `#tiltBox` si |pitch| > 6° ou |roll| > 4° | `capturePhoto`, `qualityCards` |
| 7 | Recoupement : champ `#knownH` (sous les plinthes), `consCheck`, cartes `#consBox` (Vérifier) et `#consRes` (Résultat) ; compare `survey.heightCm` à la hauteur connue ; ne modifie jamais la mesure ; sans objet en mode « hauteur sous plafond » ou hauteur saisie | ≈ l. 1233 |
| 8 | Affinage : `grayFull` (pleine résolution ≤ 4096 px, `toGray`), `refineInitial` après l'analyse, `refineAfterDrag` (seul le coin touché, c.-à-d. l'intersection des deux côtés touchés, prend la valeur affinée) ; texte « Coins affinés sur les arêtes (résidu X px) » dans la carte des coins | ≈ l. 1340-1350, `refreshStatus` |

Seuils (constantes en tête de chaque bloc) : `LIVE_CFG` (écart max de fusion 10 px, stable < 1,5 px, orientation σ < 0,5°), `AUTO_CFG` (2,5°, 700 ms, 400 ms/point), `BURST_CFG` (3 images, abandon à 2,5 s), `REFINE_JUMP` (un coin affiné qui s'éloigne de plus de 1 % du grand côté est ignoré).

## Test

`python3 scripts/proto-shots.py apps/web/public/prototype/dist/index.html /tmp/out s412` (`FAKE_CAMERA_FILE=/tmp/beam.y4m` ou `/tmp/real1.y4m`). Les vérifications fonctionnelles s'affichent `ok` / `ECHEC` et un échec empêche `errors: none`.

- Fusion : `LIVE.hist` = 5 ; affichage = médiane sur la scène du viseur ; test pur avec 5 résultats synthétiques décalés (médiane exacte, lignes comprises, écart médian 1 px = stable, 4,5 px = « Stabilisation… ») ; repli local de `fuseQuads`.
- Auto : défaut désactivé ; clic → activé, `localStorage`, `aria-pressed` ; worker gelé et état « tout prêt » injecté : téléphone penché de 10° (événements `deviceorientation` synthétiques) → aucun compte à rebours ; téléphone droit → compte à rebours après ≥ 600 ms, points sur le déclencheur, capture ; mémorisation après rechargement de page (`auto_memory`).
- Rafale : déclenchement auto = 3 images ; ImageCapture absent = 1 image en mode canvas ; téléphone lent (`takePhoto` retardé de 1 s) = 1 image ; prise manuelle = 3 images, la plus nette est gardée ; `S.burst.fuse` rempli (scène poutre : feuille et mur fusionnés sur 3 images).
- Flou : netteté nette > légèrement floue > floue (moteur et repli local), verdicts ; carte « Photo floue » + « Reprendre » rouvre le viseur ; « soft » sans bouton.
- Inclinaison : pitch 10° / roll 3° synthétiques → `S.capturePose` et carte « Téléphone incliné de 10,4° » ; téléphone droit → pas de carte.
- Hauteur : 250 sur le mur de démo → « Mesuré 2,50 m · connu 2,50 m · écart 0,0 % : OK » (aussi dans Résultat) ; 255 → « À vérifier » ; 270 → « Incohérent », mesure inchangée.
- Affinage : `S.refine` rempli sur le mur de démo, texte dans la carte des coins ; après déplacement d'un coin, au plus un coin change.
- Mode pro : `#camFoot` contient « Réglages : zoom … · mise au point … ».

Résultats (Chromium headless, caméra factice) : `errors: none` sur les trois passes s412 (caméra par défaut, scène poutre, scène réelle `real1`), ainsi que sur s412-pro et s360 avec la scène poutre.

## Limites et points ouverts

- **Fusion de rafale** : suppose des images quasi alignées (écart ≤ 4 px sur l'image de travail). Main levée, le déplacement entre images dépasse souvent ce seuil : `fuseQuads` rejette alors les images et on garde le résultat de la photo la plus nette, sans mélange. Le gain réel de la rafale tient surtout au choix de l'image nette ; à mesurer sur téléphone.
- **Délai de rafale** : l'objectif « 3 images en < 1,5 s » n'est pas garanti ; sur la caméra factice la rafale prend 0,6 à 1,9 s. Règle appliquée : 1 seule photo si une prise dépasse 0,83 s (3 prises > 2,5 s), arrêt dès que la suivante dépasserait 2,5 s. À valider sur Android / iOS réels.
- **Coût de `burstFuse`** : détection sur les deux images supplémentaires, 200 à 700 ms synchrones pendant l'animation d'analyse (scène poutre 1280 × 960).
- **Auto** : requiert le capteur d'orientation (sinon chip « Auto : capteur d'inclinaison indisponible »). « Droit à < 2,5° » est appliqué au roulis et au tangage. Sur iOS, le capteur exige l'autorisation du bouton « Activer le niveau ». Stabilité < 1,5 px sur l'image d'analyse de 560 px : seuil atteignable sur trépied, à vérifier à main levée.
- **Aimantation** : il n'existe pas de réglage utilisateur pour désactiver l'aimantation (`snapToEdge`) dans le prototype ; l'affinage après déplacement est donc toujours actif. Si un réglage est ajouté, il suffit de conditionner `refineAfterDrag`.
- **Affinage** : `k1` (distorsion) n'est pas transmis à `refineWallQuad` (estimé après l'affinage dans le flux actuel). Affinage synchrone sur image jusqu'à 4096 px.
- **Seuils du repli local** (`SHARP_CFG`, `consLocal` 2 % / 5 %) : non calibrés ; ils ne servent que si le moteur est absent. Les seuils du moteur (netteté 0,30 / 0,40 ; cohérence 1,5 % / 4 %) sont ceux de `packages/measurement`. À CONFIRMER avec `qa-engineer` sur photos réelles et avec Soufflet pour la tolérance de hauteur.
- Pas de test sur appareil réel (zoom, `focusMode`, capteurs) : la caméra factice n'expose que focus et exposition, et aucun zoom ni balance des blancs.
- La carte de recoupement n'utilise pas le champ `ceilInput` du mode « hauteur sous plafond » : dans ce mode la mesure repose déjà sur cette valeur, la comparer serait circulaire.
