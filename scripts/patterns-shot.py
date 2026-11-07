"""Capture la page de contrôle des motifs (/tmp/patterns-check.html) en plusieurs images.
Usage : python3 scripts/patterns-shot.py [page.html] [dossier_sortie]
"""
import asyncio, sys, os
from playwright.async_api import async_playwright
HTML = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else "/tmp/patterns-check.html")
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/patterns-shots"
async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1500, "height": 900}, device_scale_factor=1)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto("file://" + HTML); await pg.wait_for_timeout(1200)
        secs = await pg.query_selector_all("section")
        for i, s in enumerate(secs):
            await s.scroll_into_view_if_needed(); await pg.wait_for_timeout(150)
            await s.screenshot(path=f"{OUT}/{i:02d}.png")
        print("sections:", len(secs), "errors:", errs or "none")
        await b.close()
asyncio.run(main())
