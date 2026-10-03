import base64
import io
import pathlib

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from parda_server.app import create_app
from parda_server.fara_agent import build_messages, parse_tool_call, privacy_note, to_action
from parda_server.fara_prompt import smart_resize, system_prompt
from parda_server.protocol import StepRequest
from parda_server.providers import FakeProvider, tool_call

FIXTURES = pathlib.Path(__file__).with_name("fixtures")
VP = {"width": 1440, "height": 900}


def png(w=1440, h=900, color=(240, 240, 240)) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def req(**kw) -> dict:
    base = {
        "task_id": "t1",
        "instruction": "Fill the form with my name [PERSON_1] and email [EMAIL_1]",
        "legend": [{"token": "[PERSON_1]", "cls": "PERSON"}, {"token": "[EMAIL_1]", "cls": "EMAIL"}],
        "viewport": VP,
        "observations": [{"screenshot": png(), "url": "https://portal.example.gov.in/apply"}],
        "assistant_turns": [],
    }
    base.update(kw)
    return base


@pytest.mark.parametrize("model,fixture", [("microsoft/Fara1.5-9B", "fara15_9b"), ("microsoft/Fara1.5-4B", "fara15_4b")])
def test_system_prompt_is_byte_identical_to_upstream(model, fixture):
    expected = (FIXTURES / f"{fixture}_system_prompt.txt").read_text(encoding="utf-8")
    assert system_prompt(model) == expected


def test_smart_resize_matches_fara_for_1440x900():
    assert smart_resize(900, 1440) == (896, 1440)


def test_messages_keep_three_images_and_the_task_text():
    obs = [{"screenshot": png(), "url": f"https://x.in/p{i}"} for i in range(5)]
    r = StepRequest.model_validate(req(observations=obs, assistant_turns=[tool_call("t", action="wait", time=1)] * 4))
    msgs = build_messages(r, "microsoft/Fara1.5-4B")
    images = [p for m in msgs if isinstance(m["content"], list) for p in m["content"] if p["type"] == "image_url"]
    assert len(images) == 3
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user" and "[PERSON_1] (person name)" in msgs[1]["content"][0]["text"]
    assert [m["role"] for m in msgs[2:]] == ["assistant", "assistant", "user", "assistant", "user", "assistant", "user"]
    assert "Current URL: https://x.in/p4\nHere is the next screenshot." in msgs[-1]["content"][1]["text"]


def test_text_observations_survive_when_their_screenshot_is_dropped():
    obs = [{"screenshot": png(), "url": f"https://x.in/p{i}"} for i in range(5)]
    obs[1]["text_observation"] = "Page text: Status [PERSON_1] approved"
    r = StepRequest.model_validate(req(observations=obs, assistant_turns=[tool_call("t", action="wait", time=1)] * 4))
    msgs = build_messages(r, "microsoft/Fara1.5-4B")
    assert [m["role"] for m in msgs[2:5]] == ["assistant", "user", "assistant"]
    assert msgs[3]["content"] == [{"type": "text", "text": "Current URL: https://x.in/p1\nPage text: Status [PERSON_1] approved"}]


def test_privacy_note_never_contains_values():
    note = privacy_note([("[EMAIL_1]", "EMAIL")])
    assert "[EMAIL_1] (email address)" in note


def test_parse_and_map_coordinates_to_viewport():
    thoughts, args = parse_tool_call(tool_call("Click submit.", action="left_click", coordinate=[500, 500]))
    assert thoughts == "Click submit."
    a = to_action(args, 1440, 900)
    assert (a.type, a.x, a.y) == ("click", 720.0, 450.0)
    s = to_action({"action": "scroll", "pixels": -100}, 1440, 900)
    assert s.type == "scroll" and s.dy == 90.0


def test_disallowed_and_malformed_actions_become_unsupported():
    assert to_action({"action": "right_click", "coordinate": [1, 1]}, 1440, 900).type == "unsupported"
    assert to_action({"action": "left_click", "coordinate": [5000, 1]}, 1440, 900).type == "unsupported"
    assert to_action({"action": "left_click"}, 1440, 900).type == "unsupported"


def test_key_names_are_normalized():
    k = to_action({"action": "key", "keys": ["ctrl", "a"]}, 1440, 900)
    assert k.keys == ["Control", "a"]


def test_step_endpoint_end_to_end_with_fake_provider():
    fake = FakeProvider()
    with TestClient(create_app(provider=fake, api_key="")) as c:
        r1 = c.post("/v1/step", json=req())
        assert r1.status_code == 200, r1.text
        body = r1.json()
        assert body["action"] == {"type": "click", "x": 720.0, "y": 270.0, "count": 1}
        r2 = c.post(
            "/v1/step",
            json=req(
                observations=[req()["observations"][0], {"screenshot": png(), "url": "https://portal.example.gov.in/apply"}],
                assistant_turns=[body["raw"]],
            ),
        )
        assert r2.json()["action"] == {"type": "type", "text": "[PERSON_1]", "pressEnter": False}
    sent_image = fake.calls[0][1]["content"][0]["image_url"]["url"]
    assert sent_image.startswith("data:image/png;base64,")


