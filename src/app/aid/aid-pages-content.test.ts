import { describe, expect, it } from "vitest";
import { AID_GUIDE_LANGUAGES, getNeighbors, getSection, listSections, loadGuide } from "@/lib/aid-guide";
import { LANGUAGE_NAMES, aidText, formatGuideDate, otherLanguages } from "@/lib/aid-guide/dictionary";
import { guideTextSegments } from "@/lib/aid-guide/links";
import { headingAnchors } from "@/lib/aid-guide/navigation";
import { generateMetadata as sectionMetadata, generateStaticParams as sectionParams } from "./[lang]/[section]/page";
import {
  escapeHtml,
  expectHeadingsInOrder,
  expectLanguageLink,
  indexPage,
  linkTo,
  linksTo,
  sectionPage,
  sectionProps,
  text,
} from "./page-test-utils";

// Renders every page of the real guide in src/content/aid-guide and checks that all of it made it
// onto the page. Only structure is checked, never the wording, so any valid content passes: a
// draft or a counselor-reviewed guide, with one section or all ten. The page rules themselves are
// tested with fixtures in aid-pages.test.ts and aid-pages-full-guide.test.ts.

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe.each(AID_GUIDE_LANGUAGES)("the guide as written, in %s", (lang) => {
  const guide = loadGuide(lang);
  const sections = listSections(lang);

  it("has an index page that links every section and says how current it is", async () => {
    const html = await indexPage(lang);
    const words = text(html);
    for (const section of sections) {
      expect(linkTo(html, section.href)).toContain(escapeHtml(section.title));
      expect(words).toContain(squash(section.summary));
    }
    expect(html).toContain(`<time dateTime="${guide.updated}">${formatGuideDate(guide.updated, lang)}</time>`);
    const { review } = guide;
    if (review.status === "draft") {
      expect(words).toContain(aidText(lang, "draftBanner"));
    } else {
      expect(words).not.toContain(aidText(lang, "draftBanner"));
      expect(words).toContain(aidText(lang, "reviewedBy", { name: review.reviewedBy ?? "", date: formatGuideDate(review.reviewedOn ?? "", lang) }));
    }
    for (const other of otherLanguages(lang)) expectLanguageLink(html, `/aid/${other}`, other, LANGUAGE_NAMES[other]);
    expectHeadingsInOrder(html);
  });

  it("builds a page for every section", () => {
    expect(sectionParams({ params: { lang } })).toEqual(sections.map((s) => ({ section: s.id })));
  });

  it.each(sections.map((s) => s.id))("shows all of section %s", async (id) => {
    const section = getSection(lang, id)!;
    const html = await sectionPage(lang, id);
    const words = text(html);

    expect(words).toContain(squash(section.title));
    expect(words).toContain(squash(section.summary));
    expect((await sectionMetadata(sectionProps(lang, id))).title).toBe(section.title);

    const anchors = headingAnchors(section.blocks);
    section.blocks.forEach((block, i) => {
      if (block.heading) expect(html).toContain(`<h2 id="${anchors[i]}"`);
      for (const line of "text" in block ? [block.text] : block.items) {
        for (const segment of guideTextSegments(line, section.sources)) {
          if (segment.type === "link") expect(linksTo(html, escapeHtml(segment.href)).length, segment.href).toBeGreaterThan(0);
          else if (squash(segment.text)) expect(words).toContain(squash(segment.text));
        }
      }
    });

    for (const source of section.sources) {
      const a = linksTo(html, escapeHtml(source.url)).find((link) => text(link).includes(squash(source.title)));
      expect(a, source.url).toMatch(/target="_blank" rel="noopener noreferrer"/);
      expect(html).toContain(`<span class="hidden break-all print:inline"> (${escapeHtml(source.url)})</span>`);
    }

    const onThisPage = /<nav aria-labelledby="on-this-page"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    for (const [, target] of onThisPage.matchAll(/href="#([^"]+)"/g)) expect(html).toContain(` id="${target}"`);

    const neighbors = getNeighbors(lang, id);
    if (neighbors?.prev) expect(linkTo(html, neighbors.prev.href)).toContain('rel="prev"');
    else expect(html).not.toContain('rel="prev"');
    if (neighbors?.next) expect(linkTo(html, neighbors.next.href)).toContain('rel="next"');
    else expect(html).not.toContain('rel="next"');
    for (const other of otherLanguages(lang)) expectLanguageLink(html, `/aid/${other}/${id}`, other, LANGUAGE_NAMES[other]);
    expectHeadingsInOrder(html);
  });
});
