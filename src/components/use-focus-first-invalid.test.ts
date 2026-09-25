import { beforeEach, describe, expect, it, vi } from "vitest";
import { focusFirstInvalid, useFocusFirstInvalid } from "./use-focus-first-invalid";

// No DOM in these tests, so React's effect is stood in for: it runs when a dependency changes
// (by Object.is), as React runs it after each commit.
const react = vi.hoisted(() => ({ ref: { current: null as unknown }, deps: undefined as unknown[] | undefined }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: () => react.ref,
  useEffect: (effect: () => void, deps: unknown[]) => {
    const changed = !react.deps || deps.length !== react.deps.length || deps.some((d, i) => !Object.is(d, react.deps?.[i]));
    react.deps = deps;
    if (changed) effect();
  },
}));

/** A form holding controls, `invalid` ones carrying aria-invalid="true", and maybe a role="alert" message. */
function fakeForm(controls: { name: string; invalid: boolean }[], message?: string) {
  const focused: string[] = [];
  const form = {
    querySelector: (selector: string) => {
      if (selector === '[role="alert"]') return message ? { focus: () => focused.push(message) } : null;
      expect(selector).toBe('[aria-invalid="true"]');
      const first = controls.find((c) => c.invalid);
      return first ? { focus: () => focused.push(first.name) } : null;
    },
  };
  return { form: form as unknown as HTMLFormElement, focused };
}

beforeEach(() => {
  react.ref = { current: null };
  react.deps = undefined;
});

describe("focusFirstInvalid", () => {
  it("focuses the first control marked invalid", () => {
    const { form, focused } = fakeForm([
      { name: "displayName", invalid: false },
      { name: "birthMonth", invalid: true },
      { name: "email", invalid: true },
    ]);
    focusFirstInvalid(form);
    expect(focused).toEqual(["birthMonth"]);
  });

  it("focuses the form's message when the error isn't about one field", () => {
    const { form, focused } = fakeForm([{ name: "email", invalid: false }], "Too many attempts. Please try again later.");
    focusFirstInvalid(form);
    expect(focused).toEqual(["Too many attempts. Please try again later."]);
  });

  it("prefers the invalid control to the message", () => {
    const { form, focused } = fakeForm([{ name: "username", invalid: true }], "Please fix the errors below.");
    focusFirstInvalid(form);
    expect(focused).toEqual(["username"]);
  });

  it("does nothing without a form, an invalid control or a message", () => {
    expect(() => focusFirstInvalid(null)).not.toThrow();
    const { form, focused } = fakeForm([{ name: "email", invalid: false }]);
    focusFirstInvalid(form);
    expect(focused).toEqual([]);
  });
});

describe("useFocusFirstInvalid", () => {
  it("moves focus after each failed submit, even when the error is the same", () => {
    const { form, focused } = fakeForm([{ name: "birthMonth", invalid: true }]);
    const ref = useFocusFirstInvalid(undefined);
    ref.current = form;
    expect(focused).toEqual([]);

    const first = { errors: { birthDate: ["Enter your real birthday."] } };
    useFocusFirstInvalid(first);
    expect(focused).toEqual(["birthMonth"]);
    // The same state again is a re-render, not a submit: focus stays where the user put it.
    useFocusFirstInvalid(first);
    expect(focused).toEqual(["birthMonth"]);
    // A second submit returns a new object with the same error.
    useFocusFirstInvalid({ errors: { birthDate: ["Enter your real birthday."] } });
    expect(focused).toEqual(["birthMonth", "birthMonth"]);
  });

  it("moves focus to the form's message after each failed submit that has only a message", () => {
    const message = "We couldn't create this account. Please check the details and try again.";
    const { form, focused } = fakeForm([{ name: "username", invalid: false }], message);
    react.ref = { current: form };
    useFocusFirstInvalid(undefined);
    useFocusFirstInvalid({ message });
    useFocusFirstInvalid({ message });
    expect(focused).toEqual([message, message]);
  });

  it("leaves focus alone on the first render and once the form is gone", () => {
    const { form, focused } = fakeForm([{ name: "birthMonth", invalid: true }]);
    react.ref = { current: form };
    useFocusFirstInvalid(undefined);
    expect(focused).toEqual([]);
    react.ref.current = null;
    expect(() => useFocusFirstInvalid({ step: "teen", birthDate: "2011-01-01" })).not.toThrow();
    expect(focused).toEqual([]);
  });
});
