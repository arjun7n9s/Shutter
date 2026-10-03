from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field

MAX_TEXT = 4000


class LegendEntry(BaseModel):
    token: Annotated[str, Field(pattern=r"^\[[A-Z][A-Z_]*_\d{1,4}\]$")]
    cls: Annotated[str, Field(pattern=r"^[A-Z_]{2,32}$")]


class Viewport(BaseModel):
    width: Annotated[int, Field(gt=0, le=8192)]
    height: Annotated[int, Field(gt=0, le=8192)]


class Observation(BaseModel):
    """One screen the agent looked at. Old observations may omit the screenshot."""

    screenshot: str | None = Field(default=None, description="base64 PNG/JPEG of the redacted viewport")
    url: Annotated[str, Field(max_length=2048)] = ""
    text_observation: Annotated[str, Field(max_length=MAX_TEXT)] = ""
    user_response: Annotated[str, Field(max_length=MAX_TEXT)] = ""


class StepRequest(BaseModel):
    """Stateless: the client resends the (already redacted) trajectory every step."""

    task_id: Annotated[str, Field(min_length=1, max_length=64)]
    instruction: Annotated[str, Field(min_length=1, max_length=MAX_TEXT)]
    legend: list[LegendEntry] = Field(default_factory=list, max_length=256)
    viewport: Viewport
    observations: list[Observation] = Field(min_length=1, max_length=64)
    assistant_turns: list[str] = Field(default_factory=list, max_length=63)


class Click(BaseModel):
    type: Literal["click"] = "click"
    x: float
    y: float
    count: Literal[1, 2, 3] = 1


class Hover(BaseModel):
    type: Literal["hover"] = "hover"
    x: float
    y: float


class TypeText(BaseModel):
    type: Literal["type"] = "type"
    text: str
    pressEnter: bool = False


class Scroll(BaseModel):
    type: Literal["scroll"] = "scroll"
    dx: float = 0
    dy: float = 0


class Key(BaseModel):
    type: Literal["key"] = "key"
    keys: list[str]


class Navigate(BaseModel):
    type: Literal["navigate"] = "navigate"
    url: str


class Back(BaseModel):
    type: Literal["back"] = "back"


class Wait(BaseModel):
    type: Literal["wait"] = "wait"
    seconds: float = 1.0


class ReadPage(BaseModel):
    type: Literal["read_page"] = "read_page"
    question: str


class Memorize(BaseModel):
    type: Literal["memorize"] = "memorize"
    fact: str


class AskUser(BaseModel):
    type: Literal["ask_user"] = "ask_user"
    question: str


class Done(BaseModel):
    type: Literal["done"] = "done"
    answer: str = ""


class Unsupported(BaseModel):
    """The model asked for something outside the allowlist; the client reports it back as an observation."""

    type: Literal["unsupported"] = "unsupported"
    reason: str


Action = Annotated[
    Click | Hover | TypeText | Scroll | Key | Navigate | Back | Wait | ReadPage | Memorize | AskUser | Done | Unsupported,
    Field(discriminator="type"),
]


class Timings(BaseModel):
    model_ms: float
    total_ms: float


class StepResponse(BaseModel):
    action: Action
    thoughts: str
    raw: str = Field(description="Verbatim model output; the client stores it and returns it in assistant_turns")
    model: str
    timings: Timings
