"""Génère la mire imprimable (PDF A4) depuis apps/web/public/prototype/mire.html et vérifie ses cotes physiques.

Usage : python3 scripts/build-mire.py [--no-check] [--dpi 300] [--keep-png]

1. Rendu : Playwright + Chrome (/usr/bin/google-chrome, --no-sandbox), page.pdf(format A4, printBackground, preferCSSPageSize).
   Les polices Cormorant Garamond / EB Garamond sont injectées en @font-face local (scripts/assets/fonts, licence OFL) pour que
   le PDF les embarque même sans accès à fonts.googleapis.com. La géométrie ne dépend pas des polices.
2. Vérification : rasterisation à `dpi` (pdftoppm si présent, sinon PyMuPDF, sinon capture Playwright à échelle connue), puis
   mesure en pixels → mm du bord extérieur du cadre (190 × 277 mm à 10 mm des bords), de l'épaisseur du cadre (10 mm), des
   repères (15 mm), du code (50 mm, cases de 10 mm) et de la règle (100 mm). Échec (code 1) si une cote s'écarte de plus de 0,5 mm.
   Les résultats sont imprimés et écrits dans docs/specs/mire-verification.json (consommé par docs/specs/mire.md).
"""
import asyncio, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "apps/web/public/prototype/mire.html")
OUT = os.path.join(ROOT, "apps/web/public/prototype/mire-wallscan.pdf")
FONTS = os.path.join(ROOT, "scripts/assets/fonts")
REPORT = os.path.join(ROOT, "docs/specs/mire-verification.json")
CHROME = "/usr/bin/google-chrome"
TOL_MM = 0.5
A4_MM = (210.0, 297.0)
A4_PT = (595.28, 841.89)

# Cotes nominales (mm) — doivent rester identiques à mire.html et docs/specs/mire.md
NOMINAL = {
    "frame_outer_w": 190.0, "frame_outer_h": 277.0, "frame_left": 10.0, "frame_top": 10.0,
    "frame_thickness": 10.0, "marker": 15.0, "marker_inset_from_inner_edge": 10.0,
    "code_size": 50.0, "code_cell": 10.0, "ruler": 100.0,
}

FONT_FACES = """
@font-face{font-family:"Cormorant Garamond";font-style:normal;font-weight:300;src:url("file://%(d)s/cormorant-garamond-latin-300-normal.woff2") format("woff2")}
@font-face{font-family:"Cormorant Garamond";font-style:normal;font-weight:400;src:url("file://%(d)s/cormorant-garamond-latin-400-normal.woff2") format("woff2")}
@font-face{font-family:"Cormorant Garamond";font-style:normal;font-weight:500;src:url("file://%(d)s/cormorant-garamond-latin-500-normal.woff2") format("woff2")}
@font-face{font-family:"EB Garamond";font-style:normal;font-weight:400;src:url("file://%(d)s/eb-garamond-latin-400-normal.woff2") format("woff2")}
@font-face{font-family:"EB Garamond";font-style:normal;font-weight:500;src:url("file://%(d)s/eb-garamond-latin-500-normal.woff2") format("woff2")}
"""


def inject_fonts(html: str) -> str:
    if not os.path.isdir(FONTS):
        return html
    return html.replace("</head>", "<style>" + (FONT_FACES % {"d": FONTS}) + "</style></head>", 1)


async def render_pdf(dpi_shot: int | None = None) -> str | None:
    """Produit OUT. Si dpi_shot est donné, retourne aussi une capture PNG de la page à cette échelle (secours de vérification)."""
    from playwright.async_api import async_playwright
    html = inject_fonts(open(SRC, encoding="utf-8").read())
    tmp = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, dir=os.path.dirname(SRC), encoding="utf-8")
    tmp.write(html); tmp.close()
    shot = None
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
            pg = await b.new_page(viewport={"width": 794, "height": 1123})
            pg.on("console", lambda m: print("console:", m.type, m.text) if m.type == "error" else None)
            await pg.goto("file://" + tmp.name, wait_until="load")
            await pg.evaluate("document.fonts.ready.then(()=>true)")
            loaded = await pg.evaluate("""() => ({
                cormorant: document.fonts.check('300 16px "Cormorant Garamond"'),
                eb: document.fonts.check('400 16px "EB Garamond"') })""")
            print("fonts:", loaded)
            await pg.emulate_media(media="print")
            await pg.pdf(path=OUT, format="A4", print_background=True, prefer_css_page_size=True)
            if dpi_shot:
                # Échelle connue : 1 mm CSS = 96/25.4 px CSS ; device_scale_factor = dpi/96 → 1 mm = dpi/25.4 px
                ctx = await b.new_context(viewport={"width": 794, "height": 1123}, device_scale_factor=dpi_shot / 96)
                pg2 = await ctx.new_page(); await pg2.goto("file://" + tmp.name, wait_until="load")
                await pg2.emulate_media(media="print")
                shot = OUT.replace(".pdf", "-shot.png")
                await pg2.screenshot(path=shot, clip={"x": 0, "y": 0, "width": 794, "height": 1123})
                await ctx.close()
            await b.close()
    finally:
        os.unlink(tmp.name)
    return shot


