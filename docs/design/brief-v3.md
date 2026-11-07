# WallScan — Brief de direction artistique v3

Direction artistique : lead-architect (studio). Destinataires : `pattern-designer`, `ui-engineer`, `design-qa`, `mobile-packager`.
Fichier cible : `apps/web/public/prototype/index.html` (+ `patterns.js` inliné au build).

## 1. Le sujet, l'audience, le travail à faire

- **Sujet** : l'outil de terrain d'un peintre-décorateur haut de gamme (SOUFFLET décoration, Carouge) qui, chez le client, photographie
  un mur, le mesure, y montre des papiers peints Élitis / Casamance / Les Dominotiers à l'échelle réelle et sort un devis.
- **Audience** : Nicolas (opérateur, pressé, debout, une main) et le client qui regarde par-dessus son épaule (doit être séduit).
- **Travail n°1 de l'interface** : faire exister **le mur et le papier**. Tout le reste est un cadre discret, comme la salle de
  présentation d'un décorateur : murs sombres neutres, lumière sur l'échantillon, et un **carnet** à côté pour les prix.
- **Vernaculaire à exploiter** : rouleau, lé, raccord, échantillon, nuancier-éventail, carnet de prix, papier (grain, pli), laiton.

## 2. Deux mondes : l'Atelier et le Carnet

| | **Atelier** (on regarde le mur) | **Carnet** (on consulte) |
|---|---|---|
| Écrans | Caméra, Visualisation (paysage), partie photo de l'Analyse | Menu, Catalogue, Fiche produit, Devis, Règles, Entreprise, partie mesure de l'Analyse |
| Fond | Graphite **neutre** `#161616` — neutre parce que le jugement des couleurs d'un papier exige un entourage non teinté | Papier `#F3F2EE`, surfaces secondaires Lin `#E6E1D6` |
| Texte | Papier `#F3F2EE` ; secondaire Sauge `#9DB5A6` | Encre **Vert cabinet** `#1F3D36` ; secondaire `#5B6762` |
| Action principale | Bouton Papier sur Graphite | Bouton Vert cabinet sur Papier |
| Accent unique | **Laiton** `#B08D57` : anneau de sélection de l'échantillon, et rien d'autre | Laiton : filet du total du devis, et rien d'autre |
| Alerte | Ocre clair `#E0935A` en texte sur Graphite (7.3:1) | Ocre foncé `#8F4A1E` en texte sur Papier (5.9:1), fond d'alerte `#F6E7DC` ; `#B8642E` seulement pour un filet ou une icône |

L'écran **Analyse** est la charnière : la photo (graphite) est *posée sur* la fiche de mesure (papier). Composition : photo en haut
dans un cadre graphite, fiche papier qui remonte dessous.

Palette (6 valeurs nommées) : Graphite `#161616` · Vert cabinet `#1F3D36` · Sauge `#9DB5A6` · Papier `#F3F2EE` · Lin `#E6E1D6` · Laiton `#B08D57`.
Interdits : dégradés décoratifs, ombres grises systématiques sous chaque carte, bordures sur tout, noir teinté « premium ».
Une ombre existe à un seul endroit : sous les **échantillons papier** (voir §4), parce qu'ils représentent des objets.

## 3. Typographie

- **Fraunces** (Google Fonts, axe `opsz`, graisse 500–600) : wordmark « WallScan », titres d'écran, noms d'éditeurs, nom du papier
  sur la fiche. Jamais en petit (< 20 px).
- **Hanken Grotesk** (400 / 500 / 600) : tout le reste. Interface, prix, tableaux.
- Échelle : 13 · 15 · 17 · 21 · 26 · 34 · 44. Interligne 1.45 (Hanken), 1.2 (Fraunces). Chiffres tabulaires dans le devis.
- Interdits : capitales espacées en « eyebrow », libellés au-dessus de tout, points médians « A · B · C » pour joindre des infos
  (faire des puces séparées ou des phrases), « → » collé au texte des boutons, un seul mot coloré dans un titre.

