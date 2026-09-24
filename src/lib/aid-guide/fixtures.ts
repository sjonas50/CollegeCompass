import type { AidGuide, AidGuideSection, AidGuideSectionId, AidLanguage } from "./schema";

// Small, valid guide content for tests. Not used by the app.

export function sectionFixture(id: AidGuideSectionId, lang: AidLanguage = "en"): AidGuideSection {
  const es = lang === "es";
  return {
    id,
    title: es ? `Sección ${id}` : `Section ${id}`,
    summary: es ? "Una oración que resume la sección." : "One sentence that sums up the section.",
    blocks: [
      { kind: "paragraph", text: es ? "Vea https://studentaid.gov/es para más detalles." : "See https://studentaid.gov for details." },
      { kind: "list", heading: es ? "Qué necesita" : "What you need", items: ["A", "B"] },
      { kind: "steps", heading: es ? "Pasos" : "Steps", items: [es ? "Cree su cuenta." : "Make your account.", es ? "Llene el formulario." : "Fill out the form."] },
      { kind: "tip", text: es ? "Empiece temprano." : "Start early." },
      { kind: "warning", heading: es ? "Cuidado con las estafas" : "Watch for scams", text: es ? "La FAFSA es gratis." : "The FAFSA is free." },
    ],
    sources: [{ title: "Federal Student Aid", url: "https://studentaid.gov/" }],
  };
}

export function guideFixture(
  lang: AidLanguage = "en",
  ids: AidGuideSectionId[] = ["how-aid-works", "comparing-aid-offers"],
): AidGuide {
  return {
    language: lang,
    updated: "2026-09-01",
    review: { status: "draft" },
    sections: ids.map((id) => sectionFixture(id, lang)),
  };
}
