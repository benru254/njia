"""Draws the Njia app icons. Run:  python3 scripts/make-icons.py  (needs Pillow)."""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "assets")
BG = (16, 21, 28, 255)
AMBER = (255, 176, 32, 255)
GREEN = (31, 157, 85, 255)
WHITE = (255, 255, 255, 255)
SS = 4  # draw big, then shrink for smooth edges


def path_points(size, scale):
    """An S-shaped route from bottom-left to top-right, inside the safe middle area."""
    c = size / 2
    r = size * scale / 2
    pts = []
    for i in range(601):
        t = i / 600
        x = c - r + 2 * r * t
        y = c + r * 0.62 * math.cos(t * math.pi) * (0.55 + 0.45 * math.sin(t * math.pi * 2 + 0.6))
        pts.append((x, y))
    return pts


def draw(size, scale, bg, line, start, end, ring):
    big = size * SS
    img = Image.new("RGBA", (big, big), bg)
    d = ImageDraw.Draw(img)
    pts = path_points(big, scale)
    w = int(big * 0.062)
    # Stamp overlapping dots along the route: gives a perfectly smooth thick line.
    for x, y in pts:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=line)
    for (x, y), colour in ((pts[0], start), (pts[-1], end)):
        r = big * 0.075
        d.ellipse([x - r, y - r, x + r, y + r], fill=ring)
        r2 = r * 0.66
        d.ellipse([x - r2, y - r2, x + r2, y + r2], fill=colour)
    return img.resize((size, size), Image.LANCZOS)


draw(1024, 0.56, BG, AMBER, GREEN, AMBER, WHITE).save(os.path.join(OUT, "icon.png"))
# Adaptive icon: Android crops the outer part, so the drawing stays in the middle.
draw(1024, 0.40, (0, 0, 0, 0), AMBER, GREEN, AMBER, WHITE).save(os.path.join(OUT, "android-icon-foreground.png"))
draw(1024, 0.40, (0, 0, 0, 0), WHITE, WHITE, WHITE, WHITE).save(os.path.join(OUT, "android-icon-monochrome.png"))
draw(1024, 0.34, BG, AMBER, GREEN, AMBER, WHITE).save(os.path.join(OUT, "splash-icon.png"))
print("icons written")
