import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptySavedAssessment } from "@/lib/assessments/anonymous";
import { INTEREST_ITEMS } from "@/lib/assessments/instruments";
import { SavedQuizChoice } from "./saved-results-import";
import { BirthdayFields, Button, GradeSelect } from "./ui";

// Server-rendered checks for the shared form pieces, and the color tokens behind them.

const css = readFileSync(path.join(import.meta.dirname, "../app/globals.css"), "utf8");

/** The colors set in each `:root` block of globals.css: light first, then dark. */
function themes() {
  const blocks = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
  expect(blocks).toHaveLength(2);
  expect(css.indexOf("prefers-color-scheme: dark")).toBeLessThan(blocks[1].index);
  return blocks.map(([, body]) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]])));
}

/** WCAG contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Each <select> and <input> tag's attributes. */
const controls = (html: string) =>
  [...html.matchAll(/<(?:select|input)\b([^>]*)>/g)].map(([, attrs]) =>
    Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])),
  );

describe("color tokens", () => {
  it("puts text on every filled color at WCAG AA contrast, in light and dark mode", () => {
    for (const theme of themes()) {
      const pairs = Object.keys(theme).filter((k) => k.endsWith("-foreground") && k !== "foreground");
      expect(pairs).toEqual(expect.arrayContaining(["accent-foreground", "danger-foreground"]));
      for (const fg of pairs) {
        const bg = fg.replace(/-foreground$/, "");
        expect(contrast(theme[bg], theme[fg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(css).toContain("--color-danger-foreground: var(--danger-foreground);");
  });

  it("uses the danger foreground on danger buttons, not fixed white", () => {
    const html = renderToStaticMarkup(createElement(Button, { variant: "danger" }, "Delete permanently"));
    expect(html).toContain("bg-danger text-danger-foreground");
    expect(html).not.toContain("text-white");
  });
});

describe("birthday fields", () => {
  it("point every control to the error, and read it out when it appears", () => {
    const html = renderToStaticMarkup(createElement(BirthdayFields, { legend: "Your birthday", errors: ["Enter your real birthday."] }));
    const fields = controls(html);
    expect(fields.map((f) => f.name)).toEqual(["birthMonth", "birthDay", "birthYear"]);
    for (const field of fields) expect(field).toMatchObject({ "aria-invalid": "true", "aria-describedby": "birthDate-error" });
    expect(html).toMatch(/<p id="birthDate-error" role="alert"[^>]*>Enter your real birthday\.<\/p>/);
  });

  it("stay neutral without an error, at 16px so phones don't zoom in", () => {
    const html = renderToStaticMarkup(createElement(BirthdayFields, { legend: "Your birthday" }));
    expect(html).not.toMatch(/aria-invalid|aria-describedby|role="alert"/);
    const fields = controls(html);
    expect(fields).toHaveLength(3);
    for (const field of fields) expect(field.class.split(" ")).toContain("text-base");
  });

  it("the grade question points to its error too", () => {
    const [grade] = controls(renderToStaticMarkup(createElement(GradeSelect, { errors: ["Choose your grade."] })));
    expect(grade).toMatchObject({ "aria-invalid": "true", "aria-describedby": "grade-error" });
    expect(controls(renderToStaticMarkup(createElement(GradeSelect, {})))[0]).not.toHaveProperty("aria-describedby");
  });
});

describe("tap targets", () => {
  it("makes the whole 'add my quiz results' row at least 44px tall", () => {
    const answers = Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, 3]));
    const html = renderToStaticMarkup(createElement(SavedQuizChoice, { saved: { ...emptySavedAssessment(), answers } }));
    expect(html).toMatch(/<label class="[^"]*\bmin-h-11\b[^"]*"><input type="checkbox"/);
  });
});
