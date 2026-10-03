from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Protocol

import httpx


class Provider(Protocol):
    model: str

    async def complete(self, messages: list[dict], req: object | None = None) -> str: ...


class VLLMProvider:
    """Any OpenAI-compatible chat endpoint; in deployment, a local `vllm serve microsoft/Fara1.5-4B`."""

    def __init__(self, base_url: str, model: str, api_key: str = "EMPTY", timeout_s: float = 120.0, max_tokens: int = 2048):
        self.model = model
        self._max_tokens = max_tokens
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout_s,
        )

    async def complete(self, messages: list[dict], req: object | None = None) -> str:
        r = await self._client.post(
            "/chat/completions",
            json={"model": self.model, "messages": messages, "temperature": 0.0, "max_tokens": self._max_tokens},
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"] or ""

    async def aclose(self) -> None:
        await self._client.aclose()


def tool_call(thoughts: str, **arguments: object) -> str:
    return f"{thoughts}\n<tool_call>\n{json.dumps({'name': 'computer_use', 'arguments': arguments})}\n</tool_call>"


# demo/portal/index.html: <main> is max-width 1040px, centered. Offsets are from
# the left edge of <main>; y is from the viewport top (header is full-width).
_MAIN_W = 1040.0
_PORTAL_FIELDS = (
    ("PERSON", 116.5, 231.0),
    ("DOB", 373.5, 231.0),
    ("AADHAAR", 116.5, 304.7),
    ("PHONE", 373.5, 304.7),
    ("EMAIL", 116.5, 378.4),
    ("PAN", 373.5, 378.4),
    ("ADDRESS", 245.0, 452.1),
    ("IFSC", 116.5, 525.8),
    ("BANK_ACCOUNT", 373.5, 525.8),
)
_PORTAL_SUBMIT = (78.1, 587.0)


def _fara(x: float, y: float, vw: float, vh: float) -> list[int]:
    return [max(0, min(1000, round(x / vw * 1000))), max(0, min(1000, round(y / vh * 1000)))]


_SLOT = re.compile(r"(field|button) ([A-Z][A-Z0-9_]*) (empty|filled) (\d+),(\d+)")


def _latest_slots(req: object) -> list[tuple[str, str, bool, int, int]]:
    obs = getattr(req, "observations", None) or []
    if not obs:
        return []
    text = getattr(obs[-1], "text_observation", "") or ""
    return [(m.group(1), m.group(2), m.group(3) == "empty", int(m.group(4)), int(m.group(5))) for m in _SLOT.finditer(text)]


def _fill_from_slots(req: object, vw: float, vh: float) -> list[str] | None:
    """Click each empty field the page reported, type the matching placeholder, then submit if asked."""
    slots = _latest_slots(req)
    if not slots:
        return None
    by_cls: dict[str, str] = {}
    for entry in getattr(req, "legend", None) or []:
        by_cls.setdefault(str(entry.cls), str(entry.token))
    fields = [(cls, x, y) for role, cls, empty, x, y in slots if role == "field" and empty and cls in by_cls]
    fields.sort(key=lambda t: (t[2], t[1]))
    if not fields:
        return None
    steps: list[str] = []
    for cls, x, y in fields:
        label = cls.lower().replace("_", " ")
        steps.append(tool_call(f"Focus the {label} field.", action="left_click", coordinate=_fara(x, y, vw, vh)))
        steps.append(tool_call("Type the placeholder.", action="type", text=by_cls[cls]))
    instruction = (getattr(req, "instruction", "") or "").lower()
    if any(word in instruction for word in ("submit", "fill", "send", "apply")):
        for role, cls, _empty, x, y in slots:
            if role == "button" and cls == "SUBMIT":
                steps.append(tool_call("Submit.", action="left_click", coordinate=_fara(x, y, vw, vh)))
                break
    steps.append(tool_call("The fields from the task are filled.", action="terminate", answer="Filled the form."))
    return steps


def _portal_xy(vw: float, ox: float, y: float) -> tuple[float, float]:
    main_left = max(0.0, (vw - _MAIN_W) / 2.0)
    return main_left + ox, y


def _portal_steps(legend: list, vw: float, vh: float) -> list[str]:
    by_cls: dict[str, str] = {}
    for entry in legend:
        by_cls.setdefault(str(entry.cls), str(entry.token))
    steps: list[str] = []
    for cls, ox, y in _PORTAL_FIELDS:
        token = by_cls.get(cls)
        if not token:
            continue
        text = f"{token} {by_cls['PINCODE']}" if cls == "ADDRESS" and by_cls.get("PINCODE") else token
        x, cy = _portal_xy(vw, ox, y)
        label = cls.lower().replace("_", " ")
        steps.append(tool_call(f"Focus the {label} field.", action="left_click", coordinate=_fara(x, cy, vw, vh)))
        steps.append(tool_call("Type the placeholder; the browser will substitute the real value.", action="type", text=text))
    sx, sy = _portal_xy(vw, _PORTAL_SUBMIT[0], _PORTAL_SUBMIT[1])
    steps.append(tool_call("Submit the application.", action="left_click", coordinate=_fara(sx, sy, vw, vh)))
    steps.append(tool_call("The form is filled.", action="terminate", answer="Submitted the scholarship application."))
    return steps


class FakeProvider:
    """Deterministic stand-in for tests and GPU-less demos.

    Scholarship-portal instructions walk every field in the demo form, then submit.
    Anything else clicks once, types the first placeholder, and stops.
    """

    model = "fake"

    def __init__(self, script: list[str] | Callable[[list[dict]], str] | None = None):
        self._script = script
        self.calls: list[list[dict]] = []

    async def complete(self, messages: list[dict], req: object | None = None) -> str:
        self.calls.append(messages)
        if callable(self._script):
            return self._script(messages)
        if self._script:
            return self._script[min(len(self.calls), len(self._script)) - 1]
        n_assistant = sum(1 for m in messages if m["role"] == "assistant")
        instruction = getattr(req, "instruction", "") or ""
        vp = getattr(req, "viewport", None)
        vw = float(getattr(vp, "width", 1440) or 1440)
        vh = float(getattr(vp, "height", 900) or 900)
        slotted = _fill_from_slots(req, vw, vh)
        if slotted:
            return slotted[min(n_assistant, len(slotted) - 1)]
        if "scholarship" in instruction.lower() and getattr(req, "legend", None):
            vp = getattr(req, "viewport", None)
            vw = float(getattr(vp, "width", 1440) or 1440)
            vh = float(getattr(vp, "height", 900) or 900)
            steps = _portal_steps(req.legend, vw, vh)
            return steps[min(n_assistant, len(steps) - 1)]
        task = next(p["text"] for p in messages[1]["content"] if p["type"] == "text")
        if n_assistant == 0:
            return tool_call("I will focus the first field.", action="left_click", coordinate=[500, 300])
        if n_assistant == 1 and "[" in task:
            token = task[task.index("[") : task.index("]") + 1]
            return tool_call("I will enter the value the user gave.", action="type", text=token)
        return tool_call("Done.", action="terminate", answer="finished")
