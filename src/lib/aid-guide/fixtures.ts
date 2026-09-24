import { contentFingerprint } from "./fingerprint";
import type { AidGuide, AidGuideBlock, AidGuideSection, AidGuideSectionId, AidLanguage } from "./schema";

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

/** The guide marked as reviewed by a counselor on `reviewedOn`, with the fingerprint of its sections. */
export function reviewedFixture(guide: AidGuide, reviewedOn = "2026-09-15", reviewedBy = "Pat Rivera, school counselor"): AidGuide {
  return { ...guide, review: { status: "counselor-reviewed", reviewedBy, reviewedOn, contentFingerprint: contentFingerprint(guide) } };
}

// The same sentence in each language, as a translator would write it.
const SENTENCE = {
  en: "The Student Aid Index is a number that colleges use to decide how much financial aid you can get.",
  es: "El Índice de Ayuda Estudiantil (SAI) es un número que las universidades usan para decidir cuánta ayuda financiera puede recibir usted.",
};

/**
 * Realistic guide text: about `n` words of English, or the same text in Spanish, which comes out
 * about 30% longer (as a faithful translation does). Ends with a period.
 */
export function wordsOf(lang: AidLanguage, n: number): string {
  const words = SENTENCE[lang].split(" ");
  const count = lang === "es" ? Math.round(n * 1.05) : n;
  const out = Array.from({ length: count }, (_, i) => words[i % words.length]);
  return `${out.join(" ").replace(/[.,]$/, "")}.`;
}

/**
 * A section longer than the finished guide's longest ones: about 850 words in 12 blocks, one of
 * them a 300-word paragraph, with 8 sources. The Spanish one is longer, as real Spanish is.
 */
export function finishedSectionFixture(id: AidGuideSectionId, lang: AidLanguage = "en"): AidGuideSection {
  const w = (n: number) => wordsOf(lang, n);
  const items = (count: number, n: number) => Array.from({ length: count }, () => w(n));
  const es = lang === "es";
  const blocks: AidGuideBlock[] = [
    { kind: "paragraph", heading: es ? "Qué es el Índice de Ayuda Estudiantil y cómo se calcula" : "What the Student Aid Index is and how it's figured out", text: w(300) },
    { kind: "steps", heading: es ? "Cómo llenar el formulario paso a paso" : "How to fill out the form, step by step", items: items(8, 20) },
    { kind: "list", heading: es ? "Qué necesita tener a mano" : "What to have ready", items: items(6, 8) },
    { kind: "tip", text: w(30) },
    { kind: "warning", heading: es ? "Cuidado con las estafas" : "Watch out for scams", text: w(40) },
    { kind: "paragraph", text: w(60) },
    { kind: "list", items: items(4, 6) },
    { kind: "tip", heading: es ? "Si sus padres no tienen número de Seguro Social" : "If your parents don't have a Social Security number", text: w(20) },
    { kind: "paragraph", heading: es ? "Después de enviarlo" : "After you send it", text: w(30) },
    { kind: "steps", items: items(3, 5) },
    { kind: "warning", text: `${w(12)} ${es ? "Las páginas falsas copian nombres reales, como studentaid-gov.help." : "Fake sites copy real names, like studentaid-gov.help."}` },
    { kind: "paragraph", heading: es ? "Dónde obtener ayuda" : "Where to get help", text: `${w(15)} https://studentaid.gov/h/apply-for-aid/fafsa` },
  ];
  const source = (title: string, url: string) => ({ title: es ? `${title} (en español)` : title, url });
  return {
    id,
    title: es ? "Cómo llenar la FAFSA paso a paso, desde la cuenta hasta la oferta de ayuda" : "Filling out the FAFSA step by step, from your account to your aid offer",
    summary: wordsOf(lang, 30),
    blocks,
    sources: [
      source("Federal Student Aid: Filling out the FAFSA", "https://studentaid.gov/apply-for-aid/fafsa/filling-out"),
      source("Federal Student Aid: FAFSA deadlines", "https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines"),
      source("Federal Student Aid: The Student Aid Index", "https://studentaid.gov/help-center/answers/article/what-is-sai"),
      source("Consumer Financial Protection Bureau: Paying for college", "https://www.consumerfinance.gov/paying-for-college/"),
      source("Federal Trade Commission: Scholarship and financial aid scams", "https://consumer.ftc.gov/articles/how-avoid-scholarship-financial-aid-scams"),
      source("College Board: CSS Profile", "https://cssprofile.collegeboard.org/"),
      source("U.S. Department of Labor: Apprenticeship.gov", "https://www.apprenticeship.gov/"),
      source("CareerOneStop: Scholarship Finder", "https://www.careeronestop.org/toolkit/training/find-scholarships.aspx"),
    ],
  };
}
