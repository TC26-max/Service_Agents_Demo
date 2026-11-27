#!/usr/bin/env python3
"""tools/fonts.py: rebuild the two self-hosted web fonts in backend/public/fonts/ (Phase 2, v3.3).

Sources (SIL Open Font License 1.1, no Reserved Font Names, license in backend/public/fonts/OFL.txt):
  @fontsource-variable/archivo 5.3.0         archivo-latin-standard-normal.woff2 (wght 100-900, wdth 62-125)
  @fontsource-variable/jetbrains-mono 5.3.0  jetbrains-mono-latin-wght-normal.woff2 (wght 100-800)

Run from the repo root:
  npm i --no-save @fontsource-variable/archivo@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
  pip install fonttools brotli
  python3 tools/fonts.py

Both fonts are cut to printable ASCII plus a few punctuation marks. Archivo keeps a slice of its two
axes (weight 600 to 800, width 75 to 100) for headings and the wordmark; JetBrains Mono is pinned to
weight 500 for scores and IDs. Characters outside the subset fall back to the system font.
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NM = os.path.join(ROOT, "node_modules", "@fontsource-variable")
OUT = os.path.join(ROOT, "backend", "public", "fonts")
CHARS = list(range(0x20, 0x7F)) + [0xA0, 0xB7, 0xD7, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026]


def build(src, dst, axes):
    font = TTFont(src)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "liga", "calt", "tnum", "lnum", "case", "zero"]
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.notdef_outline = True
    opts.hinting = False
    opts.desubroutinize = True
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=CHARS)
    sub.subset(font)
    font = instancer.instantiateVariableFont(font, axes)
    font.flavor = "woff2"
    font.save(dst)
    print(os.path.relpath(dst, ROOT), os.path.getsize(dst), "bytes")


os.makedirs(OUT, exist_ok=True)
build(os.path.join(NM, "archivo", "files", "archivo-latin-standard-normal.woff2"),
      os.path.join(OUT, "archivo-display.woff2"), {"wght": (600, 800), "wdth": (75, 100)})
build(os.path.join(NM, "jetbrains-mono", "files", "jetbrains-mono-latin-wght-normal.woff2"),
      os.path.join(OUT, "jetbrains-mono-500.woff2"), {"wght": 500})
