"""Builds Fara-1.5 conversations and maps its tool calls onto Parda's action allowlist.

Mirrors the message layout of microsoft/fara's Fara15Agent: system prompt, then the task
message with the first screenshot, then alternating assistant turns and screenshot
messages, keeping at most three screenshots.
"""

from __future__ import annotations

import ast
import json
import re
from typing import Any
from urllib.parse import quote_plus

from .fara_prompt import DISPLAY_SIZE, system_prompt
from .protocol import (
    Action,
    AskUser,
    Back,
    Click,
    Done,
    Hover,
    Key,
    Memorize,
    Navigate,
    ReadPage,
    Scroll,
    StepRequest,
    TypeText,
    Unsupported,
    Wait,
)

USER_MESSAGE = "Here is the next screenshot. Think about what to do next."
MAX_URL_LENGTH = 100
MAX_IMAGES = 3
MAX_OBSERVATION_CHARS = 1000

CLASS_NAMES = {
    "PERSON": "person name",
    "EMAIL": "email address",
    "PHONE": "phone number",
    "AADHAAR": "Aadhaar number",
    "AADHAAR_VID": "Aadhaar virtual ID",
    "PAN": "PAN",
    "GSTIN": "GSTIN",
    "IFSC": "IFSC code",
    "BANK_ACCOUNT": "bank account number",
    "CARD": "card number",
    "CARD_EXPIRY": "card expiry",
    "UPI": "UPI ID",
    "DOB": "date of birth",
    "ADDRESS": "address",
    "PINCODE": "PIN code",
    "PASSPORT": "passport number",
    "VOTER_ID": "voter ID",
    "DRIVING_LICENCE": "driving licence number",
    "USERNAME": "username",
    "IP_ADDRESS": "IP address",
}

KEY_MAP = {
    "alt": "Alt",
    "arrowdown": "ArrowDown",
    "arrowleft": "ArrowLeft",
    "arrowright": "ArrowRight",
    "arrowup": "ArrowUp",
    "down": "ArrowDown",
    "left": "ArrowLeft",
    "right": "ArrowRight",
    "up": "ArrowUp",
    "backspace": "Backspace",
    "cmd": "Meta",
    "ctrl": "Control",
    "control": "Control",
    "delete": "Delete",
    "end": "End",
    "enter": "Enter",
    "return": "Enter",
    "esc": "Escape",
    "escape": "Escape",
    "home": "Home",
    "pagedown": "PageDown",
    "pageup": "PageUp",
    "shift": "Shift",
    "space": " ",
    "tab": "Tab",
    "meta": "Meta",
}


def privacy_note(legend: list[tuple[str, str]]) -> str:
    """Appended to the task text, never to the system prompt, which must stay verbatim."""
    lines = [
        "Privacy note: personal details on the screen and in this task are shown as placeholders such as [EMAIL_1]. "
        "Each placeholder stands for a real value that the user has provided or that appears on the page, so treat it "
        "as information the user has given you. To enter such a value, type the placeholder exactly as shown and it "
        "will be filled in securely. Solid dark boxes hide content that cannot be shared.",
    ]
    if legend:
        described = ", ".join(f"{tok} ({CLASS_NAMES.get(cls, cls.lower().replace('_', ' '))})" for tok, cls in legend)
        lines.append(f"Placeholders in use: {described}.")
    return "\n".join(lines)


def trimmed_url(url: str) -> str:
    u = url.split("?", 1)[0]
    return u[:MAX_URL_LENGTH] + " ..." if len(u) > MAX_URL_LENGTH else u


def _image_part(b64: str) -> dict:
    mime = "image/jpeg" if b64.startswith("/9j/") else "image/png"
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}}


def _truncate(text: str) -> str:
    if len(text) <= MAX_OBSERVATION_CHARS:
        return text
    half = MAX_OBSERVATION_CHARS // 2
    return text[:half] + f"\n... [truncated {len(text) - MAX_OBSERVATION_CHARS} chars] ...\n" + text[-half:]


