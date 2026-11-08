# Rapport Phase 0 — Fondations

Date : 2026-11-06 · Owner : lead-architect · Statut : **livré, en attente de validation client**

## Ce qui est livré

| # | Tâche | Owner | Reviewer | Estimation | État |
|---|---|---|---|---|---|
| 0.1 | Monorepo pnpm + Turborepo, TS strict, ESLint/Prettier, CI GitHub Actions | devops-engineer | lead-architect | 0,5 j | ✅ |
| 0.2 | `packages/core` : `Cents` (argent en centimes, TVA en points de base, arrondi 5 ct), types de domaine | quote-engineer | backend-engineer | 0,5 j | ✅ 7 tests |
| 0.3 | `packages/i18n` : FR/DE/IT/EN, `t()`, test d'intégrité des clés | product-owner | tech-writer | 0,5 j | ✅ 3 tests |
| 0.4 | `packages/config` : design tokens (couleurs Soufflet `À CONFIRMER`), mode showroom | ui-designer | mobile-engineer | 0,5 j | ✅ |
| 0.5 | Schéma DB v1 : 20 tables, RLS par org, prix/taux historisés, numérotation légale, triggers d'immuabilité, rollback | backend-engineer | security-compliance | 1,5 j | ✅ migration écrite, **non exécutée** (pas de Supabase provisionné) |
| 0.6 | `packages/measurement` : contrat, saisie manuelle, règles d'ouvertures, correction tracée, seuil 0.8 | measurement-engineer | qa-engineer | 0,5 j | ✅ 100 % couverture |
| 0.7 | `packages/quote-engine` : contrat public, `ENGINE_VERSION`, statut NON VALIDÉ, règle ESLint anti-flottant | quote-engineer | qa-engineer | 0,5 j | ✅ contrat seulement (calcul = Phase 1) |
| 0.8 | `packages/crm-core` (port) + `InternalCrm` en mémoire + stubs Bexio/HubSpot/Webhook + test de contrat | crm-integrator | backend-engineer | 0,5 j | ✅ |
| 0.9 | `apps/api` Fastify : `/health` exposant version et statut du moteur | backend-engineer | devops-engineer | 0,25 j | ✅ testé |
| 0.10 | Squelettes `apps/mobile` (Expo Router, permissions caméra), `apps/desktop` (Tauri 2, CSP), `apps/web` (Next 15) | mobile/desktop-engineer | ui-designer | 0,5 j | ⚠️ écrits, **non buildés ici** (voir limites) |
| 0.11 | 14 agents `.claude/agents/` | lead-architect | product-owner | 0,5 j | ✅ |
| 0.12 | `docs/architecture.md`, ADR-0001/0002/0003 | lead-architect | tech-writer | 0,5 j | ✅ |

Vérification : `pnpm turbo run lint typecheck test --filter='./packages/**' --filter=@wallscan/api` → **47 tâches vertes**,
couverture 100 % sur `measurement` et `quote-engine`.

## Limites honnêtes de cette livraison

1. **Les apps mobile/desktop/web ne sont pas compilées dans cet environnement** : Expo, Tauri (Rust) et Next exigent des
   toolchains natifs et des téléchargements hors allowlist. Les fichiers de configuration sont écrits ; la première exécution
   sur un poste de dev (`pnpm install` puis `pnpm dev`) peut révéler des ajustements de versions. C'est la première tâche de
   `devops-engineer` en Phase 1. Le livrable « `pnpm dev` lance mobile + desktop + web » est donc **à confirmer sur machine**.
2. **La migration SQL n'a pas été exécutée** (aucun projet Supabase). Elle est syntaxiquement relue mais doit être jouée sur
   `supabase start` en local avant tout usage — tâche 1.1.
3. **Aucune donnée Soufflet** : pas de catalogue, pas de prix, pas de règle de rouleaux confirmée. Tout ce qui en dépend est
   paramétré et marqué `À CONFIRMER`. Le moteur reste « NON VALIDÉ ».
4. `expo-ar` cité dans le prompt n'est pas une base de production : l'AR sera un module natif maison (ADR-0002).
5. Supabase n'a pas de région suisse connue : région UE proposée, alternative auto-hébergée CH documentée (ADR-0001).

