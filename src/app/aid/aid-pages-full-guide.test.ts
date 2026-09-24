import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AID_GUIDE_SECTION_IDS, listSections } from "@/lib/aid-guide";
import AidGuideSectionPage from "./[lang]/[section]/page";
import AidGuideIndexPage from "./[lang]/page";

// The pages with a finished guide: all ten sections, reviewed by a counselor. The content files
// are swapped for fixtures, so this doesn't depend on the real content being written yet.

async function finishedGuide(lang: "en" | "es") {
  const { guideFixture } = await import("@/lib/aid-guide/fixtures");
  const { AID_GUIDE_SECTION_IDS: ids } = await import("@/lib/aid-guide/schema");
  const guide = guideFixture(lang, [...ids]);
  return {
    default: { ...guide, review: { status: "counselor-reviewed", reviewedBy: "Pat Rivera, school counselor", reviewedOn: "2026-10-15" } },
  };
}
vi.mock("@/content/aid-guide/en.json", () => finishedGuide("en"));
vi.mock("@/content/aid-guide/es.json", () => finishedGuide("es"));

const render = async (node: Promise<ReactNode> | ReactNode) => renderToStaticMarkup(await node);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const sectionPage = (lang: string, section: string) =>
  render(
    AidGuideSectionPage({
      params: Promise.resolve({ lang, section }),
      searchParams: Promise.resolve({}),
    } as PageProps<"/aid/[lang]/[section]">),
  );
const indexPage = (lang: string) =>
  render(AidGuideIndexPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) } as PageProps<"/aid/[lang]">));

describe("the finished guide", () => {
  it("lists all ten sections in order", async () => {
    expect(listSections("en").map((s) => s.id)).toEqual(AID_GUIDE_SECTION_IDS);
    const html = await indexPage("en");
    const hrefs = [...html.matchAll(/href="(\/aid\/en\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(AID_GUIDE_SECTION_IDS.map((id) => `/aid/en/${id}`));
    expect(text(html)).toContain("Part 10 of 10");
  });

  it("credits the reviewer instead of showing the draft notice", async () => {
    const en = text(await indexPage("en"));
    expect(en).not.toContain("An experienced counselor is reviewing this guide");
    expect(en).toContain("Reviewed by Pat Rivera, school counselor on October 15, 2026.");
    const es = text(await indexPage("es"));
    expect(es).not.toContain("Un consejero con experiencia está revisando esta guía");
    expect(es).toContain("Revisado por Pat Rivera, school counselor el 15 de octubre de 2026.");
  });

  it("offers a Print button on the FAFSA steps, and only there", async () => {
    const fafsa = await sectionPage("en", "fafsa-step-by-step");
    const button = /<button\b[^>]*>[\s\S]*?<\/button>/.exec(fafsa)?.[0] ?? "";
    expect(button).toContain('type="button"');
    expect(button).toMatch(/class="[^"]*\bmin-h-11\b[^"]*\bprint:hidden\b/);
    expect(text(button).trim()).toBe("Print");
    expect(await sectionPage("es", "fafsa-step-by-step")).toMatch(/<button[^>]*>[\s\S]*?Imprimir<\/button>/);
    for (const id of AID_GUIDE_SECTION_IDS.filter((id) => id !== "fafsa-step-by-step")) {
      expect(await sectionPage("en", id), id).not.toContain("<button");
    }
  });

  it("shows where a section sits in the guide and links both ways", async () => {
    const html = await sectionPage("es", "special-situations");
    expect(text(html)).toContain("Parte 3 de 10");
    expect(html).toMatch(/rel="prev"[^>]*href="\/aid\/es\/fafsa-step-by-step"|href="\/aid\/es\/fafsa-step-by-step"[^>]*rel="prev"/);
    expect(html).toMatch(/rel="next"[^>]*href="\/aid\/es\/pell-and-workforce-pell"|href="\/aid\/es\/pell-and-workforce-pell"[^>]*rel="next"/);
    const last = await sectionPage("en", "training-programs-and-apprenticeships");
    expect(last).not.toContain('rel="next"');
  });

  it("lists the section's headings under On this page", async () => {
    const html = await sectionPage("es", "loans-wisely");
    const onThisPage = /<nav aria-labelledby="on-this-page"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(text(onThisPage)).toContain("En esta página");
    const targets = [...onThisPage.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(targets).toEqual(["que-necesita", "pasos", "cuidado-con-las-estafas", "sources"]);
    for (const id of targets) expect(html).toContain(`<h2 id="${id}"`);
  });
});
