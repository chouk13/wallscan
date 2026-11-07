"""Contrôle des coutures : pour chaque motif tuilé, mosaïque 2×2 à l'échelle native (256 px), crop centré sur le croisement.
Usage : python3 scripts/patterns-seams.py [dossier_sortie]
"""
import asyncio, sys, os, re, subprocess, json
from playwright.async_api import async_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/patterns-seams"
JS = """
const fs=require('fs');const vm=require('vm');
const src=fs.readFileSync(process.argv[1],'utf8');const ctx={};vm.createContext(ctx);
vm.runInContext(src+"\\nthis.svgTile=svgTile;this.isPano=isPano;",ctx);
const ref=fs.readFileSync(process.argv[2],'utf8');
const cat=[...ref.matchAll(/^\\s*(\\{sku:"(?:CAS|ELI|DOM)-[^\\n]*\\}),?\\s*$/gm)].map(m=>vm.runInNewContext('('+m[1]+')'));
// Références de test des nouvelles clés tuilées (mêmes couleurs que scripts/patterns-check.mjs).
cat.push({sku:"TEST-GRASS",pat:"grasscloth",c1:"#E6DCC6",c2:"#9C8B66",w:91,l:732,rep:0,match:"free",off:0,unit:"roll"},
 {sku:"TEST-RELIEF",pat:"relief",c1:"#EDE6DA",c2:"#CFC4B3",w:70,l:1005,rep:0,match:"free",off:0,unit:"roll"},
 {sku:"TEST-FLORAL",pat:"floral",c1:"#6F9FBF",c2:"#E7C45A",w:70,l:1005,rep:64,match:"half_drop",off:32,unit:"roll"},
 {sku:"TEST-WAVES",pat:"waves",c1:"#8E5A3C",c2:"#D9A070",w:70,l:1005,rep:0,match:"free",off:0,unit:"roll"});
const out={};for(const p of cat)if(!ctx.isPano(p))out[p.sku]=ctx.svgTile(p);
process.stdout.write(JSON.stringify(out));
"""
async def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = json.loads(subprocess.check_output(["node", "-e", JS, os.path.join(ROOT, "apps/web/public/prototype/patterns.js"), os.path.join(ROOT, "docs/design/index-v2-reference.html")]))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 560, "height": 560}, device_scale_factor=2)
        for sku, uri in tiles.items():
            await pg.set_content(f"<body style='margin:0;background:#222'><div style='width:512px;height:512px;margin:24px;background-image:url(\"{uri}\");background-size:256px 256px'></div></body>")
            await pg.wait_for_timeout(200)
            # crop 160×160 centré sur le croisement (24+256, 24+256)
            await pg.screenshot(path=f"{OUT}/{sku}.png", clip={"x": 200, "y": 200, "width": 160, "height": 160})
        await b.close()
    print("ok", list(tiles))
asyncio.run(main())