def build_messages(req: StepRequest, model: str) -> list[dict]:
    if len(req.assistant_turns) != len(req.observations) - 1:
        raise ValueError("need exactly one more observation than assistant turns")
    n = len(req.observations)
    keep_image = {i for i in range(n) if req.observations[i].screenshot}
    keep_image = set(sorted(keep_image)[-MAX_IMAGES:])
    if n - 1 not in keep_image:
        raise ValueError("the latest observation must carry a screenshot")

    legend = [(e.token, e.cls) for e in req.legend]
    task_text = req.instruction + "\n\n" + privacy_note(legend)

    msgs: list[dict] = [{"role": "system", "content": system_prompt(model)}]
    for i, obs in enumerate(req.observations):
        if i == 0:
            text = task_text
        else:
            url_prefix = f"Current URL: {trimmed_url(obs.url)}\n" if obs.url else ""
            if obs.user_response:
                text = url_prefix + obs.user_response
            elif obs.text_observation:
                text = f"{url_prefix}{_truncate(obs.text_observation)}\n{USER_MESSAGE}"
            else:
                text = url_prefix + USER_MESSAGE
        content: list[dict] = []
        if i in keep_image:
            content.append(_image_part(obs.screenshot or ""))
            content.append({"type": "text", "text": text})
            msgs.append({"role": "user", "content": content})
        elif i == 0 or obs.user_response:
            # Fara keeps the text of the original task and user replies when their screenshot is dropped.
            msgs.append({"role": "user", "content": [{"type": "text", "text": text}]})
        elif obs.text_observation:
            # read_page answers and refusals are information, not screenshots; keep them without the image cue.
            kept = f"{url_prefix}{_truncate(obs.text_observation)}"
            msgs.append({"role": "user", "content": [{"type": "text", "text": kept}]})
        if i < n - 1:
            msgs.append({"role": "assistant", "content": req.assistant_turns[i]})
    return msgs


_TOOL_CALL = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)


def parse_tool_call(message: str) -> tuple[str, dict[str, Any]]:
    m = _TOOL_CALL.search(message)
    if not m:
        raise ValueError("no <tool_call> block in model output")
    thoughts = message[: m.start()].strip()
    body = m.group(1)
    try:
        call = json.loads(body)
    except json.JSONDecodeError:
        call = ast.literal_eval(body)
    if not isinstance(call, dict) or call.get("name") != "computer_use":
        raise ValueError("tool call is not computer_use")
    args = call.get("arguments")
    if isinstance(args, str):
        args = json.loads(args)
    if not isinstance(args, dict) or "action" not in args:
        raise ValueError("tool call has no action")
    return thoughts, args


def _point(args: dict, vw: int, vh: int) -> tuple[float, float]:
    c = args.get("coordinate")
    if not (isinstance(c, (list, tuple)) and len(c) == 2):
        raise ValueError("missing coordinate")
    x, y = float(c[0]), float(c[1])
    if not (0 <= x <= DISPLAY_SIZE and 0 <= y <= DISPLAY_SIZE):
        raise ValueError("coordinate outside the display space")
    return x * vw / DISPLAY_SIZE, y * vh / DISPLAY_SIZE


def _keys(raw: Any) -> list[str]:
    if isinstance(raw, str):
        raw = raw.replace("+", " ").split()
    return [KEY_MAP.get(str(k).lower(), str(k)) for k in raw or []]


def to_action(args: dict, vw: int, vh: int) -> Action:
    """Maps a Fara tool call onto the allowlist; anything else becomes `Unsupported`."""
    a = args.get("action")
    try:
        if a in ("left_click", "double_click", "triple_click"):
            x, y = _point(args, vw, vh)
            return Click(x=x, y=y, count={"left_click": 1, "double_click": 2, "triple_click": 3}[a])
        if a == "mouse_move":
            x, y = _point(args, vw, vh)
            return Hover(x=x, y=y)
        if a == "type":
            text = str(args.get("text", args.get("text_value", "")))
            return TypeText(text=text, pressEnter=bool(args.get("press_enter", False)))
        if a == "key":
            return Key(keys=_keys(args.get("keys")))
        if a == "scroll":
            return Scroll(dy=-float(args.get("pixels", 0)) * vh / DISPLAY_SIZE)
        if a == "hscroll":
            return Scroll(dx=-float(args.get("pixels", 0)) * vw / DISPLAY_SIZE)
        if a == "visit_url":
            url = str(args.get("url", ""))
            if url.startswith(("https://", "http://")):
                return Navigate(url=url)
            if " " in url:
                return Navigate(url=f"https://www.bing.com/search?q={quote_plus(url)}&FORM=QBLH")
            return Navigate(url="https://" + url)
        if a == "web_search":
            return Navigate(url=f"https://www.bing.com/search?q={quote_plus(str(args.get('query', '')))}&FORM=QBLH")
        if a == "history_back":
            return Back()
        if a == "wait":
            return Wait(seconds=min(float(args.get("time", args.get("duration", 3.0))), 30.0))
        if a == "read_page_answer_question":
            return ReadPage(question=str(args.get("question", "")))
        if a == "pause_and_memorize_fact":
            return Memorize(fact=str(args.get("fact", "")))
        if a == "ask_user_question":
            return AskUser(question=str(args.get("question", "")))
        if a == "terminate":
            return Done(answer=str(args.get("answer", "")))
    except (ValueError, TypeError) as e:
        return Unsupported(reason=f"{a}: {e}")
    return Unsupported(reason=f"action {a!r} is not allowed")
