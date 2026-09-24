import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AID_GUIDE_LANGUAGES, getSection, listSections, loadGuide } from "@/lib/aid-guide";
import { sectionFixture } from "@/lib/aid-guide/fixtures";
import { generateMetadata as sectionMetadata, generateStaticParams as sectionParams } from "./[lang]/[section]/page";
import AidGuideLayout, { generateStaticParams as languageParams } from "./[lang]/layout";
import { generateMetadata as indexMetadata } from "./[lang]/page";
import { GuideBlock, LinkedText, SourcesList } from "./guide-ui";
import AidGuideNotFound from "./not-found";
import AidGuideRedirect from "./page";
import { QUERY_SOURCE_URL } from "./page-fixtures";
import {
  escapeHtml,
  expectHeadingsInOrder,
  expectLanguageLink,
  indexPage,
  indexProps,
  linkTo,
  linksTo,
  render,
  rejection,
  sectionPage,
  sectionProps,
  text,
} from "./page-test-utils";

// Server-rendered checks for the financial aid guide pages. The content files are swapped for a
// small draft guide (./page-fixtures.ts), so these don't depend on what the real content says.
// aid-pages-full-guide.test.ts covers a finished, reviewed guide; aid-pages-content.test.ts
// renders the real content.

vi.mock("@/content/aid-guide/en.json", async () => ({ default: (await import("./page-fixtures")).draftPageGuide("en") }));
vi.mock("@/content/aid-guide/es.json", async () => ({ default: (await import("./page-fixtures")).draftPageGuide("es") }));

const [firstId, secondId] = ["how-aid-works", "special-situations"];

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
    const words = text(html);
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
    const words = text(html);
    expect(html).toContain("<h1");
    expect(words).toContain("Financial aid guide");
    expect(words).toContain("11th and 12th graders and their parents or guardians");
    expect(words).toContain("four-year college, a community college or a career training program");
    for (const section of listSections("en")) {
      expect(linkTo(html, section.href)).toContain(escapeHtml(section.title));
      expect(words).toContain(section.summary);
    }
    expect(words).toContain("Part 3 of 3");
    expectHeadingsInOrder(html);
  });

  it("shows the draft notice and the last updated date", async () => {
    const html = await indexPage("en");
    expect(html).toContain('role="note"');
    expect(text(html)).toContain("An experienced counselor is reviewing this guide. Double-check dates with official sites.");
    expect(html).toContain('<time dateTime="2026-09-01">September 1, 2026</time>');
    expect(text(html)).toContain("Last updated:");
    expect(text(html)).not.toContain("Reviewed by");
  });

  it("is in Spanish at /aid/es, with a switch back to English", async () => {
    const html = await indexPage("es");
    const words = text(html);
    expect(words).toContain("Guía de ayuda financiera");
    expect(words).toContain("Un consejero con experiencia está revisando esta guía.");
    expect(words).toContain("Última actualización: 1 de septiembre de 2026");
    expectLanguageLink(html, "/aid/en", "en", "English");
  });

  it("switches to Spanish from English", async () => {
    expectLanguageLink(await indexPage("en"), "/aid/es", "es", "Español");
  });

  it("has titles and alternate-language links", async () => {
    const meta = await indexMetadata(indexProps("es"));
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

  it("renders the section's title, summary, blocks and sources, with the characters HTML escapes", async () => {
    const html = await sectionPage("en", firstId);
    const words = text(html);
    expect(words).toContain("Section how-aid-works");
    expect(words).toContain("One sentence that sums up the section.");
    expect(words).toContain("Most Pell Grant students have family incomes <$60,000 and pay >$0 after grants & scholarships. Apply at https://studentaid.gov");
    expect(words).toContain('and read "Paying for college" at https://www.consumerfinance.gov/paying-for-college/');
    expect(words).toContain("Your parents' tax return");
    expect(html).toContain("&lt;$60,000 and pay &gt;$0 after grants &amp; scholarships.");
    expect(html).not.toContain("<$60,000");
    for (const id of ["who-gets-a-pell-grant", "what-you-ll-need", "scam-sites"]) expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain('<h2 id="sources"');
    expect(words).toContain("Where this information comes from");
    expect(words).toContain("College Navigator: colleges in California & nearby");
    expectHeadingsInOrder(html);
  });

  it("links official sites and the section's sources, but not a scam example or the word https://", async () => {
    const html = await sectionPage("en", firstId);
    const main = html.slice(0, html.indexOf('<h2 id="sources"'));
    const hrefs = [...main.matchAll(/<a\b[^>]*href="(https:[^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "https://studentaid.gov/",
      "https://www.consumerfinance.gov/paying-for-college/",
      "https://www.careeronestop.org/toolkit/training/find-scholarships.aspx",
    ]);
    expect(text(html)).toContain('Fake sites copy real names, like studentaid-gov.help. A real address starts with "https://" and ends in .gov.');
    expect(linkTo(main, "https://studentaid.gov/")).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });

  it("links to the next and previous sections and back to the list", async () => {
    const first = await sectionPage("en", firstId);
    expect(first).not.toContain('rel="prev"');
    expect(linkTo(first, `/aid/en/${secondId}`)).toContain('rel="next"');
    expect(text(first)).toContain("Next");
    expect(text(first)).toContain("Part 1 of 3");
    expect(first).toContain('href="/aid/en"');

    const second = await sectionPage("es", secondId);
    expect(linkTo(second, `/aid/es/${firstId}`)).toContain('rel="prev"');
    expect(linkTo(second, "/aid/es/comparing-aid-offers")).toContain('rel="next"');
    expect(text(second)).toContain("Anterior");
    expect(text(second)).toContain("Parte 2 de 3");

    expect(await sectionPage("en", "comparing-aid-offers")).not.toContain('rel="next"');
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
    // The address is printed as written; its & is escaped in the HTML, like any text.
    expect(html).toContain('<span class="hidden break-all print:inline"> (https://nces.ed.gov/collegenavigator/?s=CA&amp;l=93)</span>');
    expect(linkTo(html, escapeHtml(QUERY_SOURCE_URL))).toMatch(/target="_blank"/);
  });

  it("has no Print button outside the FAFSA steps", async () => {
    expect(text(await sectionPage("en", firstId))).not.toContain("Print");
  });

  it("shows the draft notice on every section", async () => {
    expect(text(await sectionPage("es", secondId))).toContain("Un consejero con experiencia está revisando esta guía.");
  });

  it("has a title, a description and alternate-language links", async () => {
    const meta = await sectionMetadata(sectionProps("es", firstId));
    expect(meta.title).toBe(getSection("es", firstId)?.title);
    expect(meta.description).toBe("Una oración que resume la sección.");
    expect(meta.alternates?.languages).toEqual({ en: `/aid/en/${firstId}`, es: `/aid/es/${firstId}` });
    expect(await sectionMetadata(sectionProps("en", "nope"))).toEqual({});
  });

  it("is a 404 for an unknown section or language, and for a planned section that isn't written yet", async () => {
    expect((await rejection(sectionPage("en", "not-a-section"))).digest).toContain("404");
    expect((await rejection(sectionPage("fr", firstId))).digest).toContain("404");
    expect(loadGuide("en").sections.map((s) => s.id)).not.toContain("fafsa-step-by-step");
    expect((await rejection(sectionPage("en", "fafsa-step-by-step"))).digest).toContain("404");
  });
});