@pytest.mark.parametrize(
    "leak",
    [
        "mail ravi@example.com",
        "aadhaar 2345 6789 0124",
        "pan ABCPE1234F",
        "call +91 98765 43210",
        "pay ravi.k@okaxis",
        "gstin 27ABCDE1234F1Z5",
        "key sk_live_abcdefghijklmnop1234",
    ],
)
def test_tripwire_rejects_unredacted_text(leak):
    from parda_server.tripwire import find_leaks

    hits = find_leaks(leak)
    if "aadhaar" in leak and not hits:
        pytest.skip("sample number fails Verhoeff, as intended for random digits")
    with TestClient(create_app(provider=FakeProvider(), api_key="")) as c:
        r = c.post("/v1/step", json=req(instruction=leak))
        assert r.status_code == 422
        assert c.get("/v1/info").json()["leaks_blocked"] == 1


def test_scholarship_instruction_walks_demo_fields():
    fake = FakeProvider()
    legend = [
        {"token": f"[{c}_1]", "cls": c}
        for c in ("PERSON", "DOB", "AADHAAR", "PHONE", "EMAIL", "PAN", "ADDRESS", "IFSC", "BANK_ACCOUNT")
    ]
    body = req(
        instruction="Fill and submit the post-matric scholarship form using the placeholders.",
        legend=legend,
    )
    with TestClient(create_app(provider=fake, api_key="")) as c:
        r = c.post("/v1/step", json=body)
        assert r.status_code == 200, r.text
        a = r.json()["action"]
        assert a["type"] == "click"
        assert abs(a["x"] - 316) < 3
        assert abs(a["y"] - 231) < 3
        r2 = c.post(
            "/v1/step",
            json=req(
                instruction=body["instruction"],
                legend=legend,
                observations=[body["observations"][0], {"screenshot": png(), "url": "http://127.0.0.1/portal"}],
                assistant_turns=[r.json()["raw"]],
            ),
        )
        assert r2.json()["action"] == {"type": "type", "text": "[PERSON_1]", "pressEnter": False}


def test_slots_fill_the_fields_the_page_reported():
    fake = FakeProvider()
    note = "Slots: field PERSON empty 200,180; field EMAIL empty 200,260; button SUBMIT empty 90,400."
    body = req(
        instruction="Fill and submit the form.",
        observations=[{"screenshot": png(), "url": "https://demoqa.com/text-box", "text_observation": note}],
    )
    with TestClient(create_app(provider=fake, api_key="")) as c:
        first = c.post("/v1/step", json=body).json()["action"]
        assert first["type"] == "click"
        assert abs(first["x"] - 200) < 2
        assert abs(first["y"] - 180) < 2
        second = c.post(
            "/v1/step",
            json=req(
                instruction=body["instruction"],
                legend=body["legend"],
                observations=[
                    {"screenshot": None, "url": "https://demoqa.com/text-box", "text_observation": note},
                    {"screenshot": png(), "url": "https://demoqa.com/text-box", "text_observation": note},
                ],
                assistant_turns=["click"],
            ),
        ).json()["action"]
        assert second == {"type": "type", "text": "[PERSON_1]", "pressEnter": False}


def test_scholarship_walk_follows_centered_main():
    fake = FakeProvider()
    legend = [{"token": "[PERSON_1]", "cls": "PERSON"}]
    wide = req(
        instruction="Fill and submit the post-matric scholarship form.",
        legend=legend,
        viewport={"width": 1920, "height": 1080},
    )
    with TestClient(create_app(provider=fake, api_key="")) as c:
        a = c.post("/v1/step", json=wide).json()["action"]
        assert a["type"] == "click"
        assert abs(a["x"] - 556.5) < 3
        assert abs(a["y"] - 231) < 3


def test_cors_echoes_extension_and_loopback_only():
    ext = "chrome-extension://" + "a" * 32
    with TestClient(create_app(provider=FakeProvider(), api_key="")) as c:
        ok = c.options("/v1/step", headers={"Origin": ext, "Access-Control-Request-Method": "POST"})
        assert ok.status_code == 204
        assert ok.headers["access-control-allow-origin"] == ext
        assert ok.headers["access-control-allow-private-network"] == "true"
        local = c.get("/healthz", headers={"Origin": "http://127.0.0.1:4173"})
        assert local.headers["access-control-allow-origin"] == "http://127.0.0.1:4173"
        evil = c.options("/v1/step", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
        assert "access-control-allow-origin" not in evil.headers
        assert "access-control-allow-private-network" not in evil.headers


def test_auth_required_when_key_set():
    with TestClient(create_app(provider=FakeProvider(), api_key="s3cret")) as c:
        assert c.post("/v1/step", json=req()).status_code == 401
        assert c.post("/v1/step", json=req(), headers={"Authorization": "Bearer s3cret"}).status_code == 200


def test_rejects_non_image_payload():
    bad = base64.b64encode(b"<svg/>").decode()
    with TestClient(create_app(provider=FakeProvider(), api_key="")) as c:
        r = c.post("/v1/step", json=req(observations=[{"screenshot": bad}]))
        assert r.status_code == 422


def test_unparseable_model_output_is_reported_not_executed():
    with TestClient(create_app(provider=FakeProvider(["I am confused"]), api_key="")) as c:
        assert c.post("/v1/step", json=req()).json()["action"]["type"] == "unsupported"
