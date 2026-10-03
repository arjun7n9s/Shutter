"""Server-side check that request text really was redacted on the client.

This is defence in depth, not the privacy boundary: the client must never send raw values.
A hit rejects the request and is counted, so a client-side regression shows up in tests
and metrics instead of silently reaching the model.
"""

from __future__ import annotations

import re

_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6),
    (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8),
    (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2),
    (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4),
    (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2),
    (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0),
    (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5),
    (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def verhoeff_valid(num: str) -> bool:
    c = 0
    for i, ch in enumerate(reversed(num)):
        c = _D[c][_P[i % 8][int(ch)]]
    return c == 0


def luhn_valid(num: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(num)):
        d = int(ch)
        if i % 2:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_AADHAAR = re.compile(r"(?<![\d-])[2-9]\d{3}([ -]?)\d{4}\1\d{4}(?![\d-])")
_CARD = re.compile(r"(?<![\d-])[2-6](?:[ -]?\d){12,18}(?![\d-])")
_PAN = re.compile(r"(?<![A-Z0-9])[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z](?![A-Z0-9])")
_PHONE = re.compile(r"(?<![\d+])(?:(?:\+|00)?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)")
_UPI = re.compile(r"(?<![\w.@-])[\w.-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w.@-])")
_GSTIN = re.compile(r"(?<![A-Z0-9])\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Z0-9])")
_SECRET = re.compile(
    r"eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|(?<![A-Za-z0-9])(?:AKIA[0-9A-Z]{16}|sk-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{36}"
    r"|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,})"
)


def find_leaks(text: str) -> list[str]:
    hits: list[str] = []
    if _EMAIL.search(text):
        hits.append("EMAIL")
    elif _UPI.search(text):
        hits.append("UPI")
    if _GSTIN.search(text):
        hits.append("GSTIN")
    if _SECRET.search(text):
        hits.append("SECRET")
    if any(verhoeff_valid(re.sub(r"\D", "", m.group(0))) for m in _AADHAAR.finditer(text)):
        hits.append("AADHAAR")
    if any(luhn_valid(re.sub(r"\D", "", m.group(0))) for m in _CARD.finditer(text)):
        hits.append("CARD")
    if _PAN.search(text):
        hits.append("PAN")
    if _PHONE.search(text):
        hits.append("PHONE")
    return hits
