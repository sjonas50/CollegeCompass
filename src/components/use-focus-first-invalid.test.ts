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

/** A form holding controls; `invalid` ones carry aria-invalid="true". */
function fakeForm(controls: { name: string; invalid: boolean }[]) {
  const focused: string[] = [];
  const form = {
    querySelector: (selector: string) => {
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

  it("does nothing without a form or an invalid control", () => {
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
