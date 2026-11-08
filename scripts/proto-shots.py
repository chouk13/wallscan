"""Parcours automatique du prototype et captures d'écran (QA design).
Usage : python3 scripts/proto-shots.py [chemin/index.html] [dossier_sortie] [s360|s412|desk|s412-pro]
Viseur v2 (docs/reports/viewfinder-v2.md) : consensus 5 images, toggle Auto + mémorisation + déclenchement, rafale (3 images / repli une photo),
netteté, inclinaison à la prise, recoupement de hauteur, affinage des coins.
Parcours : accueil → Préparer → Photographier → (mur de démo) Vérifier (feuille, coins, vue de face, plinthe mesurée sur la photo)
→ Résultat → rendu (lés) → estimation → menu → fiche produit. Une passe supplémentaire en ?mode=pro (règles, auto-test, devis).
"""
import asyncio, sys, os
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "apps/web/public/prototype/index.html")
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/proto-shots"
ONLY = sys.argv[3] if len(sys.argv) > 3 else ""  # ex. s412 ou s412-pro : une seule passe
VIEWPORTS = {"s360": (360, 800), "s412": (412, 915), "desk": (1280, 800)}


async def full(pg, path):
    """Capture pleine hauteur : les écrans sont fixes avec un défilement interne, on les déplie le temps de la capture."""
    await pg.evaluate("""() => { const st = document.createElement('style'); st.id = '__full';
      st.textContent = 'html,body{height:auto!important;overflow:visible!important}.screen.active{position:static!important;height:auto!important;min-height:100vh}.screen.active .scroll{overflow:visible!important;flex:none}.bottombar{position:static!important}.sheet:not(.open),.toast{display:none!important}'; document.head.appendChild(st); }""")
    await pg.wait_for_timeout(80); await pg.screenshot(path=path, full_page=True)
    await pg.evaluate("document.getElementById('__full').remove()"); await pg.wait_for_timeout(50)


