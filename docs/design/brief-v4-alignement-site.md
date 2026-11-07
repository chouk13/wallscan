# Brief v4 — WallScan devient le module « Visualiser sur mon mur » du site souffletpapierpeint.ch

Direction artistique : lead-architect · 2026-11-07 · remplace les sections 2–3 du brief v3 (palette, typographie). Le reste du brief v3
(deux mondes, éventail d'échantillons, copy, qualité plancher) reste valable, adapté au vocabulaire du site.

## 1. Ce que le client veut

Le prototype ne sera pas une app à part : c'est un **module à brancher sur le site de l'entreprise**, pour que Soufflet Décoration
montre la simulation à ses clients (sur le site, au showroom sur tablette, en visite sur téléphone). Il doit donc **ressembler au site**,
parler comme le site, et conduire vers les conversions du site : **Demander via WhatsApp** et **Prendre rendez-vous**.

## 2. Le site tel qu'il est (relevé le 2026-11-07, https://www.souffletpapierpeint.ch/)

- Next.js (images via `/_next/image`), réalisé par Alto Nova, page unique à ancres (#maisons, #nos-marques, #realisations, #le-duo,
  #professionnels, #contact) + pages /boutique et /professionnels. Tailwind (classes `bg-paper`, `bg-charcoal`, `text-charcoal/60`,
  `border-line`, `tracking-widest uppercase`).
- **Couleurs mesurées** : fond `#FAF7F2` (body), papier `#F4EFE6` (sections), sable `#E8E0D2`, charbon `#1A1614` (texte et section
  sombre), charbon 2 `#2E2823` (liens de navigation), filet `#D9CFBF`, or `#C9A87A` (petites étiquettes sur fond sombre), brun `#8B5C4A`
  (rare). Overlay photo : `linear-gradient(to top, rgba(26,22,20,.55), rgba(26,22,20,.2) 40%, transparent 70%)`.
- **Typographie mesurée** : titres **Cormorant Garamond 300** (36 px sections, 48 px bandeaux), navigation Cormorant 14 px ; corps
  **EB Garamond 400** 16 px ; **boutons** : Cormorant 11 px, capitales, interlettrage 2,2 px, bordure 1 px (charbon/30 sur clair,
  papier/40 sur sombre), fond transparent, **angles droits**, padding 8 × 16 ; texte des liens d'action suivi de « → » ;
  **étiquettes** : capitales, interlettrage large, charbon/60 (ex. « L'ARTISAN », « HORAIRES », « AVIS CLIENTS »), or sur fond sombre.
- **Ton** : titres courts terminés par un point (« Nos marques. », « Comment ça marche. »), phrases brèves, tirets cadratins,
  points médians dans les légendes (« Résidentiel · Genève »). Promesses : « Devis sous 48h », « Plus de 1 000 échantillons ».
- **Contenu utile** : showroom **Rue Ancienne 17, 1227 Carouge** ; +41 76 559 87 49 (téléphone et WhatsApp) ; soufflet.n@outlook.com ;
  Instagram @soufflet.showroom ; horaires Lu Ma Je Ve 10h–18h, Me fermé, Sa 10h–16h30 ; **le duo** : M. Soufflet (artisan poseur,
  indépendant à Carouge depuis 2016, expert aux examens d'apprentissage GE) et Mme Soufflet (décoratrice d'intérieur) ;
  **« Papier peint haut de gamme posé — à partir de CHF 65/m² »** ; **9 maisons** : Élitis, Arte, Phillip Jeffries, Pierre Frey,
  MuralConcept, Colefax and Fowler, Iksel, Isidore Leroy, Casamance. Parcours de conversion existant : formulaire « marque + référence »
  envoyé via **WhatsApp**, boutons « Prendre rendez-vous → ».

## 3. Palette et typographie du module (alignées)

| Rôle | Valeur | Usage |
|---|---|---|
| Fond | `#FAF7F2` | écrans Carnet (menu, devis, fiches) |
| Papier | `#F4EFE6` | feuilles, échantillons, barres |
| Sable | `#E8E0D2` | surfaces secondaires, segment actif |
| Charbon | `#1A1614` | texte, boutons pleins, **scène de visualisation** (le site a une section sombre dans ce charbon : on reste dedans) |
| Charbon 2 | `#2E2823` | texte secondaire fort |
| Charbon/60 | `rgba(26,22,20,.6)` | étiquettes, texte secondaire |
| Filet | `#D9CFBF` | toutes les règles et bordures |
| Or | `#C9A87A` | étiquettes sur fond sombre, anneau de l'échantillon sélectionné, filet du total — rien d'autre |
| Alerte | `#8B5C4A` (brun du site) en texte sur clair, `#D9B08C` sur sombre | mesure à vérifier |

Polices (Google Fonts) : `Cormorant+Garamond:wght@300;400;500` (titres 300, boutons 400/500, chiffres clés 400) et
`EB+Garamond:wght@400;500` (corps, tableaux, étiquettes). Plus de Fraunces / Hanken.
Échelle : 11 (boutons, capitales) · 13 · 16 (corps) · 18 · 24 · 36 · 48. Chiffres clés de mesure en Cormorant 400, 44 px, avec unité en EB 13.

Composants : boutons = bordure 1 px, angles droits, capitales 11 px espacées 2,2 px, « → » en fin ; bouton principal = fond charbon,
texte papier, même géométrie. Étiquettes de section = capitales espacées charbon/60 (c'est le langage du site : autorisé ici,
contrairement au brief v3). Aucun arrondi > 2 px sauf les **échantillons** (coins 2 px, ombre réelle) et les poignées. Pas de
dégradés hors overlay photo du site.

## 4. Copy alignée

Titres avec point final : « Visualiser sur votre mur. », « Mesurer le mur. », « Votre estimation. », « Nos marques. »
Étiquettes : « ÉTAPE 1 · PHOTO », « ÉTAPE 2 · MESURE », « ÉTAPE 3 · RENDU », « ESTIMATION ».
Boutons : « PHOTOGRAPHIER UN MUR → », « VALIDER LA MESURE → », « CHOISIR CE PAPIER → », « DEMANDER VIA WHATSAPP → »,
« PRENDRE RENDEZ-VOUS → », « VOIR LE CATALOGUE → ». Mentions : « Estimation indicative. Devis définitif sous 48h après visite. »

## 5. Deux modes d'exécution (paramètres d'URL)

- `?mode=client` (défaut quand la page est dans le site) : **ce que voit le client**. Pas de remise, pas d'onglet Règles, pas de
  « Envoyer (simulation) » ; l'estimation inclut la pose ; CTA = « Demander via WhatsApp → » (lien `https://wa.me/41765598749?text=…`
  avec le résumé : référence, mur, estimation) et « Prendre rendez-vous → » (`https://www.souffletpapierpeint.ch/#contact`).
  Onglet Entreprise → « Le showroom » (adresse, horaires, duo, Instagram).
- `?mode=pro` : tout (remise, règles, envoi, projets), pour Nicolas et Mme Soufflet au showroom.
- `?embed=1` : ouvert dans l'overlay du site → bouton « Fermer × » en haut à droite qui envoie `postMessage({type:"wallscan:close"})`
  au parent ; pas de FAB en double. Le module reste autonome (un HTML + patterns inlinés), polices Google, aucun appel réseau.

## 6. Catalogue aligné sur les 9 maisons

Une à trois références démo par maison (noms descriptifs, prix **indicatifs**, à remplacer par le flux XML) :
Élitis (Kari, Yuzen, Moko, La Casa de Paja — existants) · Casamance (Lina, Argile, Beausoleil, Désirade, Légendes — existants) ·
**Arte** (vinyle texturé « Cuir sellier », textile « Lin lavé ») · **Phillip Jeffries** (grasscloth « Herbe de rivière », « Raphia ») ·
**Pierre Frey** (« Toile brodée » feuillage, « Rayure Deauville ») · **Colefax and Fowler** (« Bouquet chintz » feuillage, « Rayure
anglaise » 52 cm × 10 m) · **MuralConcept** (panoramique « Rêve alpin ») · **Iksel** (panoramique « Jardin peint ») ·
**Isidore Leroy** (panoramique « Forêt de brume »). Les Dominotiers sort du catalogue (absent du site).
Motifs : réutiliser les clés existantes ; deux nouvelles clés demandées au pattern-designer : `grasscloth` (fibres horizontales
irrégulières, nœuds, fond toilé) et `pano-scenic` (paysage classique peint, arbres aux feuillages pointillés, ciel lavé, tons sépia-vert).

## 7. Le plug (intégration site)

`embed.js` (fourni) : une balise `<script src=".../wallscan/embed.js" data-brand="soufflet" async></script>` dans le layout Next.js.
Il transforme tout élément `[data-wallscan]` en déclencheur (ex. un bouton « VISUALISER SUR MON MUR → » dans « Comment ça marche »
ou dans chaque carte de marque) et, si `data-floating="true"`, ajoute un bouton flottant discret en bas à droite, dans le style du site.
Le clic ouvre un overlay plein écran (fond charbon à 70 %, iframe du module en `?mode=client&embed=1`, `allow="camera; fullscreen;
clipboard-write"`), fermeture par ×, Échap ou message `wallscan:close`. Hébergement : dossier `public/wallscan/` du site Next.js
(même domaine, zéro CORS) ou `wallscan.nlp-generator.com` (Cloudflare Pages). Détail : `docs/embed-on-website.md`.