## 4. L'élément mémorable : l'éventail d'échantillons

La **roulette** (écran Visualisation, à droite) n'est pas une liste : c'est un **nuancier-éventail**. Chaque référence est un
**échantillon papier** : carte 92 × 118 px, fond Papier, marge 6 px, motif en haut (92 × 84), bandeau bas avec le nom (Hanken 12 / 500)
et l'éditeur (11 / 400, secondaire). Légère rotation alternée (−2° / +2°) pour les voisins, échantillon **sélectionné** droit, à
l'échelle 1.08, **anneau Laiton 2 px** et ombre portée réelle (`0 10px 24px rgba(0,0,0,.45)`). Défilement vertical à crans
(`scroll-snap`), le cran central change le papier sur le mur. Au tap, on centre. C'est la seule fantaisie de l'interface.

Même langage sur l'écran Caméra : les deux cartes du bas sont deux **échantillons** posés l'un sur l'autre (la première,
« Photographier un mur », plus grande ; la seconde, « Menu », en retrait). Pas d'emoji : icônes SVG inline, trait 1.75 px.

## 5. Écrans (wireframes)

Portrait 412 × 915 sauf mention. Marges latérales 20 px. Zones de sécurité iOS respectées (`env(safe-area-inset-*)`).

### Caméra (accueil, monde Atelier)
```
┌──────────────────────────────┐
│ WallScan              (menu) │  ← wordmark Fraunces 26 à gauche ; bouton rond menu 52 px en haut à droite (en plus du FAB demandé)
│                              │
│      [viseur plein écran]    │  ← 4 coins de cadrage fins, grille 3×3 à 6 % d'opacité
│      « Cadre le mur entier » │  ← une ligne, Papier, 15 px, centrée dans le tiers haut
│                              │
│  ┌───────────────────────┐   │
│  │ ◉ Photographier un mur │   │  ← échantillon n°1 : Papier, texte Vert cabinet, icône caméra, sous-titre « Mesure, rendu, devis »
│  │  ┌─────────────────┐  │   │
│  └──│ ▤ Menu           │──┘   │  ← échantillon n°2 : Lin, en retrait de 12 px, « Catalogue, projets, devis »
│     └─────────────────┘       │
│  Essayer avec un mur de démo  │  ← lien texte, Sauge
│                          (☰)  │  ← FAB 56 px en bas à droite (exigence client)
└──────────────────────────────┘
```

### Analyse (charnière)
```
┌──────────────────────────────┐
│ ‹ Caméra     Analyse du mur  │  ← barre papier ; titre Fraunces 21 ; barre de progression 3 segments (1 plein) sous la barre
│ ┌──────────────────────────┐ │
│ │  photo + 4 poignées      │ │  ← cadre graphite, poignées Papier à anneau Vert cabinet 2 px, 36 px
│ │  (scan 1,5 s à l'arrivée)│ │
│ └──────────────────────────┘ │
│  420 × 250 cm      10,5 m²   │  ← chiffres Hanken 34/600 Vert cabinet, unités 13 secondaire ; ligne 2 : état de confiance
│  ✓ Fiable à 85 %, feuille A4 │  ← ou « À vérifier (62 %) : la feuille est trop petite sur la photo »
│  Référence d'échelle         │
│  (Hauteur sous plafond)(A4)(Cotes) │ ← segments, pas de chips flottantes
│  240 250 260 280 300 320     │  ← valeurs rapides
│  Portes et fenêtres   + Ajouter│
│  ...                         │
│ [ Valider la mesure ]        │  ← bouton plein Vert cabinet, 56 px, collé en bas
└──────────────────────────────┘
```

### Tourne ton téléphone — plein écran Atelier, pictogramme téléphone animé une fois (pas en boucle), bouton secondaire « Continuer sans tourner ».