async def tap_stage(pg, nxy):
    """Tape un point de la photo (coordonnées normalisées 0..1 de l'image) sur la scène #stageA."""
    box = await pg.eval_on_selector("#stageA", "el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    x, y = box[0] + nxy[0] * box[2], box[1] + nxy[1] * box[3]
    await pg.mouse.move(x, y); await pg.mouse.down(); await pg.wait_for_timeout(120); await pg.mouse.up()


def check(errs, tag, name, cond, detail=""):
    """Vérification fonctionnelle : un échec s'ajoute à la liste d'erreurs (le script ne finit alors plus par « errors: none »)."""
    print(f"{tag} {'ok  ' if cond else 'ECHEC'} {name}{(' : ' + str(detail)) if detail != '' else ''}")
    if not cond:
        errs.append(f"{tag} ECHEC {name}: {detail}")


async def wait_active(pg, sid, timeout=15000):
    await pg.wait_for_function(f"document.getElementById('{sid}').classList.contains('active')", timeout=timeout)


async def ori(pg, beta, gamma, n=12):
    """Événements deviceorientation synthétiques (beta=90 : téléphone vertical) ; un flux continu pendant que le test attend."""
    await pg.evaluate("([b,g]) => { window.__beta = b; window.__gamma = g; if (!window.__oriTimer) window.__oriTimer = setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {alpha: 0, beta: window.__beta, gamma: window.__gamma})), 40); }", [beta, gamma])
    await pg.wait_for_timeout(n * 40)


async def ori_stop(pg):
    await pg.evaluate("if (window.__oriTimer) { clearInterval(window.__oriTimer); window.__oriTimer = null; }")


async def live_pure_tests(pg, errs, tag):
    """Fusion médiane, stabilité, carte Stable / Stabilisation : fonctions pures du viseur, sur des résultats synthétiques."""
    r = await pg.evaluate("""() => {
      const saveH = LIVE.hist, saveB = ORI.buf.slice(); ORI.buf.length = 0;
      const mk = (dx, dy) => ({ref: {kind: 'a4', quad: [{x: 100 + dx, y: 100 + dy}, {x: 200 + dx, y: 100 + dy}, {x: 200 + dx, y: 160 + dy}, {x: 100 + dx, y: 160 + dy}], confidence: .9},
        quad: [{x: 20 + dx, y: 10 + dy}, {x: 300 + dx, y: 12 + dy}, {x: 298 + dx, y: 200 + dy}, {x: 22 + dx, y: 198 + dy}],
        lines: {ceiling: {x1: 20 + dx, y1: 10 + dy, x2: 300 + dx, y2: 12 + dy}, floor: null, left: null, right: null}, w: 560, h: 315, vw: 1280, vh: 720, at: Date.now(), ms: 50});
      const run = (jit) => { LIVE.hist = jit.map(([dx, dy]) => mk(dx, dy)); const raw = LIVE.hist[LIVE.hist.length - 1]; const f = liveFuse(raw); f.stab = liveStability(f); return {f, assess: liveAssess(f).map(c => c.text)}; };
      const calm = run([[0, 0], [1, 0], [-1, 0], [0, 2], [5, -1]]);      // médiane (0, 0) ; écart médian 1 px
      const shaky = run([[0, 0], [4, 3], [-4, 2], [3, -4], [-3, -3]]);   // écart médian > 1,5 px
      const med = (a) => { const t = a.slice().sort((x, y) => x - y), n = t.length; return n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2; };
      const expected = med([0, 1, -1, 0, 5].map(v => 100 + v));
      const out = {n: 5, refX0: calm.f.ref.quad[0].x, expectedX0: expected, quadY0: calm.f.quad[0].y, calmPx: calm.f.stab.px, calmStable: calm.f.stab.stable, calmChip: calm.assess.filter(t => /Stab/.test(t)), shakyPx: shaky.f.stab.px, shakyStable: shaky.f.stab.stable, shakyChip: shaky.assess.filter(t => /Stab/.test(t)), ceilY: calm.f.lines.ceiling.y1,
        rawLast: calm.f.raw.ref.quad[0].x};
      LIVE.hist = saveH; ORI.buf.push(...saveB);
      // repli local de fuseQuads
      const q = (d) => [{x: d, y: 0}, {x: 10 + d, y: 0}, {x: 10 + d, y: 10}, {x: d, y: 10}];
      const fl = fuseQuadsLocal([q(0), q(1), q(2)], {maxSpreadPx: 5}), fo = fuseQuadsLocal([q(0), q(1), q(40)], {maxSpreadPx: 5}), f1 = fuseQuadsLocal([q(0)], {});
      out.local = {x0: fl.quad[0].x, used: fl.used, outlierUsed: fo && fo.used, single: f1};
      return out; }""")
    check(errs, tag, "fusion : coin affiché = médiane des 5 résultats (pas le dernier brut)", abs(r["refX0"] - r["expectedX0"]) < 1e-6 and r["refX0"] != r["rawLast"], f"médiane {r['refX0']} / dernier brut {r['rawLast']}")
    check(errs, tag, "fusion : lignes aussi en médiane", abs(r["ceilY"] - 10) < 1e-6, r["ceilY"])
    check(errs, tag, "stabilité : écart médian des coins en px", r["calmPx"] is not None and 0.5 <= r["calmPx"] <= 1.5 and r["calmStable"], f"calme {r['calmPx']} px, agité {r['shakyPx']} px")
    check(errs, tag, "stabilité : agité = Stabilisation…, calme = Stable", r["calmChip"] == ["Stable"] and r["shakyChip"] == ["Stabilisation…"] and not r["shakyStable"], f"{r['calmChip']} / {r['shakyChip']}")
    check(errs, tag, "repli local fuseQuads (médiane, rejet des aberrants, 1 quad → null)", r["local"]["x0"] == 1 and r["local"]["used"] == 3 and r["local"]["outlierUsed"] == 2 and r["local"]["single"] is None, r["local"])


async def sharp_tests(pg, errs, tag):
    """Netteté : moteur ou repli, image de démo nette vs la même floutée ; verdict du repli local."""
    r = await pg.evaluate("""async () => {
      const src = demoPhoto().src; const im = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const mkBlob = (blur) => new Promise(r => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.filter = blur ? `blur(${blur}px)` : 'none'; x.drawImage(im, 0, 0); c.toBlob(r, 'image/jpeg', .92); });
      const out = {};
      for (const [k, b] of [['net', 0], ['leger', 2], ['flou', 6]]) { const d = await decodeGray(await mkBlob(b)); out[k] = {eng: sharpOf(d.gray), loc: sharpLocal(d.gray)}; }
      out.engine = typeof WSMeasure.sharpness === 'function';
      const c = document.createElement('canvas'); c.width = 1400; c.height = 1000; const x = c.getContext('2d'); x.filter = 'blur(6px)'; x.drawImage(im, 0, 0);
      out.flouSrc = c.toDataURL('image/jpeg', .9); return out; }""")
    n, l, f = r["net"], r["leger"], r["flou"]
    check(errs, tag, "netteté : nette > légèrement floue > floue", n["eng"]["score"] > l["eng"]["score"] > f["eng"]["score"], f"{n['eng']['score']:.3f} / {l['eng']['score']:.3f} / {f['eng']['score']:.3f} ({n['eng']['src']})")
    check(errs, tag, "netteté : verdicts net ≠ blurry, flou = blurry", n["eng"]["verdict"] != "blurry" and f["eng"]["verdict"] == "blurry", f"{n['eng']['verdict']} / {l['eng']['verdict']} / {f['eng']['verdict']}")
    check(errs, tag, "netteté : repli local ordonné et flou = blurry", n["loc"]["score"] > l["loc"]["score"] > f["loc"]["score"] and f["loc"]["verdict"] == "blurry" and n["loc"]["verdict"] != "blurry", f"{n['loc']['score']:.1f} / {l['loc']['score']:.1f} / {f['loc']['score']:.1f} → {n['loc']['verdict']}, {f['loc']['verdict']}")
    return r["flouSrc"]


async def auto_tests(pg, errs, tag, out):
    """Toggle Auto : défaut, mémorisation, refus tant que le téléphone est penché, compte à rebours puis capture."""
    st0 = await pg.evaluate("({on:AUTO.on, ls:localStorage.getItem('wsAuto'), btn:!!document.getElementById('autoBtn')})")
    check(errs, tag, "Auto : désactivé par défaut", st0["btn"] and st0["on"] is False and st0["ls"] is None, st0)
    await pg.click("#autoBtn"); await pg.wait_for_timeout(150)
    st1 = await pg.evaluate("({on:AUTO.on, ls:localStorage.getItem('wsAuto'), cls:document.getElementById('autoBtn').classList.contains('on'), aria:document.getElementById('autoBtn').getAttribute('aria-pressed')})")
    check(errs, tag, "Auto : activé, mémorisé (localStorage), état visuel et aria-pressed", st1 == {"on": True, "ls": "1", "cls": True, "aria": "true"}, st1)
    await pg.screenshot(path=f"{out}/{tag}-1d2-camera-auto.png")
    # on gèle le worker et on injecte un état « tout est prêt » (feuille, plafond, sol, bords, image stable)
    await pg.evaluate("""() => { LIVE.worker.postMessage = () => {}; LIVE.pending = null; LIVE.busy = false;
      const base = LIVE.last || {}; LIVE.last = {...base, ready: true, at: Date.now(), stab: {stable: true, px: 0.4, n: 5, orientSd: 0.1}};
      window.__keep = setInterval(() => { LIVE.last.at = Date.now(); }, 120); }""")
    try:
        await ori(pg, 100, 3)   # penché de 10° : rien ne doit partir
        await pg.wait_for_timeout(1500)
        pen = await pg.evaluate("({cd:AUTO.cd, since:AUTO.since, ready:AUTO.ready, cam:document.getElementById('camera').classList.contains('active')})")
        check(errs, tag, "Auto : téléphone penché → pas de compte à rebours", pen["cd"] == 0 and pen["since"] == 0 and not pen["ready"] and pen["cam"], pen)
        t0 = await pg.evaluate("Date.now()")
        await ori(pg, 90, 0.5, n=1)  # droit
        await pg.wait_for_function("AUTO.cd > 0", timeout=4000)
        dt = await pg.evaluate("Date.now()") - t0
        dots = await pg.evaluate("({counting:document.getElementById('shutter').classList.contains('counting'), on:document.querySelectorAll('#shutter .cd b.on').length})")
        check(errs, tag, "Auto : compte à rebours après ~700 ms de stabilité, points sur le déclencheur", dt >= 600 and dots["counting"] and dots["on"] >= 1, f"{dt} ms, {dots}")
        await pg.screenshot(path=f"{out}/{tag}-1d3-camera-countdown.png")
        await wait_active(pg, "analyze", 20000)
        check(errs, tag, "Auto : capture déclenchée (écran Vérifier)", True)
    finally:
        await pg.evaluate("clearInterval(window.__keep); if (LIVE.worker) delete LIVE.worker.postMessage")
        await ori_stop(pg)
    await pg.wait_for_timeout(1900)


async def burst_report(pg, errs, tag, label, expect_count=None, expect_mode=None):
    b = await pg.evaluate("S.burst ? {count:S.burst.count, mode:S.burst.mode, shotMs:S.burst.shotMs, dt:S.burst.dtMs, scores:S.burst.scores, verdicts:S.burst.verdicts, chosen:S.burst.chosen, fuse:S.burst.fuse, fuseMs:S.burst.fuseMs, sharp:S.sharp} : null")
    check(errs, tag, f"rafale ({label}) : métriques présentes", b is not None, b)
    if not b:
        return None
    print(f"{tag} rafale ({label}) : {b['count']} image(s) en {b['shotMs']} ms ({b['mode']}, durées {b['dt']}), netteté {b['scores']} {b['verdicts']}, retenue n°{b['chosen'] + 1}, fusion {b['fuse']} ({b['fuseMs']} ms)")
    check(errs, tag, f"rafale ({label}) : la plus nette est gardée", b["scores"][b["chosen"]] == max(b["scores"]), b["scores"])
    if expect_count is not None:
        check(errs, tag, f"rafale ({label}) : {expect_count} image(s)", b["count"] == expect_count, f"{b['count']} en {b['shotMs']} ms")
    if expect_mode:
        check(errs, tag, f"rafale ({label}) : mode {expect_mode}", b["mode"] == expect_mode, b["mode"])
    return b


async def auto_memory(ctx, errs, tag):
    """Mémorisation du toggle Auto après rechargement de la page (même profil)."""
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(f"{tag} mémoire: {e}"))
    await pg.goto("file://" + HTML); await pg.wait_for_timeout(500)
    await pg.click("#toPrepare"); await pg.wait_for_timeout(2200); await pg.click("#toShoot"); await pg.wait_for_timeout(1800)
    cam = await pg.evaluate("document.getElementById('camera').classList.contains('active')")
    if cam:
        await pg.click("#autoBtn"); await pg.wait_for_timeout(100)
        await pg.reload(); await pg.wait_for_timeout(500)
        await pg.click("#toPrepare"); await pg.wait_for_timeout(2200); await pg.click("#toShoot"); await pg.wait_for_timeout(1800)
        st = await pg.evaluate("({on:AUTO.on, cls:document.getElementById('autoBtn').classList.contains('on'), ls:localStorage.getItem('wsAuto')})")
        check(errs, tag, "Auto : toujours actif après rechargement", st["on"] and st["cls"] and st["ls"] == "1", st)
        await pg.click("#autoBtn"); await pg.wait_for_timeout(100)
        check(errs, tag, "Auto : désactivation mémorisée", await pg.evaluate("localStorage.getItem('wsAuto')") == "0")
    await pg.close()


