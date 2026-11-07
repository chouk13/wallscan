# Brancher « Visualiser sur mon mur » sur souffletpapierpeint.ch

Owner : lead-architect · 2026-11-07 · Public : NLPGenerator, Alto Nova (réalisateur du site), Soufflet Décoration.

Le module est **un dossier statique** (`apps/web/public/prototype/dist/` après `pnpm build:prototype`, qui construit d'abord les
bundles des moteurs `packages/measurement` et `packages/quote-engine` quand ils existent) : `index.html` (autonome : moteurs de
mesure et de devis, motifs inlinés), `embed.js` (le plug), `manifest.webmanifest`, `icons/`, `mire-wallscan.pdf` et `mire.html`
(la feuille de référence à imprimer, `docs/specs/mire.md`). Aucun serveur, aucune base, aucune dépendance : il se dépose n'importe
où et s'ouvre dans un overlay par-dessus le site.

## 1. Hébergement — deux options

**A. Dans le site (recommandé)** — le site est en Next.js : copier le dossier dans `public/wallscan/`. Le module est alors servi
sur `https://www.souffletpapierpeint.ch/wallscan/`, **même origine** que le site (photos des marques et des chantiers réutilisées
directement, pas de CORS, caméra sans friction, cookies/stockage du site).

**B. Sur un sous-domaine NLPGenerator** — `wallscan.nlp-generator.com` via Cloudflare Pages (le domaine est déjà chez Cloudflare) :
`wrangler pages deploy apps/web/public/prototype/dist --project-name wallscan`, puis custom domain. Le plug pointe alors vers
`data-app="https://wallscan.nlp-generator.com/index.html"`. Les images du site sont chargées en cross-origin (simples `<img>`,
autorisé par défaut).

## 2. La balise à ajouter (Alto Nova, 5 minutes)

Dans `app/layout.tsx` (Next.js App Router) :

```tsx
import Script from "next/script";
// …
<Script src="/wallscan/embed.js" strategy="afterInteractive" data-floating="false" />
```

Puis, là où on veut un déclencheur, n'importe quel élément avec `data-wallscan` — par exemple dans « Comment ça marche », à côté
de « PRENDRE RENDEZ-VOUS → », avec le style des boutons du site :

```html
<a href="/wallscan/?mode=client" data-wallscan
   class="inline-block border border-charcoal/30 px-4 py-2 text-[11px] tracking-[2.2px] uppercase">
  Visualiser sur mon mur →
</a>
```

Le `href` sert de secours sans JavaScript (ouverture pleine page). Dans chaque carte de marque, un second déclencheur peut
pré-sélectionner la maison : `<a data-wallscan data-brand="elitis" …>VOIR SUR MON MUR →</a>`.

Bouton flottant (optionnel) : `data-floating="true"` sur la balise script ajoute en bas à droite un bouton « VISUALISER SUR MON
MUR → » dans le style du site (charbon, capitales espacées, angles droits).

Page dédiée (optionnel) : `data-inline="#simulateur"` affiche le module directement dans un conteneur de la page `/simulateur`.

## 3. Ce que fait le plug

- Ouvre un overlay plein écran (fond charbon à 72 %, panneau 1180 × 860 max sur ordinateur, plein écran sur téléphone) avec le
  module en `iframe` (`allow="camera; fullscreen; clipboard-write"`), bouton « × », fermeture par Échap, clic hors du panneau, ou
  message `wallscan:close` envoyé par le module (son propre bouton « Fermer »).
- Paramètres passés au module : `mode=client` (estimation, WhatsApp, rendez-vous ; pas de remise ni de règles internes),
  `embed=1`, `images=site` (réutilise `/images/brands/*.jpg` et `/images/chantier-*.jpg` du site), `brand=` (pré-sélection).
- Pour Nicolas et Mme Soufflet au showroom : ouvrir `https://www.souffletpapierpeint.ch/wallscan/?mode=pro` (tout est visible :
  remises, règles de calcul, envoi, projets). On peut protéger ce mode plus tard par un code.
- Les conversions restent celles du site : « DEMANDER VIA WHATSAPP → » (`wa.me/41765598749` avec le résumé de la simulation :
  maison, référence, dimensions du mur, estimation TTC) et « PRENDRE RENDEZ-VOUS → » (`/#contact`).

## 4. Données et confidentialité

Tout se passe dans le navigateur du visiteur : la photo du mur **ne quitte jamais l'appareil** (pas d'envoi, pas de serveur).
Les « projets enregistrés » restent dans le stockage local du navigateur. Aucune donnée personnelle n'est collectée par le module ;
le message WhatsApp est rédigé par le visiteur lui-même. Mention à prévoir dans la politique de confidentialité du site : « Le
simulateur fonctionne localement dans votre navigateur ; aucune image n'est transmise. »

## 5. Mise à jour

Un nouveau build = recopier le dossier `dist/`. Le nom des fichiers ne change pas ; ajouter `?v=2026-11-07` à l'URL du script si le
cache CDN doit être invalidé. Le catalogue (références, prix) vit dans le module tant que le flux XML n'est pas branché ; ensuite il
sera chargé depuis `catalogue.json` à côté du module (même dossier), mis à jour par l'export CRM.

## 6. Vérifications avant mise en ligne

1. Ouvrir `/wallscan/?mode=client&embed=1` sur un téléphone Android et un iPhone : caméra, mesure, rendu, estimation, WhatsApp.
2. Depuis la page d'accueil : clic sur le déclencheur → overlay → « × » → focus revenu sur le bouton.
3. Lighthouse : le module ne doit pas dégrader la page d'accueil (le script fait 6 Ko, chargé après interaction).
4. Vérifier que `Permissions-Policy` du site (s'il y en a une) autorise `camera=(self)`.
