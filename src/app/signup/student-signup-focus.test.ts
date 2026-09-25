import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudentSignup } from "./student-signup";

// Each signup step, rendered on the server with the state its action returned: every form hands
// that state to useFocusFirstInvalid, which moves focus to the first invalid field after a submit.

const form = vi.hoisted(() => ({ states: new Map<unknown, unknown>(), focusedFor: [] as unknown[] }));
const actions = vi.hoisted(() => ({
  checkAgeAction: async () => undefined,
  registerStudentAction: async () => undefined,
  requestParentConsentAction: async () => undefined,
}));
vi.mock("@/app/actions/auth", () => actions);
vi.mock("@/components/use-form-action", () => ({
  useFormAction: (action: unknown, initial: unknown) => [form.states.has(action) ? form.states.get(action) : initial, () => {}, false, {}],
}));
vi.mock("@/components/use-focus-first-invalid", () => ({
  useFocusFirstInvalid: (result: unknown) => {
    form.focusedFor.push(result);
    return { current: null };
  },
}));

beforeEach(() => {
  form.states.clear();
  form.focusedFor = [];
});

const render = (props: { startWithParentStep: boolean }) => renderToStaticMarkup(createElement(StudentSignup, props));
/** The attributes of the <input> or <select> with this name. */
const control = (html: string, name: string) =>
  [...html.matchAll(/<(?:select|input)\b([^>]*)>/g)]
    .map(([, attrs]) => Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])))
    .find((attrs) => attrs.name === name);

describe("student signup focus after a failed submit", () => {
  it("the birthday step", () => {
    const age = { errors: { birthDate: ["Enter your real birthday."] } };
    form.states.set(actions.checkAgeAction, age);
    const html = render({ startWithParentStep: false });
    expect(control(html, "birthMonth")).toMatchObject({ "aria-invalid": "true" });
    expect(form.focusedFor).toEqual([age]);
  });

  it("the account step", () => {
    const age = { step: "teen", birthDate: "2011-03-04" };
    const account = { errors: { email: ["Enter a valid email."] } };
    form.states.set(actions.checkAgeAction, age);
    form.states.set(actions.registerStudentAction, account);
    const html = render({ startWithParentStep: false });
    expect(control(html, "email")).toMatchObject({ "aria-invalid": "true" });
    expect(form.focusedFor).toEqual([age, account]);
  });

  it("the parent's email step", () => {
    const request = { errors: { parentEmail: ["Enter a valid email."] } };
    form.states.set(actions.requestParentConsentAction, request);
    const html = render({ startWithParentStep: true });
    expect(control(html, "parentEmail")).toMatchObject({ "aria-invalid": "true" });
    expect(form.focusedFor).toEqual([{ step: "child" }, request]);
  });
});