async def run(b, name, w, h, mode, errs):
    mobile = name != "desk"
    ctx = await b.new_context(viewport={"width": w, "height": h}, has_touch=mobile, is_mobile=mobile, device_scale_factor=1)
    pg = await ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(f"{name}: {e}"))
    pg.on("console", lambda m: errs.append(f"{name} console: {m.text}") if m.type == "error" else None)
    tag = f"{name}{'-pro' if mode == 'pro' else ''}"
    await pg.goto("file://" + HTML + (f"?mode={mode}" if mode else "")); await pg.wait_for_timeout(900)
    await pg.screenshot(path=f"{OUT}/{tag}-1-home.png")
    # Préparer : choix de la référence (feuille / mire / hauteur sous plafond)
    await pg.click("#toPrepare"); await pg.wait_for_timeout(2600)
    await pg.screenshot(path=f"{OUT}/{tag}-1b-prepare.png")
    await pg.click('#refChoice input[value="mire"]'); await pg.wait_for_timeout(200)
    await full(pg, f"{OUT}/{tag}-1c-prepare-mire.png")
    await pg.click('#refChoice input[value="a4"]')
    # Photographier : viseur en direct (caméra factice de Chrome) ou, sans caméra, écran de conseils + appareil natif
    await pg.click("#toShoot"); await pg.wait_for_timeout(2300)
    cam = await pg.evaluate("document.getElementById('camera').classList.contains('active')")
    if cam:
        # Guidage en direct : attendre un premier résultat du worker (ou 6 s), puis capturer l'écran avec l'overlay
        try:
            await pg.wait_for_function("LIVE.last!==null", timeout=6000)
        except Exception:
            print(f"{tag} viseur: pas de résultat du guidage en direct (worker absent ?)")
        await pg.wait_for_timeout(400)
        live = await pg.evaluate("LIVE.last?{ms:Math.round(LIVE.last.ms),ref:LIVE.last.ref&&LIVE.last.ref.kind,quad:!!LIVE.last.quad,lines:LIVE.last.lines&&Object.fromEntries(Object.entries(LIVE.last.lines).map(([k,v])=>[k,!!v])),ready:!!LIVE.last.ready,status:[...document.querySelectorAll('#liveStat .chip')].map(c=>c.textContent)}:null")
        print(f"{tag} guidage: {live}")
        # Consensus : le viseur garde les 5 derniers résultats ; l'affichage est leur médiane
        try:
            await pg.wait_for_function("LIVE.hist.length >= 5", timeout=8000)
        except Exception:
            pass
        await pg.wait_for_timeout(700)
        hist = await pg.evaluate("({n:LIVE.hist.length, shown:!!LIVE.last, hasRaw:!!(LIVE.last&&LIVE.last.raw), stab:LIVE.last&&LIVE.last.stab})")
        check(errs, tag, "consensus : LIVE garde 5 résultats", hist["n"] == 5 and hist["hasRaw"], hist)
        nat = await pg.evaluate("""() => { const H = LIVE.hist, L = LIVE.last; const med = a => { const t = a.slice().sort((x, y) => x - y), n = t.length; return n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2; };
          const r = {}; for (const k of ['ref', 'quad']) { const qs = H.map(h => k === 'ref' ? h.ref && h.ref.quad : h.quad); const shown = k === 'ref' ? L.ref && L.ref.quad : L.quad;
            if (shown && qs.every(Boolean)) r[k] = Math.max(...shown.map((p, i) => Math.max(Math.abs(p.x - med(qs.map(q => q[i].x))), Math.abs(p.y - med(qs.map(q => q[i].y)))))); }
          return r; }""")
        for k, dev in nat.items():
            check(errs, tag, f"consensus : {k} affiché = médiane des 5 images (scène réelle du viseur)", dev < 1.0, f"écart {dev:.3f} px")
        print(f"{tag} stabilité en direct: {hist['stab']}")
        await live_pure_tests(pg, errs, tag)
        tune = await pg.evaluate("CAM.tune ? {asked:CAM.tune.asked, caps:Object.keys(CAM.tune.caps), settings:{z:CAM.tune.settings.zoom, f:CAM.tune.settings.focusMode, e:CAM.tune.settings.exposureMode, w:CAM.tune.settings.whiteBalanceMode}, torch:CAM.tune.asked.torch} : null")
        check(errs, tag, "caméra : réglages prudents appliqués sans exception, torche jamais", tune is not None and tune["torch"] is None, tune)
        foot = await pg.evaluate("document.getElementById('camFoot').textContent")
        if mode == "pro":
            check(errs, tag, "mode pro : capacités effectives dans #camFoot", "Réglages : zoom" in foot and "mise au point" in foot, foot[:200])
        else:
            check(errs, tag, "mode client : #camFoot sans détail technique", "Réglages" not in foot, foot[:80])
        await pg.screenshot(path=f"{OUT}/{tag}-1d-camera.png")
        # Toggle Auto, refus penché, compte à rebours, capture (rafale normale)
        await auto_tests(pg, errs, tag, OUT)
        await burst_report(pg, errs, tag, "déclenchement auto")
        pose0 = await pg.evaluate("({pose:S.capturePose, tilt:document.getElementById('tiltBox').style.display})")
        check(errs, tag, "inclinaison : téléphone droit à la prise → pas de carte", pose0["tilt"] == "none", pose0)
        # Repli une photo : ImageCapture absent
        await pg.click("#backShoot"); await pg.wait_for_timeout(1500); await pg.click("#autoBtn")
        await pg.evaluate("() => { window.__IC = window.ImageCapture; window.ImageCapture = undefined; }")
        await pg.click("#shutter"); await wait_active(pg, "analyze"); await pg.wait_for_timeout(1900)
        await burst_report(pg, errs, tag, "ImageCapture absent", expect_count=1, expect_mode="canvas")
        await pg.evaluate("() => { window.ImageCapture = window.__IC; }")
        # Repli une photo : téléphone lent (chaque prise 1 s → 3 images dépasseraient 2,5 s)
        await pg.click("#backShoot"); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { window.__tp = ImageCapture.prototype.takePhoto; ImageCapture.prototype.takePhoto = function (...a) { return new Promise(r => setTimeout(r, 1000)).then(() => window.__tp.apply(this, a)); }; }")
        await pg.click("#shutter"); await wait_active(pg, "analyze", 25000); await pg.wait_for_timeout(1900)
        await burst_report(pg, errs, tag, "téléphone lent", expect_count=1, expect_mode="imagecapture")
        await pg.evaluate("() => { ImageCapture.prototype.takePhoto = window.__tp; }")
        # Prise manuelle, téléphone penché de 10° : rafale complète + carte d'inclinaison
        await pg.click("#backShoot"); await pg.wait_for_timeout(1500)
        await ori(pg, 100, 3)
        await pg.click("#shutter")
        await pg.wait_for_function("document.getElementById('analyze').classList.contains('active')", timeout=15000)
        await ori_stop(pg)
        await pg.wait_for_timeout(2600)
        has_ic = await pg.evaluate("typeof ImageCapture === 'function'")
        bb = await burst_report(pg, errs, tag, "prise manuelle", expect_count=3 if has_ic else None)
        if bb and has_ic and bb["shotMs"] > 1500:
            print(f"{tag} NOTE rafale : {bb['shotMs']} ms > 1 500 ms (caméra factice lente)")
        tilt = await pg.evaluate("({pose:S.capturePose, shown:document.getElementById('tiltBox').style.display!=='none', text:document.getElementById('tiltBox').textContent})")
        check(errs, tag, "inclinaison : pitch/roll mémorisés dans S.capturePose", tilt["pose"] is not None and abs(tilt["pose"]["pitch"] - 10) < 0.5 and abs(tilt["pose"]["roll"] - 3) < 0.5, tilt["pose"])
        check(errs, tag, "inclinaison : carte « Téléphone incliné de X° »", tilt["shown"] and "Téléphone incliné de 10,4°" in tilt["text"] and "précision réduite" in tilt["text"], tilt["text"])
        await pg.screenshot(path=f"{OUT}/{tag}-1e-camera-shot.png")
        info = await pg.evaluate("({w:S.img.w,h:S.img.h,ow:S.orig.width,oh:S.orig.height,ref:!!S.refQuad,refKind:S.refKind,quad:!!S.quad,proposed:S.wallProposed,fromLive:!!S.wallFromLive,partial:S.wallPartial,wall:document.getElementById('wallStatus').textContent})")
        print(f"{tag} viseur: photo {info['ow']}×{info['oh']} (travail {info['w']}×{info['h']}), référence={info['ref']} ({info['refKind']}), coins proposés={info['proposed']} (viseur={info['fromLive']}), partiel={info['partial']}")
        print(f"{tag} statut mur: {info['wall'][:160]}")
        comp = await pg.evaluate("document.getElementById('compBlock').style.display!=='none'")
        if comp:
            before = await pg.evaluate("({w:S.survey&&S.survey.widthCm,hVis:S.visibleHeightCm,inc:!!(S.survey&&S.survey.heightIncomplete),btn:document.getElementById('toResult').disabled})")
            await pg.fill("#compHeight", "250"); await pg.wait_for_timeout(600)
            after = await pg.evaluate("({w:S.survey.widthCm,h:S.survey.heightCm,done:!!S.survey.heightCompleted,btn:document.getElementById('toResult').disabled,foot:document.getElementById('compFoot').textContent})")
            print(f"{tag} complétion hauteur: avant {before} → après {after}")
            await pg.screenshot(path=f"{OUT}/{tag}-1f-completion.png")
        await pg.click("#backShoot"); await pg.wait_for_timeout(900)
        assert await pg.evaluate("document.getElementById('camera').classList.contains('active')"), "retour vers le viseur attendu"
        await pg.click("#camBack"); await pg.wait_for_timeout(200)
        # Netteté + carte « Photo floue » dans Vérifier, bouton Reprendre → viseur
        blur_src = await sharp_tests(pg, errs, tag)
        await pg.evaluate("(src) => loadPhoto(src, null, {sharp: {score: 0.05, verdict: 'blurry', src: 'test', count: 3}})", blur_src)
        await wait_active(pg, "analyze"); await pg.wait_for_timeout(1900)
        bl = await pg.evaluate("({shown:document.getElementById('blurBox').style.display!=='none', text:document.getElementById('blurBox').textContent, btn:!!document.getElementById('blurRetake')})")
        check(errs, tag, "flou : carte « Photo floue : reprenez-la » + bouton Reprendre", bl["shown"] and "Photo floue : reprenez-la" in bl["text"] and bl["btn"], bl["text"])
        await pg.screenshot(path=f"{OUT}/{tag}-2a-verify-blur.png")
        await pg.click("#blurRetake"); await wait_active(pg, "camera"); await pg.wait_for_timeout(500)
        await pg.evaluate("(src) => loadPhoto(src, null, {sharp: {score: 0.35, verdict: 'soft', src: 'test', count: 3}})", blur_src)
        await wait_active(pg, "analyze"); await pg.wait_for_timeout(1900)
        so = await pg.evaluate("({text:document.getElementById('blurBox').textContent, btn:!!document.getElementById('blurRetake')})")
        check(errs, tag, "flou : « soft » = simple avertissement sans bouton", "un peu floue" in so["text"] and not so["btn"], so["text"])
        await pg.click("#backShoot"); await wait_active(pg, "camera"); await pg.wait_for_timeout(500)
        await pg.click("#camBack"); await pg.wait_for_timeout(200)
    else:
        await pg.screenshot(path=f"{OUT}/{tag}-1d-shoot.png")
        await pg.click("#shootBack"); await pg.wait_for_timeout(200)
    # Mur de démo → Vérifier
    await pg.click("#prepBack"); await pg.wait_for_timeout(200)
    await pg.click("#demoPhoto"); await pg.wait_for_timeout(2400)
    await pg.screenshot(path=f"{OUT}/{tag}-2-verify.png")
    await full(pg, f"{OUT}/{tag}-2b-verify-full.png")
    # Affinage des coins sur les arêtes (WSMeasure.refineWallQuad) et carte de recoupement de hauteur
    rf = await pg.evaluate("({fn:typeof WSMeasure.refineWallQuad === 'function', refine:S.refine, wall:document.getElementById('wallStatus').textContent})")
    if rf["fn"]:
        check(errs, tag, "affinage : refineWallQuad appelé sur la photo pleine résolution", rf["refine"] is not None, rf["refine"])
        if rf["refine"] and rf["refine"].get("residualPx") is not None:
            check(errs, tag, "affinage : « Coins affinés sur les arêtes (résidu X px) » dans la carte des coins", "Coins affinés sur les arêtes (résidu " in rf["wall"], rf["wall"][-90:])
    else:
        print(f"{tag} affinage : WSMeasure.refineWallQuad absent, étape ignorée")
    await pg.fill("#knownH", "250"); await pg.wait_for_timeout(200)
    cb = await pg.evaluate("({text:document.getElementById('consBox').textContent, shown:document.getElementById('consBox').style.display!=='none'})")
    check(errs, tag, "hauteur connue 250 : « Mesuré 2,50 m · connu 2,50 m · écart X % » + verdict OK", cb["shown"] and "Mesuré 2,50 m · connu 2,50 m · écart " in cb["text"] and ": OK." in cb["text"], cb["text"])
    await pg.fill("#knownH", "255"); await pg.wait_for_timeout(200)
    t255 = await pg.evaluate("document.getElementById('consBox').textContent")
    await pg.fill("#knownH", "270"); await pg.wait_for_timeout(200)
    t270 = await pg.evaluate("({text:document.getElementById('consBox').textContent, h:S.survey.heightCm})")
    check(errs, tag, "hauteur connue 255 → À vérifier ; 270 → Incohérent, mesure jamais corrigée", "À vérifier" in t255 and "Incohérent" in t270["text"] and abs(t270["h"] - 250) < 2, f"{t255[-40:]} | {t270['text'][-95:]}")
    await pg.fill("#knownH", "250"); await pg.wait_for_timeout(200)
    # mode Feuille (poignées carrées) puis loupe pendant un appui sur un coin du mur
    await pg.click('#stageModes [data-mode="ref"]'); await pg.wait_for_timeout(150)
    await pg.screenshot(path=f"{OUT}/{tag}-2c-verify-ref.png")
    await pg.click('#stageModes [data-mode="wall"]'); await pg.wait_for_timeout(150)
    hb = await pg.eval_on_selector('#stageA .handle:not(.ref)', "el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    await pg.mouse.move(hb[0], hb[1]); await pg.mouse.down(); await pg.mouse.move(hb[0] + 6, hb[1] + 4, steps=4); await pg.wait_for_timeout(150)
    await pg.screenshot(path=f"{OUT}/{tag}-2d-verify-loupe.png")
    quad_before = await pg.evaluate("S.quad.map(p => p.slice())")
    await pg.mouse.move(hb[0], hb[1], steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
    if rf["fn"]:
        after = await pg.evaluate("({q:S.quad, refine:S.refine, corrected:S.corrected, wall:document.getElementById('wallStatus').textContent})")
        moved = [i for i in range(4) if abs(after["q"][i][0] - quad_before[i][0]) > 1e-9 or abs(after["q"][i][1] - quad_before[i][1]) > 1e-9]
        check(errs, tag, "coin déplacé : seul le coin touché change (affinage du côté touché)", len(moved) <= 1 and after["corrected"], f"coins modifiés {moved}, refine={after['refine']}")
    # contour : ajouter un point sur le bord haut et le tirer vers le bas (poutre) → zone hors contour déduite
    await pg.click('#stageModes [data-mode="outline"]'); await pg.wait_for_timeout(200)
    mid = await pg.eval_on_selector('#stageA .handle.mid[data-i="0"]', "el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    await pg.mouse.move(mid[0], mid[1]); await pg.mouse.down(); await pg.mouse.move(mid[0] + 2, mid[1] + 30, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(400)
    mid2 = await pg.eval_on_selector('#stageA .handle.mid[data-i="0"]', "el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    await pg.mouse.move(mid2[0], mid2[1]); await pg.mouse.down(); await pg.mouse.move(mid2[0] + 2, mid2[1] + 30, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(400)
    outl = await pg.evaluate("({pts:S.outlineCm&&S.outlineCm.length,zones:S.outlineZones.map(z=>[z.x,z.y,z.w,z.h]),area:document.getElementById('outStatus').textContent.slice(0,90)})")
    print(f"{tag} contour: {outl}")
    await pg.screenshot(path=f"{OUT}/{tag}-2e-verify-contour.png")
    await pg.click("#outReset"); await pg.wait_for_timeout(200); await pg.click('#stageModes [data-mode="wall"]'); await pg.wait_for_timeout(150)
    # plinthes : avec plinthes → mesurer sur la photo → tap sur le haut de la plinthe (point connu du mur de démo)
    dbg = await pg.evaluate("""(()=>{const el=document.querySelector('#bbSeg [data-bb="1"]');const r=el.getBoundingClientRect();let a=el,chain=[];while(a&&a!==document.body){const s=getComputedStyle(a);if(s.display==='none'||s.visibility==='hidden'||s.opacity==='0')chain.push(a.id||a.className);a=a.parentElement;}return {rect:[r.x,r.y,r.width,r.height],hidden:chain,active:[...document.querySelectorAll('.screen.active')].map(e=>e.id)}})()""")
    if dbg["hidden"] or dbg["rect"][2] == 0: print(f"{tag} DEBUG plinthes invisible: {dbg}")
    await pg.click('#bbSeg [data-bb="1"]'); await pg.wait_for_timeout(150)
    await full(pg, f"{OUT}/{tag}-2e-verify-bb-off.png")
    await pg.click("#bbMeasure"); await pg.wait_for_timeout(500)
    bb = await pg.evaluate("window.__wsDemo.bbTop")
    await tap_stage(pg, bb); await pg.wait_for_timeout(400)
    await full(pg, f"{OUT}/{tag}-2f-verify-bb.png")
    # ajout d'une ouverture en deux taps sur la vue de face, puis suppression
    await pg.click("#addOpening"); await pg.wait_for_timeout(200)
    rb = await pg.eval_on_selector("#rectBox", "el => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    await pg.mouse.click(rb[0] + rb[2] * 0.08, rb[1] + rb[3] * 0.25); await pg.wait_for_timeout(120)
    await full(pg, f"{OUT}/{tag}-2g-verify-adding.png")
    await pg.mouse.click(rb[0] + rb[2] * 0.26, rb[1] + rb[3] * 0.9); await pg.wait_for_timeout(200)
    n_open = await pg.evaluate("S.openings.length")
    await pg.click('#openings [data-del="2"]'); await pg.wait_for_timeout(150)
    # Résultat
    await pg.click("#toResult"); await pg.wait_for_timeout(400)
    cr = await pg.evaluate("({shown:document.getElementById('consRes').style.display!=='none', text:document.getElementById('consRes').textContent})")
    check(errs, tag, "résultat : recoupement de hauteur affiché", cr["shown"] and "Mesuré 2,50 m · connu 2,50 m" in cr["text"], cr["text"])
    await pg.screenshot(path=f"{OUT}/{tag}-3-result.png")
    await full(pg, f"{OUT}/{tag}-3b-result-full.png")
    state = await pg.evaluate("({w:S.w,h:S.h,hFull:S.hFull,bb:S.bb.heightCm,src:S.bb.source,op:S.openings.length,tol:S.survey.displayTolerancePct,u:S.survey.uncertaintyPct})")
    await pg.click("#validateA"); await pg.wait_for_timeout(500)
    if mobile:
        await pg.screenshot(path=f"{OUT}/{tag}-4-rotate.png")
        await pg.set_viewport_size({"width": h, "height": w}); await pg.wait_for_timeout(700)
    # Rendu = grand écran : éventail fermé à l'ouverture, onglet pour l'ouvrir
    st = await pg.evaluate("({imm:document.getElementById('viz').classList.contains('immersive'),hidden:document.getElementById('viz').classList.contains('roll-hidden'),stageW:document.getElementById('vizstage').clientWidth})")
    print(f"{tag} rendu: grand écran={st['imm']}, éventail fermé à l'ouverture={st['hidden']}")
    await pg.screenshot(path=f"{OUT}/{tag}-5-viz.png")
    await pg.click("#toggleStrips"); await pg.wait_for_timeout(300)
    await pg.screenshot(path=f"{OUT}/{tag}-5b-viz-strips.png")
    await pg.click("#toggleStrips")
    await pg.click("#rollTab"); await pg.wait_for_timeout(500)
    await pg.screenshot(path=f"{OUT}/{tag}-5c-viz-roll.png")
    await pg.evaluate("document.getElementById('roulette').scrollTop += 136*6"); await pg.wait_for_timeout(600)
    await pg.screenshot(path=f"{OUT}/{tag}-5d-viz-scroll.png")
    await pg.click("#rollTab"); await pg.wait_for_timeout(400)
    await pg.click("#validateV"); await pg.wait_for_timeout(500)
    if mobile:
        await pg.set_viewport_size({"width": w, "height": h}); await pg.wait_for_timeout(400)
    await pg.screenshot(path=f"{OUT}/{tag}-6-quote.png")
    await full(pg, f"{OUT}/{tag}-6b-quote-full.png")
    quote = await pg.evaluate("({total:S.q.total, range: S.range.thresholdInside, low:S.range.low.total, high:S.range.high.total, text: document.querySelector('#lines tr.total').textContent.trim()})")
    await pg.click("#fabQ"); await pg.wait_for_timeout(500)
    await pg.screenshot(path=f"{OUT}/{tag}-7-menu.png")
    if mode == "pro":
        await pg.click('#menutabs [data-tab="rules"]'); await pg.wait_for_timeout(200)
        await pg.evaluate("document.querySelector('#tab-rules details').open = true")
        await full(pg, f"{OUT}/{tag}-7b-rules.png")
        print("selftest:", await pg.evaluate("document.getElementById('selftest').textContent.split('\\n')[0]"))
        await pg.click('#menutabs [data-tab="catalog"]')
    await pg.click(".prod"); await pg.wait_for_timeout(500)
    await pg.screenshot(path=f"{OUT}/{tag}-8-sheet.png")
    # Retour à l'accueil : aperçu caméra en direct dès que la caméra a été autorisée une fois
    await pg.click("#sheetClose"); await pg.wait_for_timeout(300); await pg.click("#menuCam"); await pg.wait_for_timeout(1500)
    live = await pg.evaluate("document.getElementById('homeVideo').classList.contains('on')")
    await pg.screenshot(path=f"{OUT}/{tag}-9-home-live.png")
    print(f"{tag} accueil : aperçu caméra {'actif' if live else 'inactif'}")
    if mobile and mode == "" and name == "s412" and os.environ.get("SKIP_AUTO_MEMORY") != "1":
        await auto_memory(ctx, errs, tag)
    print(tag, "mesure:", state, "| ouvertures après ajout:", n_open, "| devis:", quote)
    await ctx.close()


async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        fake = os.environ.get("FAKE_CAMERA", "1") != "0"
        args = ["--no-sandbox"] + (["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] if fake else [])
        # FAKE_CAMERA_FILE=/chemin/clip.y4m : la caméra factice rejoue une vraie scène (photo réelle convertie en Y4M)
        if fake and os.environ.get("FAKE_CAMERA_FILE"):
            args.append(f"--use-file-for-fake-video-capture={os.environ['FAKE_CAMERA_FILE']}")
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=args)
        errs = []
        for name, (w, h) in VIEWPORTS.items():
            if not ONLY or ONLY == name: await run(b, name, w, h, "", errs)
        if not ONLY or ONLY == "s412-pro": await run(b, "s412", 412, 915, "pro", errs)
        print("errors:", errs if errs else "none")
        await b.close()
asyncio.run(main())
