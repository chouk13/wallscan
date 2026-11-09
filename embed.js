/*! WallScan embed — module « Visualiser sur mon mur » pour souffletpapierpeint.ch
 *  Usage : <script src="/wallscan/embed.js" data-floating="true" async></script>
 *  Déclencheurs : tout élément [data-wallscan] (bouton, lien) ; bouton flottant si data-floating="true".
 *  Options (attributs data-* sur la balise script) :
 *    data-app      URL du module (défaut : index.html à côté de embed.js)
 *    data-mode     client | pro (défaut client)
 *    data-label    libellé du bouton flottant (défaut « Visualiser sur mon mur → »)
 *    data-floating true pour ajouter le bouton flottant en bas à droite
 *    data-inline   sélecteur CSS d'un conteneur : le module s'affiche dedans (page dédiée) au lieu d'un overlay
 *  API : window.WallScan.open({ brand, mode }) / window.WallScan.close()
 */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script || window.WallScan) return;
  var ds = script.dataset;
  var appUrl = ds.app || new URL("./index.html", script.src).href;
  var cfg = {
    mode: ds.mode || "client",
    label: ds.label || "Visualiser sur mon mur →",
    floating: ds.floating === "true",
    inline: ds.inline || ""
  };

  function buildUrl(opts) {
    var u = new URL(appUrl, location.href);
    u.searchParams.set("mode", (opts && opts.mode) || cfg.mode);
    u.searchParams.set("embed", "1");
    u.searchParams.set("images", "site");
    if (opts && opts.brand) u.searchParams.set("brand", opts.brand);
    return u.href;
  }

  var css = [
    ".ws-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(26,22,20,.72);display:flex;align-items:center;justify-content:center;padding:0;opacity:0;transition:opacity .25s}",
    ".ws-overlay.ws-open{opacity:1}",
    ".ws-frame{width:100%;height:100%;border:0;background:#1A1614;display:block}",
    ".ws-panel{position:relative;width:100%;height:100%;background:#1A1614}",
    "@media (min-width:900px){.ws-panel{width:min(1180px,calc(100vw - 48px));height:min(860px,calc(100vh - 48px))}}",
    ".ws-close{position:absolute;top:10px;right:10px;width:48px;height:48px;border:1px solid rgba(244,239,230,.4);background:rgba(26,22,20,.6);color:#F4EFE6;font:400 22px/1 'Cormorant Garamond',Georgia,serif;cursor:pointer;z-index:2;display:flex;align-items:center;justify-content:center}",
    ".ws-close:focus-visible{outline:2px solid #F4EFE6;outline-offset:2px}",
    ".ws-fab{position:fixed;right:20px;bottom:20px;z-index:2147482000;background:#1A1614;color:#F4EFE6;border:1px solid rgba(244,239,230,.4);padding:12px 18px;font:400 11px/1 'Cormorant Garamond',Georgia,serif;letter-spacing:2.2px;text-transform:uppercase;cursor:pointer;box-shadow:0 10px 30px rgba(26,22,20,.25)}",
    ".ws-fab:hover{background:#2E2823}",
    ".ws-inline{width:100%;min-height:720px;border:1px solid #D9CFBF;background:#1A1614;display:block}",
    "body.ws-lock{overflow:hidden}"
  ].join("");
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var overlay = null, lastFocus = null;

  function open(opts) {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "ws-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Visualiser sur mon mur");
    var panel = document.createElement("div");
    panel.className = "ws-panel";
    var close = document.createElement("button");
    close.className = "ws-close";
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.textContent = "×";
    close.addEventListener("click", closeOverlay);
    var frame = document.createElement("iframe");
    frame.className = "ws-frame";
    frame.title = "Visualiser sur mon mur";
    frame.setAttribute("allow", "camera; fullscreen; clipboard-write; screen-wake-lock");
    frame.setAttribute("allowfullscreen", "");
    frame.src = buildUrl(opts);
    panel.appendChild(close);
    panel.appendChild(frame);
    overlay.appendChild(panel);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeOverlay(); });
    document.body.appendChild(overlay);
    document.body.classList.add("ws-lock");
    requestAnimationFrame(function () { overlay.classList.add("ws-open"); close.focus(); });
    document.addEventListener("keydown", onKey);
  }

  function closeOverlay() {
    if (!overlay) return;
    var o = overlay; overlay = null;
    o.classList.remove("ws-open");
    document.body.classList.remove("ws-lock");
    document.removeEventListener("keydown", onKey);
    setTimeout(function () { o.remove(); }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) { if (e.key === "Escape") closeOverlay(); }

  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "wallscan:close") closeOverlay();
  });

  function bind() {
    var triggers = document.querySelectorAll("[data-wallscan]");
    for (var i = 0; i < triggers.length; i++) {
      (function (el) {
        if (el.__ws) return; el.__ws = true;
        el.addEventListener("click", function (e) {
          e.preventDefault();
          open({ brand: el.getAttribute("data-brand") || undefined, mode: el.getAttribute("data-mode") || undefined });
        });
      })(triggers[i]);
    }
    if (cfg.inline && !document.querySelector(".ws-inline")) {
      var host = document.querySelector(cfg.inline);
      if (host) {
        var f = document.createElement("iframe");
        f.className = "ws-inline";
        f.title = "Visualiser sur mon mur";
        f.setAttribute("allow", "camera; fullscreen; clipboard-write; screen-wake-lock");
        f.src = buildUrl({});
        host.appendChild(f);
      }
    }
    if (cfg.floating && !document.querySelector(".ws-fab")) {
      var fab = document.createElement("button");
      fab.className = "ws-fab";
      fab.type = "button";
      fab.textContent = cfg.label;
      fab.addEventListener("click", function () { open({}); });
      document.body.appendChild(fab);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
  // Sites React/Next : re-lier après navigation côté client.
  new MutationObserver(function () { if (!overlay) bind(); }).observe(document.documentElement, { childList: true, subtree: true });

  window.WallScan = { open: open, close: closeOverlay, url: buildUrl };
})();
