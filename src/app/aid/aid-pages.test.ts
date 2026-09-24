import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AID_GUIDE_LANGUAGES, listSections, loadGuide } from "@/lib/aid-guide";
import { sectionFixture } from "@/lib/aid-guide/fixtures";
import AidGuideSectionPage, {
  generateMetadata as sectionMetadata,
  generateStaticParams as sectionParams,
} from "./[lang]/[section]/page";
import AidGuideLayout, { generateStaticParams as languageParams } from "./[lang]/layout";
import AidGuideIndexPage, { generateMetadata as indexMetadata } from "./[lang]/page";
import { GuideBlock, LinkedText, SourcesList } from "./guide-ui";
import AidGuideNotFound from "./not-found";
import AidGuideRedirect from "./page";

// Server-rendered checks for the financial aid guide pages, using the content files as they are.

const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const indexProps = (lang: string) => ({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) });
const sectionProps = (lang: string, section: string) => ({
  params: Promise.resolve({ lang, section }),
  searchParams: Promise.resolve({}),
});
const indexPage = (lang: string) => render(AidGuideIndexPage(indexProps(lang) as PageProps<"/aid/[lang]">));
const sectionPage = (lang: string, section: string) =>
  render(AidGuideSectionPage(sectionProps(lang, section) as PageProps<"/aid/[lang]/[section]">));

const ids = listSections("en").map((s) => s.id);
const [firstId, secondId] = ids;

/** Every <a>…</a> in the html that points exactly at `href`, whatever order its attributes are in. */
const linksTo = (html: string, href: string) =>
  [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]).filter((a) => a.includes(` href="${href}"`) || a.startsWith(`<a href="${href}"`));
/** The one link to `href`; fails the test if there isn't exactly one. */
function linkTo(html: string, href: string) {
  const found = linksTo(html, href);
  expect(found, href).toHaveLength(1);
  return found[0];
}
/** Checks a language-switch link: right address, hreflang and lang, labeled with the language's own name. */
function expectLanguageLink(html: string, href: string, lang: string, label: string) {
  const a = linkTo(html, href);
  expect(a).toContain(`hrefLang="${lang}"`);
  expect(a).toContain(` lang="${lang}"`);
  expect(a).toMatch(/class="[^"]*min-h-11/);
  expect(text(a).trim()).toBe(label);
}

/** Heading levels in order, e.g. [1, 2, 2]. */
const headingLevels = (html: string) => [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
function expectHeadingsInOrder(html: string) {
  const levels = headingLevels(html);
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  expect(levels[0]).toBe(1);
  levels.forEach((level, i) => i > 0 && expect(level - levels[i - 1]).toBeLessThanOrEqual(1));
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { digest?: string };
  }
  throw new Error("expected the page to throw");
}

describe("/aid", () => {
  it("sends visitors to the English guide", async () => {
    const error = await rejection(Promise.resolve().then(() => AidGuideRedirect()));
    expect(error.digest).toContain("NEXT_REDIRECT");
    expect(error.digest).toContain("/aid/en");
  });
});

describe("a guide page that doesn't exist", () => {
  it("says so in both languages and links to each guide", async () => {
    const html = await render(createElement(AidGuideNotFound));
    const words = decode(text(html));
    expect(words).toContain("We couldn't find that page");
    expect(words).toContain("No encontramos esa página");
    expect(html).toContain('<div lang="es">');
    const es = linkTo(html, "/aid/es");
    expect(es).toContain('hrefLang="es"');
    expect(text(es).trim()).toBe("Ir a la guía de ayuda financiera");
    expect(text(linkTo(html, "/aid/en")).trim()).toBe("Go to the financial aid guide");
    expectHeadingsInOrder(html);
  });
});

