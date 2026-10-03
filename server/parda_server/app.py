from __future__ import annotations

import base64
import binascii
import io
import os
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from PIL import Image

from .fara_agent import build_messages, parse_tool_call, to_action
from .fara_prompt import smart_resize
from .protocol import StepRequest, StepResponse, Timings, Unsupported
from .providers import FakeProvider, Provider, VLLMProvider
from .tripwire import find_leaks

MAX_IMAGE_BYTES = 4 * 1024 * 1024


def _provider_from_env() -> Provider:
    kind = os.environ.get("PARDA_PROVIDER", "fake")
    if kind == "vllm":
        return VLLMProvider(
            base_url=os.environ.get("PARDA_VLLM_URL", "http://127.0.0.1:8001/v1"),
            model=os.environ.get("PARDA_MODEL", "microsoft/Fara1.5-4B"),
        )
    return FakeProvider()


def _normalize_screenshot(b64: str) -> str:
    """Decodes, drops metadata by re-encoding, and applies Fara's resize so the model sees what it was trained on."""
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(422, "screenshot is not valid base64") from e
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "screenshot too large")
    try:
        img = Image.open(io.BytesIO(raw))
        if img.format not in ("PNG", "JPEG", "WEBP"):
            raise HTTPException(415, "screenshot must be PNG, JPEG or WebP")
        img = img.convert("RGB")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(422, "screenshot could not be decoded") from e
    h, w = smart_resize(img.height, img.width)
    img = img.resize((w, h))
    out = io.BytesIO()
    img.save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


def create_app(provider: Provider | None = None, api_key: str | None = None) -> FastAPI:
    state: dict = {"provider": provider, "leaks_blocked": 0, "model_echoes": 0, "steps": 0}
    key = api_key if api_key is not None else os.environ.get("PARDA_API_KEY", "")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if state["provider"] is None:
            state["provider"] = _provider_from_env()
        yield
        close = getattr(state["provider"], "aclose", None)
        if close:
            await close()

    app = FastAPI(title="Parda server", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def extension_cors(request, call_next):
        # Chrome treats a side-panel POST to loopback as a private-network request and
        # drops it unless the preflight opts in. The service-worker GET is not preflighted.
        if request.method == "OPTIONS":
            from starlette.responses import Response

            return Response(
                status_code=204,
                headers={
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "GET, POST, OPTIONS",
                    "access-control-allow-headers": "*",
                    "access-control-allow-private-network": "true",
                },
            )
        response = await call_next(request)
        response.headers["access-control-allow-origin"] = "*"
        response.headers["access-control-allow-private-network"] = "true"
        return response

    def auth(authorization: str = Header(default="")) -> None:
        if key and not secrets.compare_digest(authorization, f"Bearer {key}"):
            raise HTTPException(401, "bad credentials")

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    @app.get("/v1/info", dependencies=[Depends(auth)])
    async def info() -> dict:
        p: Provider = state["provider"]
        return {
            "model": p.model,
            "coord_space": "viewport_css_px",
            "steps": state["steps"],
            "leaks_blocked": state["leaks_blocked"],
            "model_echoes": state["model_echoes"],
        }

    @app.post("/v1/step", response_model=StepResponse, dependencies=[Depends(auth)])
    async def step(req: StepRequest) -> StepResponse:
        t0 = time.perf_counter()
        texts = [req.instruction, *(o.url for o in req.observations), *(o.text_observation for o in req.observations)]
        texts += [o.user_response for o in req.observations]
        leaks = sorted({hit for t in texts for hit in find_leaks(t)})
        if leaks:
            state["leaks_blocked"] += 1
            raise HTTPException(422, f"unredacted PII in request text: {', '.join(leaks)}")
        # Replayed model output cannot be re-redacted by the client, so echoes are counted, not rejected.
        if any(find_leaks(t) for t in req.assistant_turns):
            state["model_echoes"] += 1

        for o in req.observations:
            if o.screenshot:
                o.screenshot = _normalize_screenshot(o.screenshot)

        p: Provider = state["provider"]
        try:
            messages = build_messages(req, p.model)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

        t1 = time.perf_counter()
        raw = await p.complete(messages, req)
        t2 = time.perf_counter()
        state["steps"] += 1
        try:
            thoughts, args = parse_tool_call(raw)
            action = to_action(args, req.viewport.width, req.viewport.height)
        except (ValueError, SyntaxError) as e:
            thoughts, action = raw.strip(), Unsupported(reason=f"unparseable model output: {e}")
        return StepResponse(
            action=action,
            thoughts=thoughts,
            raw=raw,
            model=p.model,
            timings=Timings(model_ms=(t2 - t1) * 1000, total_ms=(time.perf_counter() - t0) * 1000),
        )

    return app


app = create_app()
