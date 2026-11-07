# @wallscan/mobile-test — APK de test du prototype

Application Expo (SDK 52) minimale : **un seul écran**, une `WebView` plein écran qui charge le prototype web autonome
(`apps/web/public/prototype/index.html` + `patterns.js` inliné). Aucune logique métier ici — uniquement la glue native.
Guide utilisateur (non technique) : [`docs/test-on-phone.md`](../../docs/test-on-phone.md).

## Commandes

```bash
pnpm --filter @wallscan/mobile-test prebuild:proto   # régénère src/prototype-html.ts depuis le prototype (à commiter)
pnpm --filter @wallscan/mobile-test assets           # régénère icônes + splash + icônes PWA (scripts/gen-mobile-assets.mjs)
pnpm --filter @wallscan/mobile-test typecheck        # tsc --noEmit
pnpm --filter @wallscan/mobile-test doctor           # expo-doctor (réseau requis pour 3 des 18 vérifications)

cd apps/mobile-test
npx eas-cli login
pnpm build:apk          # = eas build -p android --profile preview  → APK installable (cloud EAS, ~10–20 min)
pnpm build:dev          # dev client (profil development)
pnpm build:aab          # app-bundle pour le Play Store (profil production)
pnpm build:apk:local    # idem preview mais compilé sur ce PC (Android SDK + JDK 17 requis ; pas sous Windows)
pnpm dev                # Metro pour un dev client installé (profil development)
pnpm dev:go             # Metro pour Expo Go (toutes les dépendances natives utilisées sont incluses dans Expo Go SDK 52)
```

## Fonctionnement

| Sujet | Implémentation |
|---|---|
| Chargement | `source={{ html: PROTOTYPE_HTML, baseUrl: "https://wallscan.local/" }}` — origine virtuelle stable → `localStorage` (projets enregistrés) persistant, contexte sécurisé |
| Caméra | `<input type="file" accept="image/*" capture="environment">` de la page → file chooser Android de la WebView → appareil photo. Permission `CAMERA` déclarée ; `react-native-webview` la demande à l'exécution |
| Rotation | La page appelle `screen.orientation.lock("landscape")` (écran « Tourne ton téléphone »). Dans une WebView Android cet appel est refusé : `src/bridge.ts` le remplace et le route vers `expo-screen-orientation` (`lockAsync`), puis `unlockAsync()` dès qu'on quitte l'écran de rendu. `unlockAsync()` est aussi appelé au démarrage ; `orientation: "default"` dans `app.json` |
| Bouton retour Android | `BackHandler` → `goBack()` si la WebView a un historique, sinon `window.__wallscanBack()` (pile d'écrans construite en enveloppant `show()`), sortie de l'app uniquement depuis l'accueil |
| Presse-papiers | `navigator.clipboard.writeText` remplacé par `expo-clipboard` (plus fiable dans une WebView) |
| Barres système | Barre d'état et de navigation `#161616`, icônes claires, non translucides (la page ne reçoit pas les `safe-area-inset` dans une WebView) |
| Liens externes | `onShouldStartLoadWithRequest` : tout ce qui sort de `https://wallscan.local/` s'ouvre dans l'app système |
| Taille du texte | `textZoom={100}` : la WebView ignore le réglage système de taille de police pour garder la mise en page du prototype |
| Crash du moteur WebView | `onRenderProcessGone` → rechargement |

## Fichiers

```
App.tsx                 WebView + glue native
index.ts                registerRootComponent (évite expo/AppEntry, incompatible avec les symlinks pnpm)
src/bridge.ts           script injecté (retour, orientation, presse-papiers)
src/prototype-html.ts   GÉNÉRÉ par scripts/build-prototype.mjs — commité, EAS en a besoin
assets/                 icônes/splash GÉNÉRÉS par scripts/gen-mobile-assets.mjs (+ wallscan-mark.svg de référence)
app.json                config Expo : package com.nlpgenerator.wallscan.test, CAMERA, orientation default, dark
eas.json                profils development (dev client, apk) · preview (apk, interne) · production (aab, store)
metro.config.js         config par défaut d'Expo (détection automatique du monorepo)
```

## Choix et contraintes

- **Versions épinglées** sur `bundledNativeModules.json` d'`expo@52.0.49` : RN 0.76.9, React 18.3.1, react-native-webview 13.12.5,
  expo-screen-orientation 8.0.4, expo-splash-screen 0.29.24, expo-status-bar 2.0.1, expo-system-ui 4.0.9, expo-clipboard 7.0.1,
  expo-dev-client 5.0.20. `newArchEnabled: false` (ancienne architecture, la plus éprouvée pour WebView + file chooser).
- **pnpm en mode isolé** (layout par défaut du monorepo) : `@babel/runtime` est déclaré en dépendance directe, sinon Metro
  ne résout pas les helpers injectés par Babel. Pas de `babel.config.js` (Expo utilise `babel-preset-expo` par défaut ;
  en ajouter un obligerait à déclarer `babel-preset-expo` ici). Vérifié : `expo prebuild`, autolinking et `expo export`
  passent avec ce layout. Si EAS échouait quand même sur une résolution de module, repli : `nodeLinker: hoisted` dans
  `pnpm-workspace.yaml` puis `pnpm install`.
- **Pas d'`expo-updates`** : chaque nouvelle version du prototype = nouveau build (`prebuild:proto` puis `build:apk`). Filet de
  sécurité : le hook `eas-build-pre-install` régénère `src/prototype-html.ts` dans le cloud à partir de l'`index.html` commité,
  donc un oubli de `prebuild:proto` ne produit jamais un APK avec une page obsolète.
- `android/` et `ios/` ne sont pas commités (génération native continue par EAS).
- `.easignore` à la racine du dépôt réduit l'archive envoyée à EAS (docs, supabase, cibles Tauri…).