describe("guide blocks", () => {
  const block = (b: Parameters<typeof GuideBlock>[0]["block"], lang: "en" | "es" = "en", anchor?: string) =>
    renderToStaticMarkup(createElement(GuideBlock, { block: b, lang, anchor, sources: [] }));

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
    const { blocks, sources } = sectionFixture("how-aid-works");
    const html = renderToStaticMarkup(createElement("div", null, ...blocks.map((b, i) => createElement(GuideBlock, { key: i, block: b, lang: "en", sources }))));
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html.match(/role="note"/g)).toHaveLength(2);
  });
});

describe("links in guide text", () => {
  const sources = [{ title: "CareerOneStop", url: "https://www.careeronestop.org/" }];
  const linked = (value: string, lang: "en" | "es" = "en") => renderToStaticMarkup(createElement(LinkedText, { text: value, lang, sources }));

  it("opens addresses in a new tab without handing that page a way back in", () => {
    const html = linked("Apply at https://studentaid.gov today.");
    expect(html).toBe(
      'Apply at <a href="https://studentaid.gov/" target="_blank" rel="noopener noreferrer" class="break-words underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">https://studentaid.gov<span class="sr-only"> (opens in a new tab)</span></a> today.',
    );
    expect(linked("Vea https://studentaid.gov/es", "es")).toContain("(se abre en una pestaña nueva)");
  });

  it("links .gov and .edu sites and the section's sources, and nothing else", () => {
    expect(linksTo(linked("https://www.careeronestop.org/toolkit and https://finaid.ucla.edu"), "https://www.careeronestop.org/toolkit")).toHaveLength(1);
    expect(linked("https://finaid.ucla.edu")).toContain('<a href="https://finaid.ucla.edu/"');
    for (const value of ["Scam sites look like https://studentaid-gov.help.", "https://www.fastweb.com", "http://studentaid.gov"]) {
      expect(linked(value), value).toBe(escapeHtml(value));
    }
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
    for (const value of ["javascript:https://studentaid.gov", "data:text/html,https://studentaid.gov", "https://studentaid.gov@evil.example", "hxxps://studentaid.gov", "https://studentaid.gov.help"]) {
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
