#!/usr/bin/env python3
"""Scène synthétique « mur avec poutre » : mur 418 × 250 cm en perspective sténopé, poutre de 45 cm sur 260 cm à gauche,
feuille A4, plinthe 9 cm. Produit une image JPEG et un clip Y4M pour la caméra factice de Chrome
(FAKE_CAMERA_FILE=/tmp/beam.y4m scripts/proto-shots.py …). Usage : python3 scripts/make-beam-scene.py /tmp/beam-scene.jpg /tmp/beam.y4m"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out_jpg, out_y4m = (sys.argv + ["/tmp/beam-scene.jpg", "/tmp/beam.y4m"])[1:3]
W, H = 1280, 960
K = 3; fw, fh = 418 * K, 250 * K
flat = Image.new("RGB", (fw, fh), (205, 198, 188))
arr = np.array(flat).astype(np.int16); rng = np.random.default_rng(3); arr += rng.integers(-4, 5, arr.shape, dtype=np.int16)
flat = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)); d = ImageDraw.Draw(flat)
d.rectangle([0, 0, 260 * K, 45 * K], fill=(150, 142, 132)); d.line([0, 45 * K, 260 * K, 45 * K], fill=(90, 85, 80), width=4)
d.rectangle([200 * K, 100 * K, 221 * K, 129.7 * K], fill=(250, 250, 248))
d.rectangle([0, (250 - 9) * K, fw, fh], fill=(235, 232, 226)); d.line([0, (250 - 9) * K, fw, (250 - 9) * K], fill=(120, 115, 110), width=2)
Qp = [(125 * W / 1400, 102 * H / 1000), (1289 * W / 1400, 165 * H / 1000), (1285 * W / 1400, 812 * H / 1000), (129 * W / 1400, 874 * H / 1000)]
def coeffs(pa, pb):
    M = []
    for p1, p2 in zip(pa, pb):
        M.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]]); M.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    return np.linalg.solve(np.array(M, dtype=float), np.array(pb).reshape(8))
scene = Image.new("RGB", (W, H), (120, 112, 104)); dd = ImageDraw.Draw(scene)
dd.polygon([(0, 0), (W, 0), Qp[1], Qp[0]], fill=(232, 228, 222)); dd.polygon([Qp[3], Qp[2], (W, H), (0, H)], fill=(140, 105, 75))
dd.polygon([(0, 0), Qp[0], Qp[3], (0, H)], fill=(185, 178, 170)); dd.polygon([Qp[1], (W, 0), (W, H), Qp[2]], fill=(175, 168, 160))
wall = flat.transform((W, H), Image.PERSPECTIVE, tuple(coeffs(Qp, [(0, 0), (fw, 0), (fw, fh), (0, fh)])), Image.BICUBIC)
mask = Image.new("L", (W, H), 0); ImageDraw.Draw(mask).polygon(Qp, fill=255); scene.paste(wall, (0, 0), mask)
scene = scene.filter(ImageFilter.GaussianBlur(0.6)); scene.save(out_jpg, quality=92)
ycc = np.asarray(scene.convert("YCbCr")); Y, Cb, Cr = ycc[:, :, 0], ycc[:, :, 1], ycc[:, :, 2]
sub = lambda c: c.reshape(c.shape[0] // 2, 2, c.shape[1] // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
with open(out_y4m, "wb") as f:
    f.write(b"YUV4MPEG2 W1280 H960 F15:1 Ip A1:1 C420jpeg\n")
    for _ in range(30):
        f.write(b"FRAME\n"); f.write(Y.tobytes()); f.write(sub(Cb).tobytes()); f.write(sub(Cr).tobytes())
print(out_jpg, out_y4m)
