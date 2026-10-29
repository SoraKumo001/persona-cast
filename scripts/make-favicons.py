# public/ のファビコン (PNG / ICO) を生成する。public/favicon.svg と同じ図形を描く。
# 使い方: python scripts/make-favicons.py public
from PIL import Image, ImageDraw
import struct, io, sys

S = 8  # supersampling

def render(n, rounded=True):
    N = n * S
    u = N / 32.0

    # 1. Gradient background (Fast via 64x64 bilinear upscale)
    c_start = (67, 56, 202)   # #4338CA
    c_mid   = (99, 102, 241)  # #6366F1
    c_end   = (139, 92, 246)  # #8B5CF6

    GW, GH = 64, 64
    small_grad = Image.new("RGB", (GW, GH))
    sg_d = ImageDraw.Draw(small_grad)
    for y in range(GH):
        for x in range(GW):
            t = (x + y) / (float(GW + GH - 2))
            if t < 0.45:
                st = t / 0.45
                r = int(c_start[0] + (c_mid[0] - c_start[0]) * st)
                g = int(c_start[1] + (c_mid[1] - c_start[1]) * st)
                b = int(c_start[2] + (c_mid[2] - c_start[2]) * st)
            else:
                st = (t - 0.45) / 0.55
                r = int(c_mid[0] + (c_end[0] - c_mid[0]) * st)
                g = int(c_mid[1] + (c_end[1] - c_mid[1]) * st)
                b = int(c_mid[2] + (c_end[2] - c_mid[2]) * st)
            sg_d.point((x, y), fill=(r, g, b))

    grad = small_grad.resize((N, N), Image.BILINEAR).convert("RGBA")

    # Mask for rounded corners
    mask = Image.new("L", (N, N), 0)
    mask_d = ImageDraw.Draw(mask)
    radius = int(7.5 * u) if rounded else 0
    if rounded:
        mask_d.rounded_rectangle([0, 0, N - 1, N - 1], radius=radius, fill=255)
    else:
        mask_d.rectangle([0, 0, N - 1, N - 1], fill=255)

    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)

    # Subtle inner border
    if rounded:
        bw = max(1, int(round(1.0 * u)))
        d.rounded_rectangle(
            [bw // 2, bw // 2, N - 1 - bw // 2, N - 1 - bw // 2],
            radius=max(1, radius - bw // 2),
            outline=(255, 255, 255, 56),
            width=bw
        )

    # Voice waves helper
    def draw_vbar(x_center, y_top, y_bottom, width, alpha):
        xc = x_center * u
        yt = y_top * u
        yb = y_bottom * u
        w = width * u
        r = w / 2.0
        d.rounded_rectangle([xc - r, yt, xc + r, yb], radius=r, fill=(255, 255, 255, alpha))

    # Voice waves
    draw_vbar(4.5, 13.0, 17.0, 2.0, int(255 * 0.75))
    draw_vbar(8.0, 10.0, 20.0, 2.0, int(255 * 0.90))
    draw_vbar(24.0, 10.0, 20.0, 2.0, int(255 * 0.90))
    draw_vbar(27.5, 13.0, 17.0, 2.0, int(255 * 0.75))

    # Mic capsule
    c_x1 = 13.5 * u
    c_y1 = 6.5 * u
    c_x2 = 18.5 * u
    c_y2 = 16.5 * u
    c_r = 2.5 * u
    d.rounded_rectangle([c_x1, c_y1, c_x2, c_y2], radius=c_r, fill=(255, 255, 255, 255))

    # Grille slit
    slit_y = 11.5 * u
    slit_h = max(1, int(round(0.8 * u)))
    d.rectangle([c_x1, slit_y, c_x2, slit_y + slit_h], fill=(99, 102, 241, 220))

    # Mic cradle (U-arc)
    sw = 2.2 * u
    cx = 16.0 * u
    cy = 14.0 * u
    arc_r = 5.0 * u
    d.arc(
        [cx - arc_r - sw / 2, cy - arc_r - sw / 2, cx + arc_r + sw / 2, cy + arc_r + sw / 2],
        0, 180, fill=(255, 255, 255, 255), width=int(round(sw))
    )
    # Cradle vertical arms & rounded caps
    d.line([(11.0 * u, 12.5 * u), (11.0 * u, 14.0 * u)], fill=(255, 255, 255, 255), width=int(round(sw)))
    d.line([(21.0 * u, 12.5 * u), (21.0 * u, 14.0 * u)], fill=(255, 255, 255, 255), width=int(round(sw)))
    for px, py in [(11.0 * u, 12.5 * u), (21.0 * u, 12.5 * u)]:
        d.ellipse([px - sw / 2, py - sw / 2, px + sw / 2, py + sw / 2], fill=(255, 255, 255, 255))

    # Stand stem
    d.line([(16.0 * u, 19.0 * u), (16.0 * u, 23.0 * u)], fill=(255, 255, 255, 255), width=int(round(sw)))

    # Stand base
    d.line([(13.0 * u, 23.5 * u), (19.0 * u, 23.5 * u)], fill=(255, 255, 255, 255), width=int(round(sw)))
    for px, py in [(13.0 * u, 23.5 * u), (19.0 * u, 23.5 * u)]:
        d.ellipse([px - sw / 2, py - sw / 2, px + sw / 2, py + sw / 2], fill=(255, 255, 255, 255))

    return img.resize((n, n), Image.LANCZOS)

out = sys.argv[1]
render(32).save(f"{out}/favicon-32.png", optimize=True)
render(180, rounded=False).save(f"{out}/apple-touch-icon.png", optimize=True)

# ICO: 16/32/48 を PNG で格納
sizes = [16, 32, 48]
pngs = []
for s in sizes:
    b = io.BytesIO()
    render(s).save(b, "PNG", optimize=True)
    pngs.append(b.getvalue())

header = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
entries = b""
for s, data in zip(sizes, pngs):
    entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(f"{out}/favicon.ico", "wb").write(header + entries + b"".join(pngs))
print(f"Generated favicons in {out}")
