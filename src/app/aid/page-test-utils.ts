import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect } from "vitest";
import AidGuideSectionPage from "./[lang]/[section]/page";
import AidGuideIndexPage from "./[lang]/page";

// Helpers for the guide page tests: render a page to HTML and read it back. Not used by the app.

export const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);

/** The characters React escapes in text and attributes. */
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'" };
/** HTML-escaped text back to the characters it stands for. */
export const decode = (html: string) => html.replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
/** Text the way React writes it into HTML. */
export const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** The words on the page: tags become spaces, runs of space become one, entities are decoded. */
export const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

export const indexProps = (lang: string) => ({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) }) as PageProps<"/aid/[lang]">;
export const sectionProps = (lang: string, section: string) =>
  ({ params: Promise.resolve({ lang, section }), searchParams: Promise.resolve({}) }) as PageProps<"/aid/[lang]/[section]">;
export const indexPage = (lang: string) => render(AidGuideIndexPage(indexProps(lang)));
export const sectionPage = (lang: string, section: string) => render(AidGuideSectionPage(sectionProps(lang, section)));

/** Every <a>…</a> in the html that points exactly at `href` (as written in HTML), whatever order its attributes are in. */
export const linksTo = (html: string, href: string) =>
  [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]).filter((a) => a.includes(` href="${href}"`) || a.startsWith(`<a href="${href}"`));

/** The one link to `href`; fails the test if there isn't exactly one. */
export function linkTo(html: string, href: string) {
  const found = linksTo(html, href);
  expect(found, href).toHaveLength(1);
  return found[0];
}

/** Checks a language-switch link: right address, hreflang and lang, labeled with the language's own name. */
export function expectLanguageLink(html: string, href: string, lang: string, label: string) {
  const a = linkTo(html, href);
  expect(a).toContain(`hrefLang="${lang}"`);
  expect(a).toContain(` lang="${lang}"`);
  expect(a).toMatch(/class="[^"]*min-h-11/);
  expect(text(a).trim()).toBe(label);
}

/** One h1 first, and no heading level skipped on the way down. */
export function expectHeadingsInOrder(html: string) {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  levels.forEach((level, i) => i > 0 && expect(level - levels[i - 1]).toBeLessThanOrEqual(1));
}

/** The error a page throws (notFound, redirect); fails the test if it doesn't throw. */
export async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { digest?: string };
  }
  throw new Error("expected the page to throw");
}
