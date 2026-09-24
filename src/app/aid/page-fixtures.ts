import { guideFixture, reviewedFixture } from "@/lib/aid-guide/fixtures";
import { AID_GUIDE_SECTION_IDS, type AidGuide, type AidLanguage } from "@/lib/aid-guide/schema";

// Guide content for the page tests, which swap it in for src/content/aid-guide/*.json so they
// don't depend on what the real content says. Not used by the app.

/** Text with every character HTML escapes (< > & " '), an official link and a source's link. */
const TRICKY = {
  en: {
    heading: "Who gets a Pell Grant",
    text: 'Most Pell Grant students have family incomes <$60,000 and pay >$0 after grants & scholarships. Apply at https://studentaid.gov and read "Paying for college" at https://www.consumerfinance.gov/paying-for-college/.',
    listHeading: "What you'll need",
    items: ["Your parents' tax return", "Search for scholarships at https://www.careeronestop.org/toolkit/training/find-scholarships.aspx."],
    warningHeading: "Scam sites",
    warning: 'Fake sites copy real names, like studentaid-gov.help. A real address starts with "https://" and ends in .gov.',
    tip: "Start early.",
    sourceTitle: "College Navigator: colleges in California & nearby",
  },
  es: {
    heading: "Quién recibe una Beca Pell",
    text: 'La mayoría de los estudiantes con Beca Pell tienen ingresos familiares <$60,000 y pagan >$0 después de becas & subvenciones. Solicítela en https://studentaid.gov/es y lea "Cómo pagar la universidad" en https://www.consumerfinance.gov/paying-for-college/.',
    listHeading: "Lo que va a necesitar",
    items: ["La declaración de impuestos de sus padres", "Busque becas en https://www.careeronestop.org/toolkit/training/find-scholarships.aspx."],
    warningHeading: "Sitios falsos",
    warning: 'Los sitios falsos copian nombres reales, como studentaid-gov.help. Una dirección real empieza con "https://" y termina en .gov.',
    tip: "Empiece temprano.",
    sourceTitle: "College Navigator: universidades en California & cerca",
  },
};

/** A source address with a query string, whose & the page has to escape. */
export const QUERY_SOURCE_URL = "https://nces.ed.gov/collegenavigator/?s=CA&l=93";

/**
 * A draft guide with three of the planned sections (so "fafsa-step-by-step", for one, is still
 * missing). The first section holds the tricky text above.
 */
export function draftPageGuide(lang: AidLanguage): AidGuide {
  const t = TRICKY[lang];
  const guide = guideFixture(lang, ["how-aid-works", "special-situations", "comparing-aid-offers"]);
  guide.sections[0].blocks = [
    { kind: "paragraph", heading: t.heading, text: t.text },
    { kind: "list", heading: t.listHeading, items: t.items },
    { kind: "warning", heading: t.warningHeading, text: t.warning },
    { kind: "tip", text: t.tip },
  ];
  guide.sections[0].sources = [
    { title: t.sourceTitle, url: QUERY_SOURCE_URL },
    { title: "Federal Student Aid", url: "https://studentaid.gov/" },
    { title: "CareerOneStop", url: "https://www.careeronestop.org/" },
  ];
  return guide;
}

/** All ten sections, reviewed by a counselor. */
export function finishedPageGuide(lang: AidLanguage): AidGuide {
  return reviewedFixture(guideFixture(lang, [...AID_GUIDE_SECTION_IDS]), "2026-09-15", "Pat Rivera, school counselor");
}