## Décisions à valider par le client

- ADR-0001 (stack + hébergement UE vs CH), ADR-0002 (cascade de mesure, AR en Phase 2), ADR-0003 (moteur pur + statut NON VALIDÉ bloquant l'envoi).
- Les 10 questions bloquantes posées en début de session ; en particulier n°2 (format catalogue/prix), n°3 (textures), n°5–7 (règles de calcul, ouvertures, TVA).

## Plan Phase 1 (semaines 2–5) — proposé, démarre après validation

| # | Tâche | Owner | Reviewer | Est. |
|---|---|---|---|---|
| 1.1 | Provisionner Supabase (EU) + jouer la migration + seed de test ; `pnpm dev` validé sur poste | devops-engineer | backend-engineer | 1 j |
| 1.2 | Import catalogue/prix Excel → `wallpapers`, `price_lists`, `wallpaper_prices` avec prévisualisation des diffs | crm-integrator | quote-engineer | 3 j |
| 1.3 | `quote-engine` : calcul des rouleaux (§5.1), composition (§5.2), TVA, remises, arrondi, `trace[]` | quote-engineer | qa-engineer | 4 j |
| 1.4 | Jeu de ≥ 40 devis de référence Soufflet → tests de non-régression ; levée du statut NON VALIDÉ | qa-engineer | quote-engineer | 3 j (dépend de Soufflet) |
| 1.5 | `measurement` : objet de référence + homographie (échelle px/cm), confiance déterministe | measurement-engineer | vision-engineer | 4 j |
| 1.6 | `vision` + `render-engine` : 4 coins manuels, homographie, tuilage à l'échelle, transfert d'éclairage, Skia + WebGL | vision-engineer | measurement-engineer | 8 j |
| 1.7 | Écrans mobile du parcours Capturer → Chiffrer (offline brouillon) | mobile-engineer | ui-designer | 6 j |
| 1.8 | Écrans desktop showroom (import, comparaison, grand écran) | desktop-engineer | ui-designer | 4 j |
| 1.9 | API tRPC : catalogue, murs, devis (draft → sent, numérotation), PDF react-pdf | backend-engineer | security-compliance | 5 j |
| 1.10 | Specs Gherkin des 5 étapes, i18n des écrans | product-owner | tech-writer | 3 j |
| 1.11 | Threat model v1 + consentement photos dans le parcours | security-compliance | lead-architect | 2 j |
| 1.12 | Démo sur 20 murs réels + rapport `phase-1.md` | lead-architect | qa-engineer | 1 j |

Chemin critique : 1.2 → 1.3 → 1.4 (dépend des données Soufflet) et 1.5 → 1.6 → 1.7. Sans les réponses aux questions 2, 3 et 5–7,
la Phase 1 ne peut pas produire un devis validé — elle produirait un devis « plausible », ce qui est exactement ce qu'on refuse.

## Addendum 2026-11-06 — mode démo commerciale (NLPGenerator → Soufflet)

Les 10 questions ont reçu des **réponses simulées** par personas (`docs/simulation/reponses-questions-bloquantes.md`).
Conséquences appliquées : identifiants `com.nlpgenerator.wallscan`, seed `supabase/seed/demo.sql` (organisation démo,
12 références, tarifs de pose, consommables, remises), 6 devis de référence démo (`packages/quote-engine/test/reference/`),
cibles **Android + Windows d'abord**. Le statut « NON VALIDÉ » du moteur reste actif jusqu'aux vrais devis Soufflet.

## Addendum 2026-11-07 — réponses v2 (faits vérifiés) et prototype v2

- Faits vérifiés : SOUFFLET décoration = entreprise individuelle de Nicolas Soufflet, Carouge GE, pose elle-même, éditeurs Élitis / Casamance / Les Dominotiers ; CRM = **Octyzen Sàrl** (Carouge, CRM sur mesure, pas d'API publique → adaptateur `octyzen` à contractualiser) ; catalogue à venir en **XML**.
- Mesure : décision ARCore natif (Android d'abord) + référence (hauteur sous plafond / A4) + manuel ; les modèles de profondeur mono-image (Depth Pro, Metric3D, YOLO26-depth) ne servent qu'à l'ordre de grandeur. Détail dans `docs/simulation/reponses-questions-bloquantes.md`.
- Prototype v2 publié (parcours caméra → analyse → paysage + roulette → devis ; menu catalogue réel). Bug d'homographie du prototype v1 corrigé (produit matrice-vecteur) — à reporter dans `packages/measurement` en Phase 1 (tests obligatoires sur l'homographie).
- Cibles révisées : **Android (S24) d'abord**, web/desktop secondaires. iOS Phase 2.

## Addendum 2026-11-07 (soir) — module site, design aligné, base de la mesure précise

- Le livrable devient un **module « Visualiser sur mon mur » à brancher sur souffletpapierpeint.ch** (Next.js, Alto Nova) : `embed.js` + `docs/embed-on-website.md`. Design aligné sur le site (relevé mesuré dans `docs/design/brief-v4-alignement-site.md`), catalogue des 9 maisons du site (motifs originaux évoquant les visuels des cartes), modes `client` / `pro` / `embed`, conversions WhatsApp et rendez-vous. Publié (artefact v4) et dossier `dist/` prêt pour `public/wallscan/`.
- Textures : 17 clés de motifs (`patterns.js`, 47 Ko), contrôle visuel en 3 cycles.
- Version test téléphone : `apps/mobile-test` (Expo + WebView, `eas build -p android --profile preview` → APK), manifest PWA relié, guide `docs/test-on-phone.md`.
- Phase suivante (cœur du projet) : **mesure précise + calepinage** — base de brainstorm `docs/specs/mesure-precise-brainstorm.md` (seuils de lés/rouleaux, relevé avec ouvertures, calepinage lé par lé, AR + laser BLE + segmentation, banc d'essai, 7 décisions).

## Addendum 2026-11-07 (nuit) — v5 : mesure réelle depuis la photo + calepinage lé par lé

Décisions du brainstorm (validées par le client NLPGenerator) : mesure **depuis une photo seule** (ni laser ni AR), hauteur du
haut du mur au sol avec simulation **avec / sans plinthes** (hauteur de plinthe **lue sur la photo ou saisie — jamais de valeur
par défaut**), calepinage à partir de la gauche **et** centré, ouvertures **détectées automatiquement puis confirmées**, pièce
entière dès la v1, utilisateur principal = **le client sur le site, sur son téléphone**, tolérance affichée **±3 %**,
référence **feuille A4 ou mire imprimable** (`mire-wallscan.pdf`), **fourchette de prix** quand un seuil de lé/rouleau tombe
dans la tolérance. Spécifications : `docs/specs/mesure-photo-v1.md`, `measurement-api.md`, `mire.md`.

Livré :
- `packages/measurement` (TypeScript pur, bundle `WSMeasure` 102,6 Ko) : détection A4/mire, affinage sous-pixel des coins,
  proposition des coins du mur (Hough + sol/plafond), homographie + distorsion radiale (k1), plinthe mesurée sur la photo,
  propositions d'ouvertures, propagation d'incertitude, codes d'avertissement (jamais de texte UI en dur). 78 tests, 100 % de
  couverture.
- `packages/quote-engine` v0.1.0-phase1 (bundle `WSQuote` 54,8 Ko) : calepinage lé par lé (`planStrips`, `planRoom`),
  emballage des lés par rouleau avec raccord, fourchette `quoteRange` (bas / médian / haut, seuils franchis listés), millimètres
  entiers. 125 tests, 100 % de couverture. Jamais plus de rouleaux que la formule simple (deux cas de référence en économisent un).
- Banc synthétique (500 scènes rendues, `docs/reports/measurement-synthetic-bench.md`) : feuille A4 détectée → **100 % des cas
  < 3 %** (p95 0,28 %), mire p95 **0,10 %**, feuille tapée à la main **98,9 % < 5 %**, **0 fausse mesure silencieuse**,
  plinthe à < 1 cm dans 98,7 % des cas, ouvertures retrouvées 83,8 % (bon type 94,7 %), ~480 ms par image.
- Module v5 (`apps/web/public/prototype/dist/index.html`, 332 Ko, moteurs réels inclus) : étape « Vérifier » (feuille / coins / plinthe,
  loupe, vue de face avec ouvertures déplaçables), résultat avec avertissements en français, fourchette sur le devis.
  Mur de démo rendu cohérent avec une caméra sténopé (plus de faux avertissements). Publié sur l'artefact claude.ai et
  l'artefact desktop.

Reste à faire avant tout chiffre devant un client : **banc réel** (20 murs photographiés avec feuille et mire, lot M7),
occultation des meubles dans le rendu, les 40 devis de référence Soufflet (statut `ENGINE_VALIDATION_STATUS` toujours
**NON VALIDÉ**), import du catalogue XML, contrat d'adaptateur Octyzen.

## Addendum 2026-11-07 (22 h) — v5.1 : viseur caméra en direct, hébergement de test GitHub Pages

- Constat : la visionneuse d'artefacts claude.ai interdit la caméra, les capteurs et les téléchargements à toutes les pages
  (règles du service vérifiées). Le test « en réel » exige une vraie adresse HTTPS.
- Module : viseur en direct (`getUserMedia` caméra arrière, vidéo entière visible, cadre, niveau, déclencheur), photo plein format par
  `ImageCapture.takePhoto` (repli : image vidéo), aperçu caméra sur l'accueil dès que la caméra a été autorisée une fois (l'app
  « s'ouvre sur l'appareil photo », comme demandé), repli automatique sur l'appareil natif (`<input capture>`) si refus ou
  indisponibilité. Vérifié en Chromium headless avec caméra factice : photo 3840 × 2160 capturée, parcours complet, 0 erreur.
- Dépôt GitHub `chouk13/wallscan` : `main` = monorepo, `gh-pages` = `dist/` du module ; `scripts/deploy-pages.sh` republie.
  URL de test : https://chouk13.github.io/wallscan/ (Pages à activer par le propriétaire ; dépôt public requis sur compte gratuit).

## Addendum 2026-11-08 (soir) — v6 : mesure « ultra optimisée » (équipe de trois agents)

- **Moteur** (`packages/measurement`, 116 tests, 100 %) : `refineWallQuad` — coins = intersections de droites ajustées en sous-pixel sur toute la
  longueur des arêtes en pleine résolution (coins tapés à ±3 px → 0,06 px en p50 ; erreur max(W,H) p95 0,84 % → 0,05 % sur 120 cas) ;
  distorsion k1 sur toutes les grandes lignes (erreur k1 p95 ×10⁻³ : 0,92 → 0,37) ; `sharpness` robuste au bruit (400/400 verdicts
  conformes) ; `fuseQuads` ; `consistency` ; `withQualityWarnings` + codes `measure_implausible`, `reference_ambiguous`,
  `reference_scale_suspect`, `reference_small`, `image_soft/blurry`, `distortion_strong/extreme`. Coût : +70 à +120 ms (≈ 600 ms p50).
- **Banc de réalisme** (`pnpm -s bench:realism`, 32 conditions × 20 scènes) : précision tenue jusqu'à 15° de tangage, 8° de roulis,
  feuille de travers 7°, vignettage ; **4 fausses mesures silencieuses → 0** (fausse feuille = autre rectangle A4 ; désormais 3–4 codes).
  Seuils de refus adoptés dans `docs/quality-thresholds.md`. Décision lead : `reference_small` informatif, `reference_scale_suspect`
  avertissement (combles), refus = `REFUSAL_WARNINGS` + `reference_ambiguous`.
- **Viseur** : consensus sur 5 images, carte « Stable », déclenchement automatique (option mémorisée), rafale de 3 photos (plus nette
  retenue, coins fusionnés), contrôle de flou avec « Reprendre », réglages caméra prudents, inclinaison enregistrée (> 6° / 4° : carte),
  recoupement hauteur connue, affinage des coins (initial et après déplacement). Trois passes automatiques vertes.
- Reste : banc réel 20 murs (seuils de netteté à recaler), banc de réalisme à requalifier en n = 40, temps du pipeline à regagner
  (coins du mur ≈ 200 ms), scan relief AR à valider sur S24.
