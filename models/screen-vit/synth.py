"""Synthetic screenshots for the screen ViT.

Scenes are full 16:10 frames, the same shape the browser captures, with boxes in pixels.
Training never imports heldout_scenes.py.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 800, 500
FONT_DIR = os.environ.get("WINDIR", r"C:\Windows") + r"\Fonts"
FONT_FILES = [
    "arial.ttf",
    "arialbd.ttf",
    "times.ttf",
    "calibri.ttf",
    "georgia.ttf",
    "verdana.ttf",
    "segoeui.ttf",
    "cour.ttf",
    "comic.ttf",
    "nirmala.ttf",
    "Nirmala.ttf",
]
GIVEN = ["Aarav", "Priya", "Rahul", "Kavya", "Imran", "Joseph", "Ananya", "Gurpreet", "Meera", "Farhan", "Divya", "Sana"]
SUR = ["Sharma", "Iyer", "Khan", "Menon", "Das", "Reddy", "Kaur", "D'Souza", "Banerjee", "Qureshi"]
DEV = ["अनीता शर्मा", "राहुल वर्मा", "प्रिया सिंह", "अमित कुमार"]
CITIES = ["Pune", "Kochi", "Ranchi", "Surat", "Mysuru", "Agartala"]
INK = ["#1a1a1a", "#1c2b4a", "#3b1d1d", "#102a43"]


@dataclass
class Scene:
    image: Image.Image
    boxes: list[tuple[str, float, float, float, float]]


_fonts: dict[tuple[str, int], ImageFont.FreeTypeFont | ImageFont.ImageFont] = {}


def font(rng: np.random.Generator, size: int) -> ImageFont.ImageFont:
    name = FONT_FILES[int(rng.integers(0, len(FONT_FILES)))]
    key = (name, size)
    if key not in _fonts:
        path = os.path.join(FONT_DIR, name)
        _fonts[key] = ImageFont.truetype(path, size) if os.path.exists(path) else ImageFont.load_default(size)
    return _fonts[key]


def rgb(rng: np.random.Generator, lo: int = 0, hi: int = 255) -> tuple[int, int, int]:
    return tuple(int(x) for x in rng.integers(lo, hi, size=3))


def name(rng: np.random.Generator) -> str:
    if rng.random() < 0.25:
        return DEV[int(rng.integers(0, len(DEV)))]
    return f"{GIVEN[int(rng.integers(0, len(GIVEN)))]} {SUR[int(rng.integers(0, len(SUR)))]}"


def digits(rng: np.random.Generator, groups: tuple[int, ...] = (4, 4, 4)) -> str:
    return " ".join("".join(str(int(d)) for d in rng.integers(0, 10, size=n)) for n in groups)


def new_canvas(rng: np.random.Generator, w: int = W, h: int = H) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    base = rgb(rng, 232, 248)
    img = Image.new("RGB", (w, h), base)
    arr = np.asarray(img).astype(np.int16)
    arr += rng.integers(-6, 7, size=arr.shape)
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    return img, ImageDraw.Draw(img)


def ink_box(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, fnt: ImageFont.ImageFont, fill: str) -> tuple[float, float, float, float]:
    draw.text(xy, text, font=fnt, fill=fill)
    x0, y0, x1, y1 = draw.textbbox(xy, text, font=fnt)
    return x0, y0, x1 - x0, y1 - y0


def draw_face(draw: ImageDraw.ImageDraw, rng: np.random.Generator, x: float, y: float, w: float, h: float) -> None:
    draw.rectangle((x, y, x + w, y + h), fill=rgb(rng, 210, 235))
    skin = rgb(rng, 140, 230)
    draw.ellipse((x + w * 0.22, y + h * 0.12, x + w * 0.78, y + h * 0.62), fill=skin)
    draw.polygon([(x + w * 0.2, y + h * 0.95), (x + w * 0.5, y + h * 0.48), (x + w * 0.8, y + h * 0.95)], fill=rgb(rng, 40, 120))
    draw.ellipse((x + w * 0.32, y + h * 0.32, x + w * 0.42, y + h * 0.4), fill="#222")
    draw.ellipse((x + w * 0.58, y + h * 0.32, x + w * 0.68, y + h * 0.4), fill="#222")


def draw_signature(draw: ImageDraw.ImageDraw, rng: np.random.Generator, x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
    color = INK[int(rng.integers(0, len(INK)))]
    pts: list[tuple[float, float]] = []
    cx, cy = x + 6, y + h * 0.65
    for _ in range(int(rng.integers(5, 9))):
        cx = min(x + w - 4, cx + float(rng.uniform(w * 0.08, w * 0.2)))
        cy = y + float(rng.uniform(h * 0.15, h * 0.85))
        pts.append((cx, cy))
    if len(pts) >= 2:
        draw.line(pts, fill=color, width=int(rng.integers(2, 4)))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs) - 3, min(ys) - 3, max(xs) - min(xs) + 8, max(ys) - min(ys) + 8


def draw_button(draw: ImageDraw.ImageDraw, rng: np.random.Generator, x: float, y: float, w: float, h: float, label: str) -> None:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=6, fill=rgb(rng, 20, 140))
    fnt = font(rng, max(12, int(h * 0.45)))
    tw = draw.textlength(label, font=fnt)
    draw.text((x + (w - tw) / 2, y + h * 0.22), label, font=fnt, fill="white")


def draw_input(draw: ImageDraw.ImageDraw, x: float, y: float, w: float, h: float) -> None:
    draw.rectangle((x, y, x + w, y + h), fill="white", outline="#8aa", width=2)


def value_line(
    draw: ImageDraw.ImageDraw,
    rng: np.random.Generator,
    x: float,
    y: float,
    prefix: str,
    value: str,
    size: int,
    fill: str | None = None,
) -> tuple[float, float, float, float]:
    fnt = font(rng, size)
    fill = fill or INK[int(rng.integers(0, len(INK)))]
    if prefix:
        draw.text((x, y), prefix, font=fnt, fill="#555")
        x += draw.textlength(prefix, font=fnt)
    return ink_box(draw, (x, y), value, fnt, fill)


def push(boxes: list[tuple[str, float, float, float, float]], cls: str, box: tuple[float, float, float, float]) -> None:
    x, y, w, h = box
    if w >= 8 and h >= 8:
        boxes.append((cls, x, y, w, h))


def layout_card(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list[tuple[str, float, float, float, float]]:
    boxes: list[tuple[str, float, float, float, float]] = []
    cw, ch = float(rng.integers(380, min(680, w - 40))), float(rng.integers(230, min(400, h - 50)))
    x, y = float(rng.integers(16, max(17, int(w - cw - 16)))), float(rng.integers(16, max(17, int(h - ch - 16))))
    draw.rounded_rectangle((x, y, x + cw, y + ch), radius=8, fill=rgb(rng, 245, 256), outline="#c8b48a", width=2)
    push(boxes, "ID_DOCUMENT", (x, y, cw, ch))
    bar = rgb(rng, 20, 130)
    if rng.random() < 0.5:
        draw.rectangle((x, y, x + cw, y + 36), fill=bar)
    else:
        draw.rectangle((x, y, x + 16, y + ch), fill=bar)
    photo_right = rng.random() < 0.5
    pw, ph = float(rng.integers(72, 110)), float(rng.integers(96, 140))
    px = x + cw - pw - 18 if photo_right else x + 24
    py = y + 52
    if py + ph < y + ch - 20:
        draw_face(draw, rng, px, py, pw, ph)
        push(boxes, "FACE", (px, py, pw, ph))
    tx = x + 28 if photo_right else x + pw + 40
    ty = y + 58
    for value, size in ((name(rng), 20), (digits(rng), 22), (f"{int(rng.integers(1, 28)):02d}/0{int(rng.integers(1, 9))}/19{int(rng.integers(60, 99))}", 16)):
        if ty > y + ch - 36:
            break
        push(boxes, "TEXT", value_line(draw, rng, tx, ty, "", value, size))
        ty += size + 14
    if rng.random() < 0.7:
        push(boxes, "SIGNATURE", draw_signature(draw, rng, x + 28, y + ch - 58, 160, 40))
    return boxes


def layout_form(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list[tuple[str, float, float, float, float]]:
    boxes: list[tuple[str, float, float, float, float]] = []
    x, y = float(rng.integers(24, 180)), float(rng.integers(36, 110))
    fnt = font(rng, 14)
    for label in rng.permutation(["Full name", "Mobile", "Email", "City", "Reference", "Remarks"])[: int(rng.integers(3, 6))]:
        draw.text((x, y), str(label), font=fnt, fill="#444")
        draw_input(draw, x + 150, y - 4, 280, 28)
        push(boxes, "INPUT", (x + 150, y - 4, 280, 28))
        if rng.random() < 0.55 and str(label) in ("Full name", "Mobile", "Email", "City"):
            value = name(rng) if str(label) == "Full name" else digits(rng, (5, 5)) if str(label) == "Mobile" else CITIES[int(rng.integers(0, len(CITIES)))]
            push(boxes, "TEXT", value_line(draw, rng, x + 160, y, "", value, 16))
        y += 48
        if y > h - 90:
            break
    draw_button(draw, rng, x, y, 140, 36, "Submit")
    push(boxes, "BUTTON", (x, y, 140, 36))
    if rng.random() < 0.5:
        draw_button(draw, rng, x + 160, y, 120, 36, "Back")
        push(boxes, "BUTTON", (x + 160, y, 120, 36))
    if rng.random() < 0.6:
        draw.text((x, min(y + 56, h - 50)), "Signature", font=fnt, fill="#444")
        push(boxes, "SIGNATURE", draw_signature(draw, rng, x + 150, min(y + 48, h - 54), 200, 42))
    return boxes


def layout_letter(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list[tuple[str, float, float, float, float]]:
    boxes: list[tuple[str, float, float, float, float]] = []
    left = float(rng.integers(40, 140))
    draw.rectangle((left - 20, 36, w - 50, h - 30), fill="white", outline="#ddd")
    y = float(rng.integers(48, 90))
    push(boxes, "TEXT", value_line(draw, rng, left, y, "To ", name(rng), 18))
    y += 36
    for line in (
        f"{int(rng.integers(1, 240))}, {CITIES[int(rng.integers(0, len(CITIES)))]} Road",
        CITIES[int(rng.integers(0, len(CITIES)))],
        digits(rng, (3, 3)),
    ):
        push(boxes, "TEXT", value_line(draw, rng, left, y, "", line, 16))
        y += 26
    body = font(rng, 15)
    for i in range(6):
        words = " ".join(f"word{int(rng.integers(10, 99))}" for _ in range(8))
        draw.text((left, y + i * 22), words, font=body, fill="#333")
    push(boxes, "SIGNATURE", draw_signature(draw, rng, left, h - 110, 180, 46))
    return boxes


def layout_toolbar(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list[tuple[str, float, float, float, float]]:
    boxes: list[tuple[str, float, float, float, float]] = []
    draw.rectangle((0, 0, w, 48), fill=rgb(rng, 20, 80))
    x, y0 = float(rng.integers(16, 80)), float(rng.integers(60, 120))
    for label in ("Home", "Services", "Pay", "Help"):
        draw_button(draw, rng, x, y0, 110, 34, label)
        push(boxes, "BUTTON", (x, y0, 110, 34))
        x += 130
    draw_input(draw, 24, y0 + 60, 360, 32)
    push(boxes, "INPUT", (24, y0 + 60, 360, 32))
    fnt = font(rng, 15)
    for i in range(8):
        draw.text((24, y0 + 110 + i * 28), f"Notice {int(rng.integers(1000, 9999))} — no personal data in this row", font=fnt, fill="#333")
    return boxes


def layout_article(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list[tuple[str, float, float, float, float]]:
    fnt = font(rng, 16)
    draw.text((40, 30), "District bulletin", font=font(rng, 28), fill="#222")
    for i in range(14):
        draw.text((40, 80 + i * 28), " ".join(f"item{int(rng.integers(0, 50))}" for _ in range(9)), font=fnt, fill="#333")
    return []


LAYOUTS = (layout_card, layout_form, layout_letter, layout_toolbar, layout_article)


def sample(rng: np.random.Generator, w: int = W, h: int = H) -> Scene:
    img, draw = new_canvas(rng, w, h)
    if rng.random() < 0.55:
        draw.rectangle((0, 0, w, 40), fill=rgb(rng, 10, 90))
        draw.text((16, 10), "Portal", font=font(rng, 16), fill="white")
    kind = int(rng.integers(0, 10))
    fn = layout_card if kind < 4 else layout_form if kind < 7 else layout_letter if kind < 8 else layout_toolbar if kind < 9 else layout_article
    boxes = fn(rng, draw, w, h)
    arr = np.asarray(img).astype(np.int16)
    arr += rng.integers(-5, 6, size=arr.shape)
    img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    kept = []
    for cls, x, y, bw, bh in boxes:
        x, y = max(0.0, x), max(0.0, y)
        bw, bh = min(bw, w - x), min(bh, h - y)
        if bw >= 8 and bh >= 8:
            kept.append((cls, x, y, bw, bh))
    return Scene(img, kept)
