#!/usr/bin/env python3
"""tools/og-image.py: generates backend/og-image.png (1200x627) for link previews.

Deterministic for a given version.json (no timestamps). Requires Pillow (pip install pillow) and the
DejaVu fonts (present on most Linux images; on macOS: brew install --cask font-dejavu, or set FONT_DIR).
Run from the repo root: python3 tools/og-image.py
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = json.load(open(os.path.join(ROOT, "version.json")))["version"]
FONT_DIR = os.environ.get("FONT_DIR", "/usr/share/fonts/truetype/dejavu")
W, H = 1200, 627
ink = (15, 23, 42); white = (255, 255, 255); accent = (37, 99, 235); soft = (238, 243, 255)
green = (15, 157, 110); greensoft = (231, 248, 240); botbg = (241, 244, 249)
muted = (148, 163, 184); light = (203, 213, 225); lblue = (147, 197, 253); top = (26, 36, 62)

def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)

img = Image.new("RGB", (W, H), ink); d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (ink[i] - top[i]) * t) for i in range(3)))
tw = lambda s, f: d.textlength(s, font=f)
cx, cy, s = 76, 78, 16
d.polygon([(cx, cy - s), (cx + 5, cy - 5), (cx + s, cy), (cx + 5, cy + 5), (cx, cy + s), (cx - 5, cy + 5), (cx - s, cy), (cx - 5, cy - 5)], fill=(96, 165, 250))
d.text((104, 58), "GROUNDED", font=font(30, True), fill=white)
gw = tw("GROUNDED", font(30, True))
d.text((104 + gw + 18, 66), "· live portfolio demonstration · v" + VERSION, font=font(22), fill=muted)
d.text((64, 150), "Provable ", font=font(62, True), fill=white)
d.text((64 + tw("Provable ", font(62, True)), 150), "RAG.", font=font(62, True), fill=(96, 165, 250))
d.text((64, 236), "Retrieval you can watch.", font=font(29), fill=light)
d.text((64, 276), "Answers you can verify.", font=font(29), fill=light)
by = 348
for line in ["Hybrid retrieval: semantic + keyword (RRF)", "Live Retrieval X-ray with ranking scores", "Tested page: every finding gated"]:
    d.ellipse([66, by + 10, 78, by + 22], fill=(96, 165, 250)); d.text((94, by), line, font=font(24), fill=light); by += 44
d.text((64, 540), "nimbus-ai-demos.vercel.app", font=font(30, True), fill=lblue)
d.text((64 + tw("nimbus-ai-demos.vercel.app", font(30, True)) + 16, 546), "· live · no login", font=font(24), fill=muted)
cx0, cy0, cx1, cy1 = 676, 96, 1146, 540
d.rounded_rectangle([cx0, cy0, cx1, cy1], 24, fill=white); pad = 26
ut = "What's your refund policy?"; uf = font(25, True); uw = tw(ut, uf) + 40
d.rounded_rectangle([cx1 - pad - uw, cy0 + pad, cx1 - pad, cy0 + pad + 52], 16, fill=accent)
d.text((cx1 - pad - uw + 20, cy0 + pad + 13), ut, font=uf, fill=white)
bx0 = cx0 + pad; bx1 = cx1 - pad; byy = cy0 + pad + 76
d.rounded_rectangle([bx0, byy, bx1, byy + 118], 16, fill=botbg)
d.text((bx0 + 20, byy + 20), "Paid plans (Pro & Business) are", font=font(25), fill=ink)
seg = "refundable within 14 days "; d.text((bx0 + 20, byy + 58), seg, font=font(25), fill=ink)
d.text((bx0 + 20 + tw(seg, font(25)), byy + 58), "[1]", font=font(25, True), fill=accent)
gy = byy + 150; gt = "Grounded · 1 source"; gf = font(22, True)
d.rounded_rectangle([bx0, gy, bx0 + tw(gt, gf) + 56, gy + 44], 22, fill=greensoft)
d.ellipse([bx0 + 18, gy + 14, bx0 + 34, gy + 30], fill=green); d.text((bx0 + 44, gy + 9), gt, font=gf, fill=green)
sy = gy + 62; st = "1 · Billing & Refunds · 0.74 sem · +kw"; sf = font(18)
assert bx0 + tw(st, sf) + 36 <= cx1 - 20, "chip overflow"
d.rounded_rectangle([bx0, sy, bx0 + tw(st, sf) + 36, sy + 42], 21, fill=soft); d.text((bx0 + 18, sy + 11), st, font=sf, fill=accent)
d.text((bx0, cy1 - 46), "Click the citation: see the exact source.", font=font(21), fill=(91, 102, 119))
out = os.path.join(ROOT, "backend", "og-image.png")
img.save(out, optimize=False)
print("wrote", out, "for v" + VERSION)