### Visualisation (paysage 915 × 412, Atelier)
```
┌───────────────────────────────────────────┬──────────┐
│ Désirade, Casamance    6 lés  4 rouleaux   │  ╭────╮  │  ← chips graphite translucides en haut à gauche (3 chips distinctes)
│                                           │  │ éch │  │
│          [photo plein cadre, papier       │  ╰────╯  │  ← éventail : échantillons, rotation alternée, sélection droite + anneau Laiton
│           appliqué sur le mur]            │ ╭─────╮  │
│                                           │ │ SEL │  │
│ ‹ Mesure   Afficher les lés   Choisir ce papier │ ╰─────╯  │  ← bas gauche : secondaire, secondaire, principal (Papier sur Graphite)
└───────────────────────────────────────────┴──────────┘
```
Largeur de l'éventail : 128 px. Fond de l'éventail : Graphite plus clair de 4 % (`#1C1C1C`) sans bordure.

### Devis (Carnet)
Feuille papier : en-tête « Devis » Fraunces 26 + « Soufflet décoration, Carouge » 13 secondaire ; tableau à filets hairline Lin,
chiffres tabulaires ; total TTC en Hanken 21/600 avec **filet Laiton** au-dessus ; « Pourquoi 4 rouleaux ? » en accordéon ;
options en lignes à interrupteur (pas de cases à cocher brutes) ; remise ; actions : « Envoyer au client » (principal),
« Copier le devis », « Enregistrer le projet » (secondaires, même rangée si la place le permet, sinon empilées).

### Menu (Carnet)
Barre : « Menu » Fraunces 26 ; onglets soulignés (Catalogue, Projets, Entreprise, Règles) — soulignement Vert cabinet 2 px,
pas de pilules. Catalogue : recherche en haut ; par éditeur, nom Fraunces 24 ; chaque référence = ligne avec **échantillon 56 × 56**
(même objet qu'ailleurs, petit), nom + coloris, format et raccord en secondaire, prix à droite (rouleau, puis au m² en secondaire).
Fiche produit : feuille coulissante ; grand échantillon 100 % × 160 ; spécifications en grille 2 colonnes sans cartes (filets
hairline) ; bouton principal « Voir sur le dernier mur » ou « Photographier un mur avec ce papier ».

## 6. Mouvement

Un seul moment orchestré : le **scan** à l'arrivée d'une photo (1,5 s). Puis uniquement des réponses à l'action : ouverture de
la feuille produit (280 ms), passage d'un échantillon à l'autre (anneau + échelle, 180 ms), toasts. `prefers-reduced-motion` :
tout instantané. Pas d'apparition en fondu des sections, pas de transitions au survol.

## 7. Qualité plancher

Tactile ≥ 48 px ; contraste AA (texte ≥ 4.5:1, grands titres ≥ 3:1) ; focus visible (anneau Vert cabinet / Papier) ; tout
fonctionne à 360 × 800 et 412 × 915, paysage 915 × 412, et à 1280 × 800 (le contenu Carnet centré à 720 px max, l'Atelier
plein cadre). Pas d'emoji dans l'interface. Pas de chaîne anglaise. Sentence case partout.

## 8. Copy (voix)

Phrases courtes, verbes d'action, sentence case. Un bouton dit ce qu'il fait et garde son nom : « Envoyer au client » → toast
« Devis envoyé ». Erreurs : ce qui s'est passé + quoi faire (« La feuille A4 est trop petite sur la photo : rapproche-toi ou
saisis la hauteur sous plafond »). Vide : une invitation (« Aucun projet pour l'instant. Photographie un mur pour commencer. »).
Mentions obligatoires, discrètes : « Démo, prix indicatifs » en 12 px secondaire au pied des écrans Carnet — jamais un bandeau.

## 9. Ce qui ne change pas

Le moteur JavaScript (devis, mesure, homographie, roulette → sélection) et les **identifiants DOM** qu'il utilise. Le contrat
`svgTile(p)` / `tileCm(p)` / `isPano(p)` des motifs. Le fichier reste autonome (un seul HTML + patterns inliné au build) et respecte
la politique de la page hébergée : polices via fonts.googleapis.com uniquement, pas d'images distantes, pas de `alert`.
