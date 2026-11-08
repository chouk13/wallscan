"""Parcours automatique du prototype et captures d'écran (QA design).
Usage : python3 scripts/proto-shots.py [chemin/index.html] [dossier_sortie] [s360|s412|desk|s412-pro]
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
        await pg.screenshot(path=f"{OUT}/{tag}-1d-camera.png")
        await pg.click("#shutter")
        await pg.wait_for_function("document.getElementById('analyze').classList.contains('active')", timeout=15000)
        await pg.wait_for_timeout(2600)
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
    else:
        await pg.screenshot(path=f"{OUT}/{tag}-1d-shoot.png")
        await pg.click("#shootBack"); await pg.wait_for_timeout(200)
    # Mur de démo → Vérifier
    await pg.click("#prepBack"); await pg.wait_for_timeout(200)
    await pg.click("#demoPhoto"); await pg.wait_for_timeout(2400)
    await pg.screenshot(path=f"{OUT}/{tag}-2-verify.png")
    await full(pg, f"{OUT}/{tag}-2b-verify-full.png")
    # mode Feuille (poignées carrées) puis loupe pendant un appui sur un coin du mur
    await pg.click('#stageModes [data-mode="ref"]'); await pg.wait_for_timeout(150)
    await pg.screenshot(path=f"{OUT}/{tag}-2c-verify-ref.png")
    await pg.click('#stageModes [data-mode="wall"]'); await pg.wait_for_timeout(150)
    hb = await pg.eval_on_selector('#stageA .handle:not(.ref)', "el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    await pg.mouse.move(hb[0], hb[1]); await pg.mouse.down(); await pg.mouse.move(hb[0] + 6, hb[1] + 4, steps=4); await pg.wait_for_timeout(150)
    await pg.screenshot(path=f"{OUT}/{tag}-2d-verify-loupe.png")
    await pg.mouse.move(hb[0], hb[1], steps=4); await pg.mouse.up(); await pg.wait_for_timeout(300)
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