describe("guide layout", () => {
  it("builds a page for each language", () => {
    expect(languageParams()).toEqual(AID_GUIDE_LANGUAGES.map((lang) => ({ lang })));
  });

  it("marks Spanish content as Spanish, with a readable line length", async () => {
    const props = { children: createElement("p", null, "Hola"), params: Promise.resolve({ lang: "es" }) };
    const html = await render(AidGuideLayout(props as unknown as LayoutProps<"/aid/[lang]">));
    expect(html).toMatch(/^<div lang="es" data-aid-guide="" class="[^"]*max-w-prose[^"]*leading-7/);
  });

  it("is a 404 for any other language", async () => {
    const props = { children: null, params: Promise.resolve({ lang: "fr" }) };
    const error = await rejection(AidGuideLayout(props as unknown as LayoutProps<"/aid/[lang]">));
    expect(error.digest).toContain("404");
  });
});

describe("guide index", () => {
  it("welcomes students and families and lists every section with its summary", async () => {
    const html = await indexPage("en");
    const words = decode(text(html));
    expect(html).toContain("<h1");
    expect(words).toContain("Financial aid guide");
    expect(words).toContain("11th and 12th graders and their parents or guardians");
    expect(words).toContain("four-year college, a community college or a career training program");
    for (const section of listSections("en")) {
      expect(html).toContain(`href="${section.href}"`);
      expect(decode(html)).toContain(section.title);
      expect(decode(html)).toContain(section.summary);
    }
    expectHeadingsInOrder(html);
  });

  it("shows the draft notice and the last updated date", async () => {
    expect(loadGuide("en").review.status).toBe("draft");
    const html = await indexPage("en");
    expect(html).toContain('role="note"');
    expect(text(html)).toContain("An experienced counselor is reviewing this guide. Double-check dates with official sites.");
    expect(html).toContain(`<time dateTime="${loadGuide("en").updated}">`);
    expect(text(html)).toContain("Last updated:");
  });

  it("is in Spanish at /aid/es, with a switch back to English", async () => {
    const html = await indexPage("es");
    const words = decode(text(html));
    expect(words).toContain("Guía de ayuda financiera");
    expect(words).toContain("Un consejero con experiencia está revisando esta guía.");
    expect(words).toContain("Última actualización:");
    expectLanguageLink(html, "/aid/en", "en", "English");
  });

  it("switches to Spanish from English", async () => {
    expectLanguageLink(await indexPage("en"), "/aid/es", "es", "Español");
  });

  it("has titles and alternate-language links", async () => {
    const meta = await indexMetadata(indexProps("es") as PageProps<"/aid/[lang]">);
    expect(meta.title).toBe("Guía de ayuda financiera");
    expect(meta.alternates?.languages).toEqual({ en: "/aid/en", es: "/aid/es" });
  });

  it("is a 404 for an unknown language", async () => {
    expect((await rejection(indexPage("fr"))).digest).toContain("404");
  });
});

describe("guide section", () => {
  it("builds a page for every section in every language", () => {
    for (const lang of AID_GUIDE_LANGUAGES) {
      expect(sectionParams({ params: { lang } })).toEqual(listSections(lang).map((s) => ({ section: s.id })));
    }
    expect(sectionParams({ params: { lang: "fr" } })).toEqual([]);
  });

  it("renders the section's title, summary, blocks and sources", async () => {
    const section = loadGuide("en").sections[0];
    const html = await sectionPage("en", section.id);
    const words = decode(text(html));
    expect(decode(html)).toContain(section.title);
    expect(decode(html)).toContain(section.summary);
    for (const block of section.blocks) {
      for (const line of "text" in block ? [block.text] : block.items) {
        for (const part of line.split(/https?:\/\/\S+/)) expect(words).toContain(part.trim());
      }
    }
    expect(html).toContain('<h2 id="sources"');
    expect(words).toContain("Where this information comes from");
    for (const source of section.sources) expect(decode(html)).toContain(source.title);
    expectHeadingsInOrder(html);
  });

  it("links to the next and previous sections and back to the list", async () => {
    const first = await sectionPage("en", firstId);
    expect(first).not.toContain('rel="prev"');
    expect(linkTo(first, `/aid/en/${secondId}`)).toContain('rel="next"');
    expect(text(first)).toContain("Next");
    expect(first).toContain('href="/aid/en"');

    const second = await sectionPage("es", secondId);
    expect(linkTo(second, `/aid/es/${firstId}`)).toContain('rel="prev"');
    expect(text(second)).toContain("Anterior");
  });

  it("switches language to the same section", async () => {
    expectLanguageLink(await sectionPage("en", secondId), `/aid/es/${secondId}`, "es", "Español");
    expectLanguageLink(await sectionPage("es", secondId), `/aid/en/${secondId}`, "en", "English");
  });

  it("keeps navigation off the printed page but prints where sources live", async () => {
    const html = await sectionPage("en", firstId);
    for (const label of ["Language", "More of the guide"]) {
      expect(html).toMatch(new RegExp(`<nav aria-label="${label}"`));
    }
    // The top bar (way back + language switch) comes first and hides itself when printed.
    expect(html).toMatch(/^<div class="[^"]*print:hidden[^"]*"><a [^>]*href="\/aid\/en">[\s\S]*?<nav aria-label="Language"/);
    expect(html).toMatch(/<nav aria-label="More of the guide" class="[^"]*print:hidden/);
    const source = loadGuide("en").sections[0].sources[0];
    expect(html).toContain(`<span class="hidden break-all print:inline"> (${source.url})</span>`);
  });

  it("has no Print button outside the FAFSA steps", async () => {
    expect(text(await sectionPage("en", firstId))).not.toContain("Print");
  });

  it("has a title, a description and alternate-language links", async () => {
    const meta = await sectionMetadata(sectionProps("en", firstId) as PageProps<"/aid/[lang]/[section]">);
    expect(meta.title).toBe(listSections("en")[0].title);
    expect(meta.description).toBe(listSections("en")[0].summary);
    expect(meta.alternates?.languages).toEqual({ en: `/aid/en/${firstId}`, es: `/aid/es/${firstId}` });
    expect(await sectionMetadata(sectionProps("en", "nope") as PageProps<"/aid/[lang]/[section]">)).toEqual({});
  });

  it("is a 404 for an unknown section or language", async () => {
    expect((await rejection(sectionPage("en", "not-a-section"))).digest).toContain("404");
    expect((await rejection(sectionPage("fr", firstId))).digest).toContain("404");
    // A planned section the content doesn't have yet.
    const missing = ["training-programs-and-apprenticeships", "fafsa-step-by-step"].find((id) => !ids.includes(id as never));
    if (missing) expect((await rejection(sectionPage("en", missing))).digest).toContain("404");
  });
});

