"""Held-out scenes for the screen ViT.

These compositions are not in synth.LAYOUTS. Thresholds are chosen on the training
distribution before this file is evaluated, and it is not imported by train.py.
"""

from __future__ import annotations

import numpy as np
from PIL import ImageDraw

from synth import H, W, Scene, digits, draw_button, draw_face, draw_input, draw_signature, font, name, new_canvas, push, rgb, value_line


def cheque(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    draw.rectangle((40, 70, w - 40, h - 70), fill="#f7f1dc", outline="#c2b48a", width=3)
    draw.text((70, 90), "STATE BANK  —  CHEQUE", font=font(rng, 20), fill="#163")
    push(boxes, "TEXT", value_line(draw, rng, 70, 150, "Pay ", name(rng), 22))
    draw.text((70, 200), f"Rupees {int(rng.integers(500, 20000))} only", font=font(rng, 16), fill="#333")
    push(boxes, "TEXT", value_line(draw, rng, 70, 250, "A/c ", digits(rng, (4, 4, 4)), 18))
    draw.text((70, 310), "012345 678901 234 567890", font=font(rng, 14), fill="#666")
    push(boxes, "SIGNATURE", draw_signature(draw, rng, w - 320, h - 180, 200, 50))
    return boxes


def passport(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    x, y, cw, ch = 80.0, 50.0, w - 160.0, h - 100.0
    draw.rounded_rectangle((x, y, x + cw, y + ch), radius=10, fill="#10243f", outline="#d4af37", width=4)
    push(boxes, "ID_DOCUMENT", (x, y, cw, ch))
    draw.text((x + 24, y + 16), "REPUBLIC / PASSPORT", font=font(rng, 18), fill="#f0e2b0")
    draw_face(draw, rng, x + 28, y + 60, 120, 150)
    push(boxes, "FACE", (x + 28, y + 60, 120, 150))
    light = "#f4f1e8"
    push(boxes, "TEXT", value_line(draw, rng, x + 180, y + 70, "", name(rng), 22, light))
    push(boxes, "TEXT", value_line(draw, rng, x + 180, y + 120, "", f"{int(rng.integers(1, 28)):02d} Jan 19{int(rng.integers(60, 99))}", 18, light))
    push(boxes, "TEXT", value_line(draw, rng, x + 180, y + 170, "", f"P{int(rng.integers(1000000, 9999999))}", 20, light))
    draw.text((x + 24, y + ch - 46), "P<IND<<SYNTHETIC<<SPECIMEN<<<<<<<<<<<<", font=font(rng, 16), fill="#d4af37")
    return boxes


def two_cards(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    for i, fill in enumerate(("#fff", "#f3f7ff")):
        x, y, cw, ch = 40 + i * (w // 2 - 10), 80.0, w // 2 - 70, 360.0
        draw.rounded_rectangle((x, y, x + cw, y + ch), radius=8, fill=fill, outline="#999", width=2)
        push(boxes, "ID_DOCUMENT", (x, y, cw, ch))
        draw.rectangle((x, y, x + cw, y + 28), fill=rgb(rng, 30, 120))
        draw_face(draw, rng, x + 16, y + 48, 80, 100)
        push(boxes, "FACE", (x + 16, y + 48, 80, 100))
        push(boxes, "TEXT", value_line(draw, rng, x + 110, y + 56, "", name(rng), 16))
        push(boxes, "TEXT", value_line(draw, rng, x + 110, y + 100, "", digits(rng), 16))
    return boxes


def tablet(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    draw.rectangle((0, 0, w, h), fill="#2b2b2b")
    draw.rounded_rectangle((140, 50, w - 140, h - 40), radius=16, fill="#f4f4f4")
    draw.text((170, 70), "Sign inside the box", font=font(rng, 18), fill="#333")
    pad = (180, 120, w - 180, h - 120)
    draw.rectangle(pad, outline="#111", width=2)
    push(boxes, "SIGNATURE", draw_signature(draw, rng, pad[0] + 20, pad[1] + 30, pad[2] - pad[0] - 40, pad[3] - pad[1] - 50))
    draw_button(draw, rng, 180, h - 100, 120, 36, "Clear")
    push(boxes, "BUTTON", (180, h - 100, 120, 36))
    draw_button(draw, rng, 320, h - 100, 120, 36, "Save")
    push(boxes, "BUTTON", (320, h - 100, 120, 36))
    return boxes


def shipping_label(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    draw.rectangle((180, 40, w - 180, h - 40), fill="white", outline="#222", width=3)
    draw.text((210, 60), "SHIP TO", font=font(rng, 14), fill="#888")
    y = 100.0
    push(boxes, "TEXT", value_line(draw, rng, 210, y, "", name(rng), 22))
    for line in (f"{int(rng.integers(1, 90))} Station Road", "Near the post office", digits(rng, (3, 3))):
        y += 34
        push(boxes, "TEXT", value_line(draw, rng, 210, y, "", line, 18))
    # Decorative blocks that are not labels: a hard negative for the detector.
    draw.rectangle((210, h - 180, 360, h - 80), fill="black")
    for i in range(12):
        if i % 2 == 0:
            draw.rectangle((380 + i * 10, h - 180, 386 + i * 10, h - 80), fill="black")
    return boxes


def banner(rng: np.random.Generator, draw: ImageDraw.ImageDraw, w: int, h: int) -> list:
    boxes: list = []
    draw.rectangle((0, 0, w, 52), fill="#0b3d91")
    draw.text((20, 16), "Account services", font=font(rng, 18), fill="white")
    draw.rectangle((40, 90, w - 40, 170), fill="#fff4f4", outline="#c0392b", width=2)
    push(boxes, "TEXT", value_line(draw, rng, 60, 112, "Linked number ", digits(rng), 22))
    draw_input(draw, 60, 210, 420, 34)
    push(boxes, "INPUT", (60, 210, 420, 34))
    draw_button(draw, rng, 60, 270, 160, 38, "Dismiss")
    push(boxes, "BUTTON", (60, 270, 160, 38))
    draw.text((60, 340), "Reference 184920 — ticket, not an identity number", font=font(rng, 15), fill="#555")
    return boxes


SCENES = (cheque, passport, two_cards, tablet, shipping_label, banner)


def sample(rng: np.random.Generator, w: int = W, h: int = H) -> Scene:
    img, draw = new_canvas(rng, w, h)
    fn = SCENES[int(rng.integers(0, len(SCENES)))]
    boxes = fn(rng, draw, w, h)
    kept = []
    for cls, x, y, bw, bh in boxes:
        x, y = max(0.0, x), max(0.0, y)
        bw, bh = min(bw, img.width - x), min(bh, img.height - y)
        if bw >= 8 and bh >= 8:
            kept.append((cls, x, y, bw, bh))
    return Scene(img, kept)
