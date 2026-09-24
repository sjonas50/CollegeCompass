import { AID_GUIDE_LANGUAGES, type AidLanguage } from "./schema";

// Page chrome for the financial aid guide (headings, buttons, labels). The guide's own words live
// in src/content/aid-guide/*.json. Placeholders like {date} are filled in by `aidText`.

const en = {
  guideTitle: "Financial aid guide",
  metaDescription:
    "A plain-language guide to paying for college or career training: the FAFSA, the CSS Profile, fee waivers, scholarships and comparing aid offers.",
  introLead: "Paying for college or career training can feel confusing. Help is out there, and this guide walks you through it step by step.",
  introAudience:
    "It's for 11th and 12th graders and their parents or guardians. You don't need an account to read it, and you can share it with anyone.",
  introPaths: "Financial aid can help pay for a four-year college, a community college or a career training program.",
  introStart: "Start at the top, or jump to the part you need.",
  sectionsHeading: "What's in this guide",
  draftBanner: "An experienced counselor is reviewing this guide. Double-check dates with official sites.",
  reviewedBy: "Reviewed by {name} on {date}.",
  lastUpdated: "Last updated",
  onThisPage: "On this page",
  sources: "Sources",
  sourcesHeading: "Where this information comes from",
  previous: "Previous",
  next: "Next",
  sectionNav: "More of the guide",
  allSections: "All guide sections",
  partOf: "Part {n} of {total}",
  print: "Print",
  tip: "Tip",
  warning: "Be careful",
  opensInNewTab: "(opens in a new tab)",
  language: "Language",
  notFoundTitle: "We couldn't find that page",
  notFoundBody: "That part of the financial aid guide may have moved.",
  notFoundLink: "Go to the financial aid guide",
} as const;

export type AidTextKey = keyof typeof en;

const es: Record<AidTextKey, string> = {
  guideTitle: "Guía de ayuda financiera",
  metaDescription:
    "Una guía en palabras sencillas para pagar la universidad o un programa técnico: la FAFSA, el CSS Profile, las exenciones de cuotas, las becas y cómo comparar ofertas de ayuda.",
  introLead: "Pagar la universidad o un programa técnico puede parecer complicado. Hay ayuda disponible, y esta guía le explica cada paso.",
  introAudience:
    "Es para estudiantes de 11.º y 12.º grado y sus padres o tutores. No necesita una cuenta para leerla y puede compartirla con quien quiera.",
  introPaths: "La ayuda financiera puede pagar una universidad de cuatro años, un colegio comunitario o un programa de formación técnica.",
  introStart: "Empiece por el principio o vaya directo a la parte que necesita.",
  sectionsHeading: "Qué incluye esta guía",
  draftBanner: "Un consejero con experiencia está revisando esta guía. Confirme las fechas en los sitios oficiales.",
  reviewedBy: "Revisado por {name} el {date}.",
  lastUpdated: "Última actualización",
  onThisPage: "En esta página",
  sources: "Fuentes",
  sourcesHeading: "De dónde viene esta información",
  previous: "Anterior",
  next: "Siguiente",
  sectionNav: "Más de la guía",
  allSections: "Todas las secciones de la guía",
  partOf: "Parte {n} de {total}",
  print: "Imprimir",
  tip: "Consejo",
  warning: "Atención",
  opensInNewTab: "(se abre en una pestaña nueva)",
  language: "Idioma",
  notFoundTitle: "No encontramos esa página",
  notFoundBody: "Es posible que esa parte de la guía de ayuda financiera haya cambiado de lugar.",
  notFoundLink: "Ir a la guía de ayuda financiera",
};

export const AID_TEXT: Record<AidLanguage, Record<AidTextKey, string>> = { en, es };

/** Each language's name, written in that language (for the language switch). */
export const LANGUAGE_NAMES: Record<AidLanguage, string> = { en: "English", es: "Español" };

const LOCALES: Record<AidLanguage, string> = { en: "en-US", es: "es-US" };

/** A chrome string with its {placeholders} filled in. Unknown placeholders are left as written. */
export function aidText(lang: AidLanguage, key: AidTextKey, vars: Record<string, string | number> = {}): string {
  return AID_TEXT[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** The placeholder names in a string, sorted: "Reviewed by {name} on {date}." → ["date", "name"]. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/** "2026-09-23" → "September 23, 2026" / "23 de septiembre de 2026". The date never shifts by time zone. */
export function formatGuideDate(isoDate: string, lang: AidLanguage): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALES[lang], { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** The guide's other languages, for the language switch. */
export function otherLanguages(lang: AidLanguage): AidLanguage[] {
  return AID_GUIDE_LANGUAGES.filter((l) => l !== lang);
}