def rasterize(dpi: int):
    """Retourne (image numpy niveaux de gris uint8, méthode)."""
    import numpy as np
    from PIL import Image
    if shutil.which("pdftoppm"):
        with tempfile.TemporaryDirectory() as d:
            base = os.path.join(d, "mire")
            subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-singlefile", "-gray", OUT, base], check=True)
            return np.array(Image.open(base + ".png").convert("L")), "pdftoppm %d dpi" % dpi
    try:
        import fitz  # PyMuPDF
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "pymupdf"], check=False)
        try:
            import fitz
        except ImportError:
            fitz = None
    if fitz is not None:
        doc = fitz.open(OUT); pix = doc[0].get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy(), "PyMuPDF %d dpi" % dpi
    return None, "none"


def measure(img, dpi: int) -> dict:
    """Mesure les cotes en mm sur l'image rasterisée (noir = < 128)."""
    import numpy as np
    px = dpi / 25.4  # pixels par mm
    mm = lambda n: round(n / px, 3)
    H, W = img.shape
    black = img < 128
    rows = np.where(black.any(axis=1))[0]; cols = np.where(black.any(axis=0))[0]
    top, bottom, left, right = rows[0], rows[-1], cols[0], cols[-1]
    res = {"page_px": [int(W), int(H)], "page_mm": [mm(W), mm(H)], "raster": None}
    # Bord extérieur du cadre : l'emprise totale du noir (tout le reste est à l'intérieur du cadre)
    res["frame_left"] = mm(left); res["frame_top"] = mm(top)
    res["frame_outer_w"] = mm(right - left + 1); res["frame_outer_h"] = mm(bottom - top + 1)
    # Épaisseur : longueur des runs noirs depuis chaque bord, sur la ligne médiane / la colonne médiane
    mid_r, mid_c = (top + bottom) // 2, (left + right) // 2
    def run(line, start, step):
        n = 0; i = start
        while 0 <= i < len(line) and line[i]:
            n += 1; i += step
        return n
    res["frame_thickness_left"] = mm(run(black[mid_r], left, 1)); res["frame_thickness_right"] = mm(run(black[mid_r], right, -1))
    res["frame_thickness_top"] = mm(run(black[:, mid_c], top, 1)); res["frame_thickness_bottom"] = mm(run(black[:, mid_c], bottom, -1))
    res["frame_thickness"] = round((res["frame_thickness_left"] + res["frame_thickness_right"] + res["frame_thickness_top"] + res["frame_thickness_bottom"]) / 4, 3)
    # Repère haut-gauche (carré) : emprise du noir dans la fenêtre nominale élargie
    def bbox(x0, y0, x1, y1):
        sub = black[int(y0 * px):int(y1 * px), int(x0 * px):int(x1 * px)]
        r = np.where(sub.any(axis=1))[0]; c = np.where(sub.any(axis=0))[0]
        if not len(r): return None
        return (x0 + c[0] / px, y0 + r[0] / px, (c[-1] - c[0] + 1) / px, (r[-1] - r[0] + 1) / px)
    tl = bbox(25, 25, 50, 50); tr = bbox(160, 25, 185, 50); bl = bbox(25, 247, 50, 272); br = bbox(160, 247, 185, 272)
    for k, b in (("marker_tl", tl), ("marker_tr", tr), ("marker_bl", bl), ("marker_br", br)):
        res[k] = [round(v, 3) for v in b] if b else None
    res["marker"] = round(sum(b[2] for b in (tl, tr, bl, br) if b) / 4, 3)
    res["marker_inset_from_inner_edge"] = round(tl[0] - (res["frame_left"] + res["frame_thickness_left"]), 3) if tl else None
    # Code : emprise du noir dans la zone de silence (70..140 × 113.5..183.5)
    code = bbox(70, 113.5, 140, 183.5)
    res["code_bbox"] = [round(v, 3) for v in code] if code else None
    res["code_size"] = round((code[2] + code[3]) / 2, 3) if code else None
    # Case : première rangée du code = 1 0 1 1 0 → run noir de la première case sur la ligne médiane de la rangée
    if code:
        y = int((code[1] + 5) * px); x = int(code[0] * px)
        res["code_cell"] = mm(run(black[y], x, 1))
        # Lecture du motif : moyenne de chaque case (centre 6 × 6 mm)
        bits = ""
        for r in range(5):
            for c in range(5):
                cx = (code[0] + c * 10 + 5) * px; cy = (code[1] + r * 10 + 5) * px
                cell = black[int(cy - 3 * px):int(cy + 3 * px), int(cx - 3 * px):int(cx + 3 * px)]
                bits += "1" if cell.mean() > 0.5 else "0"
        res["code_bits"] = bits
    # Règle : run noir le plus long sur les lignes autour de y = 228 mm, entre x = 50 et 160
    best = 0
    for y in range(int(226 * px), int(231 * px)):
        line = black[y, int(50 * px):int(160 * px)]
        # plus long run de True
        n = cur = 0
        for v in line:
            cur = cur + 1 if v else 0
            best = max(best, cur)
    res["ruler"] = mm(best)
    return res


