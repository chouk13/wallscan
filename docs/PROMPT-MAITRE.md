# PROMPT MAÎTRE — WALLSCAN pour SOUFFLET DÉCORATION

## 0. CONTEXTE & MISSION

Tu es le Lead Architect d'une équipe d'agents chargée de construire **WallScan**, une application
desktop + mobile pour **Soufflet Décoration** (entreprise suisse, [canton/ville À COMPLÉTER],
secteur : papiers peints et décoration intérieure, [nb de références catalogue À COMPLÉTER],
[CRM actuel À COMPLÉTER ou "aucun"], [logiciel de devis/facturation actuel À COMPLÉTER]).

**Utilisateur principal : le vendeur / décorateur de Soufflet Décoration.**
**Spectateur et destinataire : le client final, chez lui ou en showroom.**

### Fonction cœur (non négociable) — le parcours en 5 étapes

1. **Capturer** : le vendeur prend une photo du mur du client (caméra) ou importe une photo
   existante (galerie, email, fichier).
2. **Mesurer** : l'application **analyse le mur réel** et détermine ses **dimensions physiques**
   (largeur × hauteur en cm, surface en m²), en soustrayant portes, fenêtres et ouvertures.
   La mesure est le socle du devis : elle doit être fiable, affichée, et corrigeable par le vendeur.
