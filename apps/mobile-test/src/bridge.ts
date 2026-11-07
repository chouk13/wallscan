// Script injecté dans la WebView après le chargement du prototype (injectedJavaScript).
// Il ne modifie pas index.html : il s'appuie sur ses globales (`show`, `closeSheet`, sections `.screen`)
// et dégrade proprement si elles changent (chaque accès est gardé).
//
// Messages WebView → natif (window.ReactNativeWebView.postMessage, JSON) :
//   { type: "ready", screen }            page prête
//   { type: "screen", id }               changement d'écran du prototype
//   { type: "orientation", lock }        la page a appelé screen.orientation.lock(lock) / unlock() → lock = "unlock"
//   { type: "clipboard", text }          la page a appelé navigator.clipboard.writeText(text)
//   { type: "back", handled: boolean }   réponse à __wallscanBack() (bouton retour Android)

export const BRIDGE_JS = String.raw`
(function () {
  if (window.__wallscanBridge) { return; }
  var RN = window.ReactNativeWebView;
  function post(msg) { try { if (RN) { RN.postMessage(JSON.stringify(msg)); } } catch (e) {} }
  function active() { var el = document.querySelector(".screen.active"); return el ? el.id : null; }

  // --- Pile de navigation pour le bouton retour Android (le prototype n'utilise pas history)
  var stack = [];
  var origShow = typeof window.show === "function" ? window.show : null;
  if (origShow) {
    window.show = function (id) {
      var cur = active();
      if (cur && cur !== id) { stack.push(cur); if (stack.length > 30) { stack.shift(); } }
      var r = origShow.apply(this, arguments);
      post({ type: "screen", id: id });
      return r;
    };
  }
  window.__wallscanBack = function () {
    var sheet = document.getElementById("sheet");
    if (sheet && sheet.classList.contains("open")) {
      if (typeof window.closeSheet === "function") { window.closeSheet(); }
      else { sheet.classList.remove("open"); var dim = document.getElementById("dim"); if (dim) { dim.classList.remove("open"); } }
      post({ type: "back", handled: true });
      return;
    }
    var cur = active();
    if (!cur || cur === "home" || !origShow) { post({ type: "back", handled: false }); return; }
    var prev = stack.length ? stack.pop() : "home";
    while (prev === "rotate" && stack.length) { prev = stack.pop(); }
    if (prev === "rotate") { prev = document.getElementById("result") ? "result" : "analyze"; }
    origShow(prev);
    post({ type: "screen", id: prev });
    post({ type: "back", handled: true });
  };

  // --- Orientation : screen.orientation.lock() est refusé par la WebView Android ;
  //     on le route vers expo-screen-orientation côté natif (lockAsync / unlockAsync).
  try {
    var so = window.screen && window.screen.orientation;
    if (so) {
      var lockImpl = function (mode) { post({ type: "orientation", lock: String(mode || "any") }); return Promise.resolve(); };
      var unlockImpl = function () { post({ type: "orientation", lock: "unlock" }); };
      try { Object.defineProperty(so, "lock", { value: lockImpl, configurable: true, writable: true }); } catch (e) { try { so.lock = lockImpl; } catch (e2) {} }
      try { Object.defineProperty(so, "unlock", { value: unlockImpl, configurable: true, writable: true }); } catch (e) { try { so.unlock = unlockImpl; } catch (e2) {} }
    }
  } catch (e) {}

  // --- Presse-papiers : navigator.clipboard est peu fiable dans une WebView → expo-clipboard
  try {
    var writeText = function (text) { post({ type: "clipboard", text: String(text) }); return Promise.resolve(); };
    if (navigator.clipboard) {
      try { Object.defineProperty(navigator.clipboard, "writeText", { value: writeText, configurable: true, writable: true }); }
      catch (e) { try { navigator.clipboard.writeText = writeText; } catch (e2) {} }
    } else {
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: writeText }, configurable: true }); } catch (e) {}
    }
  } catch (e) {}

  window.__wallscanBridge = true;
  post({ type: "ready", screen: active() });
})();
true;
`;
