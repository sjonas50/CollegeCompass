import { describe, expect, it, vi } from "vitest";
import { AID_GUIDE_SECTION_IDS, listSections, loadGuide } from "@/lib/aid-guide";
import { indexPage, sectionPage, text } from "./page-test-utils";

// The pages with a finished guide: all ten sections, reviewed by a counselor. The content files
// are swapped for fixtures, so this doesn't depend on the real content being written yet.

vi.mock("@/content/aid-guide/en.json", async () => ({ default: (await import("./page-fixtures")).finishedPageGuide("en") }));
vi.mock("@/content/aid-guide/es.json", async () => ({ default: (await import("./page-fixtures")).finishedPageGuide("es") }));

describe("the finished guide", () => {
  it("lists all ten sections in order", async () => {
    expect(listSections("en").map((s) => s.id)).toEqual(AID_GUIDE_SECTION_IDS);
    const html = await indexPage("en");
    const hrefs = [...html.matchAll(/href="(\/aid\/en\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(AID_GUIDE_SECTION_IDS.map((id) => `/aid/en/${id}`));
    expect(text(html)).toContain("Part 10 of 10");
  });

  it("credits the reviewer instead of showing the draft notice", async () => {
    expect(loadGuide("en").review.status).toBe("counselor-reviewed");
    const en = text(await indexPage("en"));
    expect(en).not.toContain("An experienced counselor is reviewing this guide");
    expect(en).toContain("Reviewed by Pat Rivera, school counselor on September 15, 2026.");
    const es = text(await indexPage("es"));
    expect(es).not.toContain("Un consejero con experiencia está revisando esta guía");
    expect(es).toContain("Revisado por Pat Rivera, school counselor el 15 de septiembre de 2026.");
    const section = text(await sectionPage("en", "loans-wisely"));
    expect(section).toContain("Reviewed by Pat Rivera, school counselor on September 15, 2026.");
    expect(section).not.toContain("An experienced counselor is reviewing this guide");
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