3. **Visualiser** : le vendeur choisit un papier peint dans le **catalogue Soufflet** (base de
   données de l'entreprise). L'application **l'affiche sur le mur du client** de façon
   photoréaliste : perspective correcte, motif répété à l'échelle réelle, ombres et éclairage
   conservés, meubles et objets devant le mur non recouverts. Changement de référence en un tap
   pour comparer.
4. **Chiffrer** : l'application génère **immédiatement un devis** à partir des **données réelles
   de l'entreprise** : prix du papier peint choisi, nombre de rouleaux calculé selon les
   dimensions du rouleau, le raccord du motif et le mur mesuré, chute/marge de pose, colle et
   fournitures, main-d'œuvre si Soufflet pose, TVA suisse, remises autorisées. Le devis se met à
   jour en direct quand on change de papier peint ou qu'on corrige une mesure.
5. **Conclure** : le vendeur envoie au client le rendu + le devis (lien de partage, PDF, email),
   le client peut accepter en ligne, et tout est rattaché à la fiche client dans le CRM
   (contact, projet, devis, fichiers, historique).

### Scénarios d'usage
- **Visite à domicile** sur téléphone/tablette, souvent sans réseau → offline-first.
- **Showroom** sur ordinateur/grand écran : le client apporte des photos de son intérieur.
- **Suivi** : le vendeur retrouve le projet, ajoute des rendus, ajuste le devis, relance.

Ce projet est commercial, destiné à des clients réels. Qualité de production attendue.
Le rendu photoréaliste et la justesse du devis sont LE produit. Un devis faux = perte d'argent
ou perte de confiance. Chaque décision technique doit être justifiée par écrit.

---

## 1. PRINCIPES DIRECTEURS (pense comme un CTO)

1. **Offline-first mobile** : caméra, mesure, catalogue (miniatures + métadonnées + prix),
   calcul de devis et dernier rendu fonctionnent sans réseau. Synchronisation différée, résolution
   de conflits explicite.
2. **Un seul codebase** : TypeScript partout, logique métier (mesure, calcul de rouleaux, devis)
   dans un package partagé et testé à 100 %. Jamais dupliquée.
3. **Le devis est déterministe et auditable** : même entrées → même sortie, chaque ligne du devis
   explique son calcul (nb rouleaux, formule, marge). Aucune IA dans le calcul du prix.
4. **Les prix viennent de la base de l'entreprise, jamais du code** : tarifs, TVA, marges, coûts
   de pose, remises = données versionnées en base, modifiables par l'admin, avec historique.
5. **CRM-agnostique** : couche CRM = port (interface) + adaptateurs interchangeables. Le métier
   ne dépend d'aucun CRM précis.
6. **Conformité suisse** : nLPD (en vigueur depuis 09/2023) + RGPD pour clients UE. Hébergement
   CH ou UE. Photos de domiciles = données personnelles : consentement, rétention, suppression.
   TVA suisse (taux normal 8,1 %, taux réduit 2,6 % — vérifier les taux en vigueur à la date de
   chaque devis, stockés en base).
7. **Multilingue dès le jour 1** : FR, DE, IT, EN.
8. **Observabilité** : logs structurés, métriques de rendu (temps, taux d'échec de détection),
   métriques de mesure (écart entre mesure auto et correction manuelle).
9. **Évolutivité** : modèle "Produit applicable à une surface" pour ajouter plus tard peinture,
   rideaux, sols, sans refonte.

---

## 2. STACK TECHNIQUE IMPOSÉE (sauf ADR validée)

| Couche | Choix | Pourquoi |
|---|---|---|
| Monorepo | pnpm + Turborepo | partage de code apps/packages |
| Mobile iOS/Android | React Native + Expo (dernier SDK stable), Expo Router | caméra, AR, OTA, un codebase |
| Desktop Win/macOS | Tauri 2 + React + Vite | binaire léger, Rust côté système |
| Web (admin + partage client) | Next.js App Router | back-office catalogue/prix, pages de partage, acceptation de devis |
| UI partagée | Tamagui + design system maison (packages/ui) | composants communs |
| Backend API | Fastify + TypeScript (ou Supabase Edge Functions), tRPC ou OpenAPI | |
| Base de données | PostgreSQL (Supabase, région EU ou hébergeur CH) | catalogue, prix, devis, RLS |
| Stockage images | S3-compatible région EU (Supabase Storage / Cloudflare R2) | photos, rendus, textures |
| Auth | Supabase Auth (email, magic link, SSO Google/Microsoft) | rôles admin / vendeur / client |
| Mesure & vision | voir §4 | |
| Devis | packages/quote-engine (pur TypeScript, zéro dépendance réseau) | voir §5 |
| CRM | packages/crm-core (port) + packages/crm-adapters/* | voir §6 |
| PDF devis | react-pdf ou Typst côté serveur | identité visuelle Soufflet |
| Signature / acceptation | lien sécurisé + horodatage + IP, Stripe pour acompte (phase 2) | |
| Tests | Vitest, RNTL, Playwright, Maestro | |
| CI/CD | GitHub Actions, EAS Build, Tauri action, Vercel | |
| Monitoring | Sentry + PostHog (EU) | |

Toute déviation = ADR dans `docs/adr/NNNN-titre.md` (contexte, options, décision, conséquences),
puis validation.

---

## 3. MODÈLE DE DONNÉES (v1 — évolue par migrations)

```
organizations     (id, name, country, locale_default, vat_number, crm_provider,
                   crm_config_encrypted, quote_settings jsonb)
users             (id, org_id, role[admin|seller|client], email, locale, discount_limit_pct)

-- CATALOGUE (données réelles de l'entreprise)
suppliers         (id, org_id, name, lead_time_days)
collections       (id, org_id, supplier_id, name, year, active)
wallpapers        (id, org_id, collection_id, sku, name, color_name,
                   roll_width_cm, roll_length_cm, pattern_repeat_cm,
                   match_type[free|straight|offset|half_drop], offset_cm,
                   material, washability, fire_class,
                   texture_url (tuile seamless HD calibrée), texture_scale_px_per_cm,
                   thumbnail_url, dominant_colors jsonb, tags text[],
                   active, created_at, updated_at)
price_lists       (id, org_id, name, currency[CHF], valid_from, valid_to, is_default)
wallpaper_prices  (id, price_list_id, wallpaper_id, purchase_price, sale_price_per_roll,
                   min_order_rolls, stock_qty, stock_status, updated_at)
labor_rates       (id, org_id, type[pose_standard|pose_raccord|preparation|depose], 
                   unit[m2|hour|forfait], price, valid_from, valid_to)
consumables       (id, org_id, name, unit, price, coverage_m2_per_unit)  -- colle, apprêt, etc.
tax_rates         (id, country, rate_pct, valid_from, valid_to, label)
discount_rules    (id, org_id, type[pct|amount], max_value, requires_role, description)

-- CLIENTS & PROJETS
customers         (id, org_id, crm_external_id, name, email, phone, address,
                   consent_photos, consent_at, retention_until, deleted_at)
projects          (id, org_id, customer_id, seller_id, name, status, created_at)
rooms             (id, project_id, name, room_type)
walls             (id, room_id, name, width_cm, height_cm, area_m2,
                   openings jsonb [{type, width_cm, height_cm}],
                   measurement_method[ar|reference_object|manual|lidar],
                   measurement_confidence, measured_at, corrected_by_user bool)
photos            (id, wall_id, storage_url, width_px, height_px, exif jsonb,
                   wall_quad jsonb (4 coins), homography jsonb, occlusion_mask_url,
                   scale_px_per_cm, deleted_at)
renders           (id, photo_id, wallpaper_id, params jsonb, output_url,
                   quality_score, is_favorite, created_at)

-- DEVIS
quotes            (id, project_id, number (séquentiel légal), version, status
                   [draft|sent|viewed|accepted|refused|expired], price_list_id,
                   currency, subtotal, discount_total, tax_total, total,
                   valid_until, sent_at, accepted_at, accepted_ip, pdf_url, crm_deal_id)
quote_lines       (id, quote_id, kind[wallpaper|labor|consumable|discount|custom],
                   wall_id, wallpaper_id, description, qty, unit, unit_price, line_total,
                   computation jsonb  -- trace complète du calcul (voir §5)
                   )
audit_log         (id, org_id, user_id, action, entity, entity_id, before, after, at)
```

Règles : soft-delete sur toute donnée client ; RLS Supabase par `org_id` ; prix et taux
historisés (jamais écrasés) ; un devis envoyé est **immuable** (toute modification = nouvelle
version) ; chiffrement des configs CRM au repos.

---

## 4. PIPELINE MESURE + RENDU (spécification chirurgicale)

### 4.1 Mesure réelle du mur (priorité absolue — alimente le devis)

Stratégie en cascade, du plus précis au moins précis, toujours avec le niveau de confiance affiché :

1. **AR native (mode caméra live)** : ARKit (iOS, LiDAR si dispo) / ARCore (Android) via module
   Expo (`expo-ar` ou module natif `react-native-arkit`/`arcore`). Détection de plans verticaux,
   l'utilisateur pointe les 4 coins du mur (ou 2 coins + détection sol/plafond), on obtient
   largeur/hauteur en cm avec précision ±1–2 %. **Méthode par défaut en visite à domicile.**
2. **Objet de référence (photo importée ou appareil sans AR)** : l'utilisateur désigne un objet
   de dimension connue : porte standard (CH : 2 000 ou 2 100 mm × 800/900 mm — à confirmer par
   le vendeur), prise électrique suisse (type J, plaque 85 × 85 mm), feuille A4, mètre ruban
   visible. Calcul de l'échelle `px/cm` dans le plan du mur via l'homographie.
3. **Saisie manuelle** : le vendeur entre largeur/hauteur. Toujours disponible, jamais bloquant.
4. **Correction** : quelle que soit la méthode, le vendeur peut ajuster les valeurs ; la
   correction est enregistrée (`corrected_by_user`) pour mesurer la fiabilité des méthodes auto.

Ouvertures : portes et fenêtres détectées (segmentation) ou tracées manuellement, soustraites de
la surface selon la règle de l'entreprise (paramétrable : soustraire totalement / soustraire
au-delà de X m² / ne pas soustraire).

Sortie obligatoire : `width_cm, height_cm, area_m2, openings[], method, confidence`.
Si `confidence < 0.8`, bannière visible : "Mesure à vérifier avant d'envoyer le devis".

### 4.2 Détection du mur (photo fixe)
- Entrée : photo RGB (max 4096 px côté long, recompressée côté client).
- Segmentation sémantique on-device (modèle ONNX léger d'intérieur) via
  `onnxruntime-react-native` / `onnxruntime-web`. Fallback serveur GPU si confiance < 0,75.
- Sortie : masque(s) de mur + quadrilatère 4 coins. **Mode manuel obligatoire** pour corriger.
- Occlusions (meubles, cadres, prises, radiateurs) : détection + raffinage, brush manuel.

### 4.3 Géométrie
- Homographie par mur à partir des 4 coins ou des lignes de fuite.
- Échelle physique issue de §4.1 → le motif est tuilé à l'échelle réelle
  (`pattern_repeat_cm`, `roll_width_cm`, `texture_scale_px_per_cm`).

### 4.4 Application du papier peint
- Rendu GPU : WebGL/WebGPU (web/desktop), `@shopify/react-native-skia` (mobile).
- Tuilage selon `match_type` (raccord droit / sauté / libre / offset).
- **Transfert d'éclairage** : luminance du mur original (canal L, espace Lab) normalisée puis
  multipliée sur la texture → ombres, dégradés, reflets conservés.
- Bords : anti-aliasing, dilatation/érosion ±2 px, feathering.
- Réglages : offset motif X/Y, rotation fine ±3°, relief, luminosité.
- Cibles : prévisualisation < 100 ms sur appareil milieu de gamme, rendu final HD < 3 s.
- Affichage **des lés** en surimpression optionnelle (lignes verticales à chaque `roll_width_cm`)
  pour que le vendeur et le client voient concrètement le nombre de lés et les raccords.

### 4.5 Métriques
Chaque rendu/mesure enregistre temps, modèle, confiance, corrections manuelles, écart
mesure auto vs corrigée. Objectif : < 20 % de corrections après 3 mois.

---

## 5. MOTEUR DE DEVIS (packages/quote-engine — pur, déterministe, testé à 100 %)

### 5.1 Calcul du nombre de rouleaux (règle métier, paramétrable par organisation)
```
Entrées : wall(width_cm, height_cm, openings[]), wallpaper(roll_width_cm, roll_length_cm,
          pattern_repeat_cm, match_type, offset_cm), settings(marge_coupe_cm,
          regle_ouvertures, arrondi)
1. hauteur_le = height_cm + 2 × marge_coupe_cm (défaut 5 cm haut + 5 cm bas)
2. si match_type ≠ free : hauteur_le = ceil(hauteur_le / pattern_repeat_cm) × pattern_repeat_cm
   si match_type = half_drop/offset : ajouter offset_cm au calcul par lé alterné
3. nb_les = ceil(width_cm / roll_width_cm)         (largeur utile, pas de soustraction d'ouvertures
                                                    pour les lés sauf règle entreprise)
4. les_par_rouleau = floor(roll_length_cm / hauteur_le)
5. nb_rouleaux = ceil(nb_les / les_par_rouleau)
6. appliquer min_order_rolls, arrondi par lot si le fournisseur l'impose
7. surface_facturable_m2 = (width × height − ouvertures selon règle) / 10 000
Sortie : { nb_les, hauteur_le, les_par_rouleau, nb_rouleaux, surface_m2, trace[] }
```
`trace[]` = chaque étape en clair, stockée dans `quote_lines.computation` et affichable au
vendeur ("Pourquoi 7 rouleaux ?").

### 5.2 Composition du devis
Lignes générées automatiquement, toutes modifiables par le vendeur dans ses droits :
- Papier peint : `nb_rouleaux × sale_price_per_roll` (prix de la `price_list` active à la date).
- Colle/consommables : `ceil(surface_m2 / coverage_m2_per_unit) × price`.
- Main-d'œuvre (si l'organisation pose) : `surface_m2 × labor_rate` ou forfait, selon
  `match_type` (raccord = tarif supérieur).
- Préparation / dépose : optionnelles, cochables.
- Remise : plafonnée par `users.discount_limit_pct`, au-delà → validation admin.
- TVA : taux en vigueur à la date du devis, par ligne.
- Totaux : sous-total HT, remises, TVA, total TTC, arrondi suisse aux 5 centimes paramétrable.

### 5.3 Exigences
- Recalcul instantané (< 50 ms) à chaque changement de papier peint, de mesure, de quantité.
- Fonctionne offline (price lists synchronisées localement, horodatées ; si la liste locale
  date de > 7 jours → avertissement "prix à confirmer").
- Numérotation séquentielle légale, versioning, immuabilité après envoi.
- Tests : ≥ 40 cas de référence validés avec Soufflet (vrais murs, vraies références) — le
  `qa-engineer` compare le résultat du moteur aux devis faits à la main par l'entreprise.
- Export PDF à l'identité visuelle Soufflet : rendu du mur intégré, lignes détaillées,
  conditions générales, validité, acceptation en ligne.

---

## 6. COUCHE CRM (port & adaptateurs)

```ts
export interface CrmPort {
  findContact(q: ContactQuery): Promise<Contact | null>
  upsertContact(c: ContactInput): Promise<Contact>
  createDeal(d: DealInput): Promise<Deal>              // projet / devis, montant, étape
  updateDealStage(dealId: string, stage: string): Promise<void>
  attachFile(dealId: string, f: FileRef): Promise<void>   // rendu, PDF devis
  logActivity(a: ActivityInput): Promise<void>         // "devis envoyé", "devis consulté"
  listPipelines(): Promise<Pipeline[]>
  webhookHandler(evt: unknown): Promise<CrmEvent | null>
}
```
- Adaptateurs v1 : **Bexio** (très répandu en Suisse, gère aussi devis/factures → synchroniser
  le devis WallScan comme devis Bexio), **HubSpot**, `GenericWebhook` (Zapier/Make/n8n).
- Adaptateurs v2 : Salesforce, Pipedrive, Odoo.
- `InternalCrm` : CRM minimal intégré (contacts, projets, devis, relances) pour les clients
  sans CRM, même interface.
- Mapping de champs configurable par organisation, file de sync (pg-boss) avec retry +
  dead-letter, idempotency_key sur chaque action.
- Import catalogue/prix : connecteurs CSV/Excel + API ERP/fournisseur (phase 2), avec
  prévisualisation des différences avant application.

---

## 7. ÉQUIPE D'AGENTS — À CRÉER MAINTENANT

Crée ces agents dans `.claude/agents/` (un fichier Markdown par agent : frontmatter `name`,
`description`, `tools`, `model`, puis prompt système détaillé). Chaque agent connaît ce
document. Tu orchestres ; tu ne codes pas tout toi-même.

| Agent | Rôle | Responsabilités |
|---|---|---|
| `lead-architect` (toi) | Orchestration | découpage, ADR, revues, cohérence, priorisation |
| `product-owner` | Spécifications | user stories, critères Gherkin, parcours vendeur/client, i18n |
| `measurement-engineer` | §4.1 | AR, objet de référence, calibration, précision, benchmarks terrain |
| `vision-engineer` | §4.2–4.5 | segmentation, homographie, rendu GPU, transfert d'éclairage |
| `quote-engineer` | §5 | moteur de devis, règles métier, tests de référence avec l'entreprise, PDF |
| `mobile-engineer` | App Expo/RN | caméra, AR, Skia, offline, perfs, stores |
| `desktop-engineer` | App Tauri | packaging, auto-update, signature, grand écran showroom |
| `backend-engineer` | API, DB | schéma, migrations, RLS, historisation des prix, sync offline |
| `crm-integrator` | §6 | port, Bexio/HubSpot/Webhook, mapping, import catalogue/prix |
| `ui-designer` | Design system | tokens, composants, WCAG 2.2 AA, mode showroom, dark mode |
| `qa-engineer` | Qualité | tests, jeu de ≥ 50 photos de murs, ≥ 40 devis de référence, seuils |
| `security-compliance` | nLPD/RGPD | consentements, rétention, chiffrement, audit, threat model |
| `devops-engineer` | CI/CD, infra | Actions, EAS, Tauri, Vercel, Sentry, secrets |
| `tech-writer` | Docs | README, architecture, API, guide vendeur, changelog |

Règles d'équipe :
- Chaque tâche : un owner, un reviewer différent.
- Merge sur `main` uniquement si tests verts + lint + typecheck + revue.
- Veto `qa-engineer` sur rendu/mesure/devis sous les seuils de qualité.
- Veto `security-compliance` sur tout ce qui touche aux photos et données clients.
- Veto `quote-engineer` sur toute modification de prix hors base de données.

---

## 8. PLAN PAR PHASES

**Phase 0 — Fondations (semaine 1)** : monorepo, CI, design tokens, schéma DB + migrations
(catalogue, prix, taux, devis), auth, i18n. Livrable : `pnpm dev` lance mobile + desktop + web.

**Phase 1 — Mesure + Rendu + Devis MVP (semaines 2-5)** : photo/import → 4 coins manuels +
objet de référence → papier peint tuilé à l'échelle avec éclairage → moteur de devis complet
→ PDF. Import catalogue/prix par Excel. Livrable : démo sur 20 murs réels, 40 devis comparés
aux devis manuels de Soufflet (écart cible : 0 CHF sur les rouleaux, 0 sur les totaux).

**Phase 2 — Intelligence (semaines 6-8)** : mesure AR native, segmentation auto, occlusions,
offline complet, affichage des lés.

**Phase 3 — CRM & commerce (semaines 9-11)** : port CRM + Bexio + HubSpot + Webhook, projets
multi-pièces/multi-murs, page de partage client, acceptation en ligne, relances.

**Phase 4 — Durcissement & lancement (semaines 12-13)** : audit sécurité/nLPD, perfs, stores,
signature desktop, formation vendeurs, docs.

Chaque phase : démo + rapport `docs/reports/phase-N.md`.

---

## 9. CONVENTIONS

- TypeScript strict, ESLint + Prettier, Conventional Commits, branches `feat/`, `fix/`.
- Structure :
  ```
  apps/mobile  apps/desktop  apps/web  apps/api
  packages/ui  packages/core  packages/measurement  packages/render-engine
  packages/vision  packages/quote-engine  packages/crm-core  packages/crm-adapters
  packages/i18n  packages/config  docs/adr  docs/reports  .claude/agents
  ```
- Aucun secret en clair ; `.env.example` à jour.
- Toute fonction publique de `packages/*` a un test ; `quote-engine` et `measurement` : 100 %.
- Zéro chaîne UI en dur — tout passe par i18n.
- Montants : jamais de `number` flottant pour l'argent → entiers en centimes ou `decimal.js`.

---

## 10. PREMIÈRE SESSION — À FAIRE IMMÉDIATEMENT

1. Lis ce document en entier. Résume-le en 15 lignes.
2. Pose-moi **au maximum 10 questions bloquantes**, par exemple : CRM et logiciel de devis actuels
   de Soufflet ; format du catalogue et des tarifs (Excel ? ERP ? fournisseur ?) ; existence de
   textures seamless HD ; Soufflet pose-t-il ou vend-il seulement ; règles de calcul des rouleaux
   et marges de coupe qu'ils appliquent aujourd'hui ; règle de soustraction des ouvertures ;
   taux de TVA et arrondi ; plafonds de remise par vendeur ; cibles iOS/Android/Windows/macOS ;
   langues prioritaires. N'invente aucune réponse.
3. Crée les 14 agents dans `.claude/agents/` avec des prompts système précis.
4. Initialise le monorepo (Phase 0), produis `docs/architecture.md` et les premières ADR
   (Expo/Tauri/Supabase, stratégie de mesure, moteur de devis déterministe).
5. Écris `docs/reports/phase-0.md` : tâches, owner, reviewer, estimation.
6. Attends ma validation avant la Phase 1.

Tu travailles pour une vraie entreprise. Sois exigeant, précis, et dis clairement quand une
demande est techniquement risquée ou irréaliste. Ne flatte pas, ne survends pas : livre.