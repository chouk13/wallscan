# Tester WallScan sur le Samsung Galaxy S24

Owner : `mobile-packager` · Mise à jour : 2026-11-07 · Public : l'utilisateur (NLPGenerator) et le client pilote.

Trois façons d'avoir le module sur le téléphone, de la plus rapide à la plus « officielle » :

| Option | Délai | Ce qu'il faut | Ce qu'on obtient |
|---|---|---|---|
| **A — GitHub Pages + « Installer l'application »** | 2 minutes | le S24 et Chrome | une icône WallScan plein écran ; **viseur caméra en direct**, mesure, rendu, devis ; hors ligne partiel (pas de service worker pour l'instant) |
| **B — APK via EAS Build (cloud Expo)** | ~1 h la première fois (dont 10–20 min d'attente) | un PC Windows ou Mac, un compte expo.dev gratuit | une vraie application installée (icône, splash, plein écran, rotation forcée en paysage pour le rendu) |
| **C — Google Play, test interne** | plus tard | le compte Play Console NLPGenerator (déjà validé) | installation par le Play Store, mises à jour automatiques |

Dans tous les cas le contenu est le même : le module web (`apps/web/public/prototype/dist/index.html`), données **indicatives (démo)**,
moteur de devis **non validé** par SOUFFLET décoration. Les photos et mesures restent sur le téléphone (pas de serveur).

> **Pourquoi pas la page claude.ai ?** La visionneuse d'artefacts claude.ai interdit la caméra, les capteurs et les téléchargements à
> toutes les pages qu'elle héberge (règles vérifiées le 2026-11-07). Elle sert à montrer le parcours avec le mur de démo ou une photo
> importée, pas à tester le viseur. Pour le viseur il faut une **vraie adresse HTTPS** : c'est l'option A.

---

## Option A — tout de suite : GitHub Pages dans Chrome

Le module est publié sur la branche `gh-pages` du dépôt **github.com/chouk13/wallscan** (dossier `dist/` tel quel + `.nojekyll`).
Réglage à faire une fois sur github.com : *Settings → Pages → Build and deployment → Source « Deploy from a branch » → `gh-pages` /
(root)*. Sur un compte GitHub gratuit, Pages exige un dépôt **public**. Adresse : **https://chouk13.github.io/wallscan/**
(`?mode=pro` pour le mode vendeur). Mise à jour après chaque changement : `scripts/deploy-pages.sh` (reconstruit `dist/` et pousse).

1. Sur le S24, ouvre **https://chouk13.github.io/wallscan/** dans **Chrome**.
2. « Photographier un mur » → « Photographier le mur » : Chrome demande l'autorisation de la caméra **une fois** → le viseur s'ouvre
   (caméra arrière, niveau, déclencheur). La photo est prise en plein format (`ImageCapture`), puis analysée sur le téléphone.
3. Menu **⋮** → **« Installer l'application »** (ou « Ajouter à l'écran d'accueil ») → l'icône WallScan ouvre le module plein écran,
   et l'accueil démarre directement sur le viseur dès que la caméra a été autorisée une fois.

**Ce qui marche** : viseur en direct, import de photo, feuille A4 / mire (PDF téléchargeable), coins + loupe, plinthes, ouvertures, rendu,
roulette, lés, fourchette de prix, WhatsApp, rendez-vous.

**Limites** : pas de service worker pour l'instant → il faut du réseau pour *ouvrir* la page (ensuite tout tourne en local) ; polices
Google chargées au premier affichage. Si la caméra est refusée ou indisponible (http, ancien navigateur), le module bascule tout seul sur
l'appareil photo natif du téléphone (`<input capture>`) : rien n'est bloquant.

---

## Option B — l'APK, construit dans le cloud Expo depuis ton PC

Aucun Android Studio ni Java à installer : le PC envoie le projet à **EAS Build** (service d'Expo), qui compile et renvoie un lien
de téléchargement. Compte gratuit suffisant pour le pilote.

### B.1 Préparer le PC (une seule fois, ~15 min)

1. **Node.js 22 LTS** : <https://nodejs.org> → bouton « LTS » (Windows : `.msi`, Mac : `.pkg`). Installe en laissant les options par défaut.
   Ferme puis rouvre le terminal (Windows : *PowerShell* ; Mac : *Terminal*) et vérifie :
   ```
   node -v
   ```
   doit afficher `v22.x.x`.
2. **pnpm** (gestionnaire de paquets du projet) :
   ```
   corepack enable
   ```
   Sous Windows, lance PowerShell **en tant qu'administrateur** pour cette commande. Si elle échoue, alternative : `npm install -g pnpm@10.28.0`.
   Vérifie : `pnpm -v` → `10.x`.
3. **Git** : Windows → <https://git-scm.com/download/win> (options par défaut) ; Mac → tape `git --version` dans le Terminal, macOS propose
   d'installer les outils en ligne de commande. EAS a besoin d'un dépôt git pour envoyer le monorepo.
4. **Compte Expo** : <https://expo.dev/signup> (gratuit, e-mail + mot de passe). Note bien l'identifiant : **tous les futurs builds doivent
   utiliser le même compte**, c'est lui qui garde la clé de signature de l'app.

### B.2 Récupérer le projet

- Soit `git clone <url du dépôt>` puis `cd wallscan`,
- soit dézippe l'archive `wallscan` reçue, ouvre le terminal **dans ce dossier** (Windows : clic droit dans le dossier → « Ouvrir dans le
  Terminal » ; Mac : glisse le dossier sur l'icône Terminal) et initialise git :
  ```
  git init
  git add -A
  git commit -m "WallScan - version de test"
  ```
  (si git demande ton nom : `git config --global user.name "Ton Nom"` et `git config --global user.email "toi@exemple.ch"`, puis refais le commit).

Puis, à la racine du projet :
```
pnpm install
```
(2–5 min la première fois ; des avertissements jaunes « deprecated » ou « peer dependencies » sont normaux).

### B.3 Lancer le build (10–20 min, dont l'attente dans la file gratuite)

Toujours à la racine du projet, régénère la page embarquée à partir du prototype, puis commite (EAS le refait aussi de son côté
avant l'installation des dépendances, mais autant envoyer un état propre) :
```
node scripts/build-prototype.mjs
git add -A
git commit -m "prototype embarque"
```
Puis :
```
cd apps/mobile-test
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

Réponds aux questions :

| Question affichée | Réponse |
|---|---|
| `Would you like to automatically create an EAS project for @toncompte/wallscan-test?` | **Y** (oui) — une seule fois |
| `Generate a new Android Keystore?` | **Y** — EAS crée et garde la clé de signature sur ton compte |
| Question sur la version (`remote version` / `initialize … from app.json`) | **Y** — EAS numérote ensuite chaque build tout seul (`autoIncrement`) |

Le terminal affiche `Build in progress`, un lien `https://expo.dev/accounts/.../builds/...` et attend. À la fin :
`✔ Build finished` + un lien **`https://expo.dev/artifacts/eas/....apk`** et un QR code.

Tu peux fermer le terminal pendant l'attente : la page du build sur expo.dev montre l'avancement et le bouton **Install** à la fin.

### B.4 Installer sur le S24

1. Sur le téléphone, ouvre la page du build (QR code, ou expo.dev → ton compte → *Projects* → *wallscan-test* → *Builds*) → **Install**,
   ou envoie-toi le lien `.apk` par e-mail/WhatsApp et ouvre-le dans Chrome.
2. Chrome télécharge `....apk` → ouvre-le depuis la notification de téléchargement.
3. Première fois : Android affiche « Pour votre sécurité, votre téléphone n'est pas autorisé à installer des applications inconnues
   provenant de cette source » → **Paramètres** → active **« Autoriser depuis cette source »** pour Chrome (ou l'app depuis laquelle tu
   as ouvert le fichier) → reviens en arrière → **Installer**.
4. Si **Play Protect** affiche « Application inconnue » / « Analyse recommandée » : **Plus d'infos** → **Installer quand même**
   (l'app n'est pas sur le Play Store, c'est attendu pour un test).
5. Ouvre **WallScan**. Au premier « Photographier un mur », autorise l'**appareil photo**.

Mise à jour : à chaque nouvelle version du prototype, refais B.3 (`node scripts/build-prototype.mjs`, commit, `build`) et installe le
nouvel APK **par-dessus** l'ancien (même compte Expo = même signature → mise à jour directe, projets conservés).

### B.5 Quotas et limites du compte gratuit (vérifiés sur expo.dev/pricing le 2026-11-07)

- **15 builds Android et 15 builds iOS** par mois, remis à zéro le **1er de chaque mois** ; aucun dépassement facturé (le build est
  simplement refusé jusqu'au mois suivant). Largement suffisant pour le pilote : compte 1 build par version testée.
- Builds en **basse priorité** (file d'attente : de quelques minutes à ~30 min aux heures de pointe) ; **45 min** de temps de build max (le nôtre prend ~10 min).
- **Durée de validité du lien `.apk`** : Expo ne la documente pas précisément (la pratique observée est de l'ordre d'un mois sur le plan
  gratuit). Par prudence, **télécharge l'APK sur le PC** (bouton *Download* sur la page du build) et garde-le : tu pourras le réinstaller
  ou l'envoyer sans refaire un build.
- Si le quota est épuisé : attendre le 1er du mois, passer au plan Starter (19 $/mois), ou compiler en local sur Mac/Linux
  (`pnpm build:apk:local`, nécessite Android Studio + JDK 17 ; pas disponible sous Windows).

### B.6 Variante sans build : Expo Go (pour tester une modification en 30 secondes)

Installe **Expo Go** depuis le Play Store sur le S24, mets le PC et le téléphone sur le **même Wi-Fi**, puis sur le PC :
```
cd apps/mobile-test
pnpm dev:go
```
Scanne le QR code avec Expo Go. C'est le même prototype dans la même WebView, mais à l'intérieur d'Expo Go (icône et splash d'Expo,
PC allumé obligatoire). Pratique pour vérifier un changement avant de consommer un build.

---

## Option C — plus tard : Google Play, piste « test interne »

Quand le prototype sera figé pour le client, l'app pourra passer par le **Play Console NLPGenerator** (compte déjà validé) en
**test interne** : jusqu'à 100 testeurs invités par e-mail, installation et mises à jour par le Play Store, plus d'APK à transférer.
Ce qu'il faudra :

1. Dans Play Console : créer l'application *WallScan (test)* avec le package `com.nlpgenerator.wallscan.test` (ou un package définitif
   `com.nlpgenerator.wallscan` — à décider avant, il ne peut plus changer ensuite).
2. Build **app-bundle** : `npx eas-cli@latest build -p android --profile production` (profil déjà prêt dans `eas.json`, signature gérée par EAS ;
   Google re-signe avec *Play App Signing*).
3. Envoi : `npx eas-cli@latest submit -p android --profile production` avec une clé de compte de service Google (à créer dans Play Console →
   *Accès API*), ou envoi manuel du `.aab` dans Play Console → *Test interne* → *Créer une release*.
4. Ajouter l'adresse Google du client dans la liste des testeurs, lui envoyer le lien d'inscription.

Le passage en production Play Store (fiche, captures, politique de confidentialité, questionnaire sécurité des données : photos de
domiciles = données personnelles) est hors périmètre du test et relève de la Phase 4 (`security-compliance`).

---

## Quand ça coince

| Symptôme | Cause probable | Solution |
|---|---|---|
| `node -v` affiche `v18`, `v20` ou « commande introuvable » | Node absent ou trop vieux | Installe Node 22 LTS, ferme/rouvre le terminal. Sous Windows, désinstalle d'abord l'ancienne version (Paramètres → Applications). |
| `pnpm : commande introuvable` / `'pnpm' n'est pas reconnu` | pnpm non activé | `corepack enable` (PowerShell administrateur) ou `npm install -g pnpm@10.28.0`, puis rouvre le terminal. |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | Node < 22 | voir ligne 1. |
| `eas build` : « *EAS Build requires git* » / « *not a git repository* » | dossier dézippé sans git | B.2 : `git init`, `git add -A`, `git commit -m "init"`. |
| `eas build` : « *Unable to find expo in this project* » ou « *package.json not found* » | lancé depuis le mauvais dossier | `cd apps/mobile-test` avant la commande. |
| `eas build` signale des changements non commités (*uncommitted changes*) | fichiers modifiés depuis le dernier commit | Par prudence : `git add -A && git commit -m "maj"` puis relance, pour être sûr que le build contient exactement ce que tu as sur le PC. |
| Build **failed** sur expo.dev, log : `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` pas à jour | à la racine : `pnpm install`, puis `git add -A && git commit -m "lockfile"` et relance. |
| Build failed, log : `Unable to resolve module …` ou `Cannot find module …` | résolution de modules avec pnpm (mode isolé) | Repli documenté : ajouter `nodeLinker: hoisted` dans `pnpm-workspace.yaml` (racine), `pnpm install`, commit, relance. |
| Build failed, log : `Keystore` / `credentials` | clé de signature manquante | relance et réponds **Y** à « Generate a new Android Keystore ». Ne change pas de compte Expo entre deux builds. |
| « **Application non installée** » / « *App not installed* » sur le S24 | (1) ancienne WallScan signée par un autre compte Expo ; (2) téléchargement incomplet ; (3) stockage plein | (1) désinstalle l'ancienne app (les projets enregistrés sont perdus) puis réinstalle ; (2) retélécharge l'APK ; (3) libère de l'espace. |
| « *Installation bloquée* » / Play Protect | app hors Play Store | Plus d'infos → Installer quand même ; ou Paramètres → Sécurité → Play Protect → analyse désactivée le temps du test. |
| La caméra ne s'ouvre pas dans l'app | permission refusée | Paramètres Android → Applications → WallScan → Autorisations → Appareil photo → Autoriser. |
| L'écran « Tourne ton téléphone » reste affiché (Option A) | rotation auto désactivée | réglages rapides → Rotation auto. ; ou « Continuer sans tourner ». Dans l'APK l'app force elle-même le paysage. |
| Le lien (Option A) montre une page blanche ou une vieille version | cache Chrome | tire vers le bas pour recharger ; sinon Chrome → ⋮ → Paramètres → Confidentialité → Effacer les données de navigation (site uniquement). |
| Quota EAS épuisé (`You have reached the limit…`) | 15 builds/mois atteints | attendre le 1er du mois, ou plan Starter, ou build local (Mac/Linux). |

Besoin du détail technique (versions, pont WebView, profils EAS) : [`apps/mobile-test/README.md`](../apps/mobile-test/README.md).