def check(res: dict) -> list[str]:
    errors = []
    def cmp(key, nominal, label):
        v = res.get(key)
        if v is None:
            errors.append(f"{label} : non mesurable"); return
        d = v - nominal
        flag = "OK" if abs(d) <= TOL_MM else "ÉCART"
        print(f"  {label:<44} {v:8.3f} mm  (nominal {nominal:7.3f}, écart {d:+.3f})  {flag}")
        if abs(d) > TOL_MM: errors.append(f"{label} : {v} mm au lieu de {nominal}")
    cmp("page_mm_w", A4_MM[0], "Page largeur") if "page_mm_w" in res else None
    res["page_mm_w"], res["page_mm_h"] = res["page_mm"]
    cmp("page_mm_w", A4_MM[0], "Page, largeur"); cmp("page_mm_h", A4_MM[1], "Page, hauteur")
    cmp("frame_left", NOMINAL["frame_left"], "Cadre, marge gauche"); cmp("frame_top", NOMINAL["frame_top"], "Cadre, marge haute")
    cmp("frame_outer_w", NOMINAL["frame_outer_w"], "Cadre, largeur extérieure"); cmp("frame_outer_h", NOMINAL["frame_outer_h"], "Cadre, hauteur extérieure")
    for side in ("left", "right", "top", "bottom"):
        cmp(f"frame_thickness_{side}", NOMINAL["frame_thickness"], f"Cadre, épaisseur {side}")
    cmp("marker", NOMINAL["marker"], "Repères, côté / diamètre (moyenne)")
    cmp("marker_inset_from_inner_edge", NOMINAL["marker_inset_from_inner_edge"], "Repère TL, retrait du bord intérieur")
    cmp("code_size", NOMINAL["code_size"], "Code, côté"); cmp("code_cell", NOMINAL["code_cell"], "Code, case (1re case noire)")
    cmp("ruler", NOMINAL["ruler"], "Règle de contrôle")
    if res.get("code_bits") and res["code_bits"] != "1011001001110100010110111":
        errors.append(f"Motif du code lu : {res['code_bits']}")
    else:
        print(f"  {'Code, motif lu':<44} {res.get('code_bits')}  OK")
    return errors


def main():
    args = sys.argv[1:]
    dpi = int(args[args.index("--dpi") + 1]) if "--dpi" in args else 300
    asyncio.run(render_pdf())
    size = os.path.getsize(OUT)
    print(f"PDF : {os.path.relpath(OUT, ROOT)} ({size / 1024:.1f} Ko)")
    if shutil.which("pdfinfo"):
        info = subprocess.run(["pdfinfo", OUT], capture_output=True, text=True).stdout
        for line in info.splitlines():
            if line.startswith(("Page size", "Pages")): print(" ", line.strip())
    if "--no-check" in args:
        return 0
    img, method = rasterize(dpi)
    if img is None:
        print("Aucun rasteriseur : capture Playwright à échelle connue")
        shot = asyncio.run(render_pdf(dpi_shot=dpi))
        import numpy as np
        from PIL import Image
        img = np.array(Image.open(shot).convert("L")); method = f"capture Playwright {dpi} dpi"
    print(f"Vérification ({method}) :")
    res = measure(img, dpi); res["raster"] = method
    errors = check(res)
    res["tolerance_mm"] = TOL_MM; res["ok"] = not errors; res["errors"] = errors
    res["nominal_mm"] = NOMINAL
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("Rapport :", os.path.relpath(REPORT, ROOT))
    if errors:
        print("ÉCHEC :", "; ".join(errors)); return 1
    print(f"Toutes les cotes sont dans ± {TOL_MM} mm.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