describe("guide blocks", () => {
  const block = (b: Parameters<typeof GuideBlock>[0]["block"], lang: "en" | "es" = "en", anchor?: string) =>
    renderToStaticMarkup(createElement(GuideBlock, { block: b, lang, anchor }));

  it("shows steps as a numbered list and other lists as bullets", () => {
    expect(block({ kind: "steps", items: ["One", "Two"] })).toMatch(/^<div[^>]*><ol class="[^"]*list-decimal[^"]*"><li[^>]*>One<\/li><li[^>]*>Two<\/li><\/ol>/);
    expect(block({ kind: "list", items: ["One"] })).toMatch(/<ul class="[^"]*list-disc/);
  });

  it("labels tips and warnings with an icon and words, not color alone", () => {
    const tip = block({ kind: "tip", text: "Start early." });
    expect(tip).toContain('role="note"');
    expect(tip).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(text(tip)).toContain("Tip Start early.");
    expect(text(block({ kind: "warning", text: "The FAFSA is free." }))).toContain("Be careful The FAFSA is free.");
    expect(text(block({ kind: "tip", text: "Empiece temprano." }, "es"))).toContain("Consejo Empiece temprano.");
    expect(text(block({ kind: "warning", text: "La FAFSA es gratis." }, "es"))).toContain("Atención La FAFSA es gratis.");
  });

  it("gives headings their anchor", () => {
    expect(block({ kind: "paragraph", heading: "Deadlines", text: "Soon." }, "en", "deadlines")).toContain('<h2 id="deadlines"');
    expect(block({ kind: "warning", heading: "Scams", text: "Careful." }, "en", "scams")).toContain('<h2 id="scams"');
  });

  it("puts every block kind of a full section on the page", () => {
    const html = renderToStaticMarkup(
      createElement("div", null, ...sectionFixture("how-aid-works").blocks.map((b, i) => createElement(GuideBlock, { key: i, block: b, lang: "en" }))),
    );
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html.match(/role="note"/g)).toHaveLength(2);
  });
});

describe("links in guide text", () => {
  const linked = (value: string, lang: "en" | "es" = "en") => renderToStaticMarkup(createElement(LinkedText, { text: value, lang }));

  it("opens addresses in a new tab without handing that page a way back in", () => {
    const html = linked("Apply at https://studentaid.gov today.");
    expect(html).toBe(
      'Apply at <a href="https://studentaid.gov/" target="_blank" rel="noopener noreferrer" class="break-words underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">https://studentaid.gov<span class="sr-only"> (opens in a new tab)</span></a> today.',
    );
    expect(linked("Vea https://studentaid.gov/es", "es")).toContain("(se abre en una pestaña nueva)");
  });

  it("never renders HTML from content", () => {
    const html = linked('<img src=x onerror="alert(1)"> <script>alert(1)</script> javascript:alert(1) https://studentaid.gov');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toMatch(/href="(javascript|data):/i);
  });

  it("doesn't link look-alikes", () => {
    for (const value of ["javascript:https://studentaid.gov", "data:text/html,https://studentaid.gov", "https://studentaid.gov@evil.example", "hxxps://studentaid.gov"]) {
      expect(linked(value), value).not.toContain("<a ");
    }
  });
});

describe("sources", () => {
  it("links each source in a new tab and shows its address only on paper", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesList, { sources: [{ title: "Ayuda Federal para Estudiantes", url: "https://studentaid.gov/es" }], lang: "es" }),
    );
    expect(html).toContain('<h2 id="sources"');
    expect(text(html)).toContain("De dónde viene esta información");
    expect(html).toMatch(/<a href="https:\/\/studentaid.gov\/es" target="_blank" rel="noopener noreferrer"/);
    expect(html).toContain('<span class="hidden break-all print:inline"> (https://studentaid.gov/es)</span>');
  });
});
