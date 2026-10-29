# public/ のファビコン (PNG / ICO) を生成する。public/favicon.svg と同じ図形を描く。
# 使い方: python scripts/make-favicons.py public   (Pillow が必要)
from PIL import Image, ImageDraw
import struct, io, sys

S = 16  # supersampling
TX, SC, SW = 2.8, 1.1, 2.1

def render(n, rounded=True):
    N = n * S
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = N / 32.0
    if rounded:
        d.rounded_rectangle([0, 0, N - 1, N - 1], radius=7 * u, fill=(99, 102, 241, 255))
    else:
        d.rectangle([0, 0, N, N], fill=(99, 102, 241, 255))
    def P(x, y):
        return ((TX + x * SC) * u, (TX + y * SC) * u)
    w = SW * SC * u
    white = (255, 255, 255, 255)
    def dot(x, y):
        px, py = P(x, y)
        d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=white)
    # capsule (outline): x 9..15, y 2..15
    x0, y0 = P(9, 2); x1, y1 = P(15, 15)
    d.rounded_rectangle([x0 - w / 2, y0 - w / 2, x1 + w / 2, y1 + w / 2], radius=3 * SC * u + w / 2, outline=white, width=int(round(w)))
    # U arc: center (12,12) r 7, lower half, plus short verticals
    cx, cy = P(12, 12); r = 7 * SC * u
    d.arc([cx - r - w / 2, cy - r - w / 2, cx + r + w / 2, cy + r + w / 2], 0, 180, fill=white, width=int(round(w)))
    ax, ay = P(19, 10); bx, by = P(19, 12)
    d.line([ax, ay, bx, by], fill=white, width=int(round(w))); dot(19, 10); dot(19, 12)
    ax, ay = P(5, 10); bx, by = P(5, 12)
    d.line([ax, ay, bx, by], fill=white, width=int(round(w))); dot(5, 10); dot(5, 12)
    # stem
    ax, ay = P(12, 19); bx, by = P(12, 22)
    d.line([ax, ay, bx, by], fill=white, width=int(round(w))); dot(12, 19); dot(12, 22)
    return img.resize((n, n), Image.LANCZOS)

out = sys.argv[1]
render(32).save(f"{out}/favicon-32.png", optimize=True)
render(180, rounded=False).save(f"{out}/apple-touch-icon.png", optimize=True)

# ICO: 16/32/48 を PNG で格納
sizes = [16, 32, 48]
pngs = []
for s in sizes:
    b = io.BytesIO(); render(s).save(b, "PNG", optimize=True); pngs.append(b.getvalue())
header = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries = b""
for s, data in zip(sizes, pngs):
    entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(f"{out}/favicon.ico", "wb").write(header + entries + b"".join(pngs))
