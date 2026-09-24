import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AID_GUIDE_LANGUAGES, aidGuideHref } from "@/lib/aid-guide";
import { PAGE_LANG_HEADER, PAGE_LANGS, SITE_LANG, documentLang, pageLangForPath, setDocumentLang } from "./page-lang";

// The root layout, rendered on the server with the request headers the proxy would pass on.

const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => request.headers }));
vi.mock("next/font/google", () => ({ Geist: () => ({ variable: "font-sans" }), Geist_Mono: () => ({ variable: "font-mono" }) }));
vi.mock("@/lib/auth/dal", () => ({ getCurrentUser: async () => null }));

const { default: RootLayout } = await import("./layout");

async function renderLayout(pageLang?: string) {
  request.headers = new Headers(pageLang === undefined ? {} : { [PAGE_LANG_HEADER]: pageLang });
  const props = { children: createElement("p", null, "Page"), params: Promise.resolve({}) };
  return renderToStaticMarkup(await RootLayout(props as LayoutProps<"/">));
}

beforeEach(() => {
  request.headers = new Headers();
});

describe("page language", () => {
  it("is Spanish for the Spanish aid guide and English everywhere else", () => {
    for (const lang of AID_GUIDE_LANGUAGES) {
      expect(pageLangForPath(aidGuideHref(lang))).toBe(lang);
      expect(pageLangForPath(aidGuideHref(lang, "fafsa-step-by-step"))).toBe(lang);
    }
    expect(PAGE_LANGS).toEqual(expect.arrayContaining([...AID_GUIDE_LANGUAGES]));
    for (const path of ["/", "/aid", "/aid/fr/x", "/aid/esp", "/colleges", "/es", "/counselor/aid/es"]) {
      expect(pageLangForPath(path), path).toBe("en");
    }
  });

  it("marks the whole document with it", async () => {
    expect(await renderLayout("es")).toMatch(/^<html lang="es"/);
    expect(await renderLayout("en")).toMatch(/^<html lang="en"/);
  });

  it("is English when the header is missing or unexpected", async () => {
    expect(await renderLayout()).toMatch(/^<html lang="en"/);
    expect(await renderLayout("fr")).toMatch(/^<html lang="en"/);
    expect(await renderLayout('en" onload="x')).toMatch(/^<html lang="en"/);
    expect(documentLang(null)).toBe(SITE_LANG);
  });

  it("keeps the site's own English header and footer marked as English on a Spanish page", async () => {
    const html = await renderLayout("es");
    expect(html).toMatch(/<a href="#main" lang="en"/);
    expect(html).toMatch(/<header lang="en"/);
    expect(html).toMatch(/<footer lang="en"/);
  });

  it("follows client-side navigation into the guide and back out", () => {
    const root = { lang: "en" };
    const leaveSpanish = setDocumentLang(root, "es");
    expect(root.lang).toBe("es");
    leaveSpanish();
    expect(root.lang).toBe("en");
    // A full page load of the Spanish guide, then moving to the English one.
    const spanishLoad = { lang: "es" };
    setDocumentLang(spanishLoad, "en");
    expect(spanishLoad.lang).toBe("en");
  });
});

describe("footer", () => {
  it("gives every link a 44px tap target", async () => {
    const html = await renderLayout();
    const footer = /<footer[\s\S]*<\/footer>/.exec(html)?.[0] ?? "";
    const links = [...footer.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    expect(links.map((a) => /href="([^"]+)"/.exec(a)?.[1])).toEqual(["/careers", "/colleges", "/aid", "/about/data", "/privacy"]);
    for (const a of links) expect(a).toMatch(/class="[^"]*inline-flex[^"]*min-h-11/);
  });
});
