import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";

// Every claim on the home page must match what the product does (see the note in src/app/page.tsx).

vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => null, homePathFor: () => "/dashboard" }));

const home = async () =>
  renderToStaticMarkup((await Home({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as PageProps<"/">)) as ReactNode);

/** The page's words, one entry per sentence. Blocks end sentences too, since list items have no periods. */
function sentences(html: string): string[] {
  return html
    .replace(/<\/(p|li|h[1-6]|figcaption|summary|a)>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .split(/\n|(?<=[.?!])\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

describe("home page claims", () => {
  it("never promises career pay, wages, salaries or job outlook, which career pages don't show", async () => {
    const html = await home();
    // Checked in the markup, so text only screen readers get (and labels) counts too.
    expect(html).not.toMatch(/\b(wages?|salar(y|ies)|outlook)\b/i);

    const all = sentences(html);
    // "Pay" only ever means paying for college.
    expect(all.filter((s) => /\bpay\b/i.test(s))).toEqual(["Choose where to go and how to pay."]);
    // Careers come with the schooling they take, never with what they pay.
    const careers = all.filter((s) => /\bcareers?\b/i.test(s));
    expect(careers.join("\n")).toContain("Then see careers that fit you, with the schooling each one takes.");
    expect(careers.join("\n")).toContain("About 1,000 careers, with the schooling each one takes.");
    for (const s of careers) expect(s).not.toMatch(/\b(pay|paid|earn\w*|income|wages?|salar\w*|outlook|growth|demand)\b/i);
  });
});
