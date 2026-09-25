import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormState } from "@/lib/forms";
import { ChildAccountForm } from "./child-account-form";

// The parent's "add a child" form, rendered on the server with the state an action returned.

const form = vi.hoisted(() => ({ state: undefined as FormState, values: {} as Record<string, string>, focusedFor: [] as unknown[] }));
vi.mock("@/app/actions/parent", () => ({ createChildAction: async () => undefined }));
vi.mock("@/components/use-form-action", () => ({ useFormAction: () => [form.state, () => {}, false, form.values] }));
vi.mock("@/components/use-focus-first-invalid", () => ({
  useFocusFirstInvalid: (result: unknown) => {
    form.focusedFor.push(result);
    return { current: null };
  },
}));

beforeEach(() => {
  form.state = undefined;
  form.values = {};
  form.focusedFor = [];
});

/** The consent label's classes and its checkbox's attributes. */
function consentBox(html: string) {
  const [, label, attrs] = /<label class="([^"]*)"><input ([^>]*name="consent"[^>]*)\/>/.exec(html) ?? [];
  expect(attrs, "consent checkbox inside its label").toBeDefined();
  return { label: label.split(" "), box: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])) };
}

describe("child account form", () => {
  it("makes the whole consent row, box and words, at least 44px tall", () => {
    const { label, box } = consentBox(renderToStaticMarkup(createElement(ChildAccountForm, {})));
    expect(label).toContain("min-h-11");
    expect(box.class.split(" ")).toContain("size-5");
    expect(box).not.toHaveProperty("aria-invalid");
    expect(box).not.toHaveProperty("aria-describedby");
    expect(box).not.toHaveProperty("checked");
  });

  it("keeps the consent box ticked after a failed submit", () => {
    // React resets the form after the action, so the box is ticked again from what was submitted.
    form.state = { errors: { username: ["That username is taken."] } };
    form.values = { displayName: "Sam", username: "sam", consent: "on" };
    expect(consentBox(renderToStaticMarkup(createElement(ChildAccountForm, {}))).box).toHaveProperty("checked");
    form.values = { displayName: "Sam", username: "sam" };
    expect(consentBox(renderToStaticMarkup(createElement(ChildAccountForm, {}))).box).not.toHaveProperty("checked");
  });

  it("points the consent box to its error", () => {
    form.state = { errors: { consent: ["Check the box to give consent for a child under 13."] } };
    const html = renderToStaticMarkup(createElement(ChildAccountForm, {}));
    expect(consentBox(html).box).toMatchObject({ "aria-invalid": "true", "aria-describedby": "consent-error" });
    expect(html).toMatch(/<p id="consent-error"[^>]*>Check the box/);
  });

  it("moves focus to the first invalid field after each submit", () => {
    form.state = { errors: { displayName: ["Enter a name."], consent: ["Check the box."] } };
    renderToStaticMarkup(createElement(ChildAccountForm, {}));
    expect(form.focusedFor).toEqual([form.state]);
  });

  it("can move focus to the message when no field is invalid", () => {
    form.state = { message: "We couldn't create this account. Please check the details and try again." };
    const html = renderToStaticMarkup(createElement(ChildAccountForm, {}));
    expect(html).not.toContain("aria-invalid");
    expect(html).toMatch(/<p role="alert" tabindex="-1"[^>]*>We couldn&#x27;t create this account/);
    expect(form.focusedFor).toEqual([form.state]);
  });
});
