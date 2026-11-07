// WallScan — version de test : le prototype web autonome (apps/web/public/prototype) dans une WebView plein écran.
// Aucune logique métier ici : uniquement la glue native (orientation, bouton retour, presse-papiers, barres système).
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SystemUI from "expo-system-ui";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewNavigation } from "react-native-webview/lib/WebViewTypes";

import { BRIDGE_JS } from "./src/bridge";
import { PROTOTYPE_HTML } from "./src/prototype-html";

const BG = "#161616";
// Origine virtuelle de la page : donne un contexte sécurisé (clipboard, etc.) et une origine stable pour localStorage
// (les projets enregistrés par le prototype survivent aux redémarrages de l'app).
const BASE_URL = "https://wallscan.local/";
// Objets stables (hors rendu) : un nouvel objet `source` à chaque rendu provoquerait un rechargement de la page.
const SOURCE = { html: PROTOTYPE_HTML, baseUrl: BASE_URL } as const;
const ORIGIN_WHITELIST = ["*"];

type BridgeMessage =
  | { type: "ready"; screen: string | null }
  | { type: "screen"; id: string }
  | { type: "orientation"; lock: string }
  | { type: "clipboard"; text: string }
  | { type: "back"; handled: boolean };

const ORIENTATION_LOCKS: Record<string, ScreenOrientation.OrientationLock> = {
  landscape: ScreenOrientation.OrientationLock.LANDSCAPE,
  "landscape-primary": ScreenOrientation.OrientationLock.LANDSCAPE_LEFT,
  "landscape-secondary": ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
  portrait: ScreenOrientation.OrientationLock.PORTRAIT,
  "portrait-primary": ScreenOrientation.OrientationLock.PORTRAIT_UP,
  "portrait-secondary": ScreenOrientation.OrientationLock.PORTRAIT_DOWN,
};

export default function App() {
  const webRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const landscapeLockedRef = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(BG).catch(() => undefined);
    // La page gère elle-même la rotation (écran « Tourne ton téléphone ») : l'app doit laisser tourner.
    void ScreenOrientation.unlockAsync().catch(() => undefined);
  }, []);

  const applyOrientation = useCallback(async (lock: string) => {
    try {
      if (lock === "unlock" || lock === "any" || lock === "natural") {
        landscapeLockedRef.current = false;
        await ScreenOrientation.unlockAsync();
        return;
      }
      const target = ORIENTATION_LOCKS[lock];
      if (target === undefined) return;
      landscapeLockedRef.current = lock.startsWith("landscape");
      await ScreenOrientation.lockAsync(target);
    } catch {
      // appareil sans capteur ou verrou refusé : la page propose « Continuer sans tourner »
    }
  }, []);

  // Bouton retour Android : historique WebView si possible, sinon navigation interne du prototype,
  // et sortie de l'app uniquement depuis l'écran d'accueil (réponse { type: "back", handled: false }).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBackRef.current) {
        webRef.current?.goBack();
        return true;
      }
      webRef.current?.injectJavaScript("window.__wallscanBack ? window.__wallscanBack() : window.ReactNativeWebView.postMessage('{\"type\":\"back\",\"handled\":false}'); true;");
      return true;
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as BridgeMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case "orientation":
          void applyOrientation(msg.lock);
          break;
        case "screen":
          // Le verrou paysage ne vaut que pour le rendu (écran « viz ») ; ailleurs on suit le capteur.
          if (landscapeLockedRef.current && msg.id !== "viz" && msg.id !== "rotate") void applyOrientation("unlock");
          break;
        case "clipboard":
          void Clipboard.setStringAsync(msg.text).catch(() => undefined);
          break;
        case "back":
          if (!msg.handled) BackHandler.exitApp();
          break;
        default:
          break;
      }
    },
    [applyOrientation],
  );

  // Tout lien externe (http/https hors de l'origine virtuelle, mailto, tel) s'ouvre dans l'app système.
  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url;
    if (url.startsWith(BASE_URL) || url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
    void Linking.openURL(url).catch(() => undefined);
    return false;
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    canGoBackRef.current = nav.canGoBack;
  }, []);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor={BG} translucent={false} />
      <WebView
        key={reloadKey}
        ref={webRef}
        style={styles.web}
        containerStyle={styles.web}
        source={SOURCE}
        originWhitelist={ORIGIN_WHITELIST}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        textZoom={100}
        androidLayerType="hardware"
        webviewDebuggingEnabled={__DEV__}
        injectedJavaScript={BRIDGE_JS}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onRenderProcessGone={reload}
        onContentProcessDidTerminate={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
});
