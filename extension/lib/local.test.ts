import { describe, expect, it } from "vitest";
import { planLocal, wantsSubmit, type LocalSlot } from "./local";

const name: LocalSlot = { role: "field", cls: "PERSON", x: 100, y: 200, empty: true };
const email: LocalSlot = { role: "field", cls: "EMAIL", x: 100, y: 280, empty: true };
const submit: LocalSlot = { role: "button", cls: "SUBMIT", x: 80, y: 400, empty: true };

describe("planLocal", () => {
  it("types the task into an empty matching field, top to bottom", () => {
    const plan = planLocal([email, name], [{ token: "[PERSON_1]", cls: "PERSON" }], false, new Set(), new Set(), false);
    expect(plan).toMatchObject({ kind: "fill", token: "[PERSON_1]", x: 100, y: 200 });
  });

  it("does not reuse a token or retry a field", () => {
    const used = new Set(["[PERSON_1]"]);
    const tried = new Set(["PERSON:100:200"]);
    const plan = planLocal([name, email], [{ token: "[PERSON_1]", cls: "PERSON" }, { token: "[EMAIL_1]", cls: "EMAIL" }], false, used, tried, false);
    expect(plan).toMatchObject({ kind: "fill", token: "[EMAIL_1]" });
  });

  it("submits a form the user already filled", () => {
    const filled: LocalSlot = { ...name, empty: false };
    const plan = planLocal([filled, submit], [], true, new Set(), new Set(), false);
    expect(plan).toEqual({ kind: "submit", x: 80, y: 400 });
  });

  it("never types a password from the task", () => {
    const password: LocalSlot = { role: "field", cls: "PASSWORD", x: 10, y: 10, empty: true };
    const plan = planLocal([password], [{ token: "[PASSWORD_1]", cls: "PASSWORD" }], false, new Set(), new Set(), false);
    expect(plan.kind).toBe("done");
  });

  it("recognises a submit instruction", () => {
    expect(wantsSubmit("Submit the application.")).toBe(true);
    expect(wantsSubmit("Fill the name field.")).toBe(false);
  });
});
