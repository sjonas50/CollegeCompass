import enContent from "@/content/aid-guide/en.json";
import esContent from "@/content/aid-guide/es.json";
import { aidGuideHref, neighborsIn } from "./navigation";
import {
  AID_GUIDE_LANGUAGES,
  AID_GUIDE_SECTION_IDS,
  type AidGuide,
  type AidGuideSection,
  type AidGuideSectionId,
  type AidLanguage,
} from "./schema";
import { validateGuides } from "./validate";

// The financial aid guide, in every language.
//
// Content lives in src/content/aid-guide/<language>.json (format: ./schema.ts). It is validated
// once, when this module is first imported: a malformed file, sections that differ between
// languages, or an address that won't link throws an AidGuideContentError. The tests import this
// module, and `next build` imports it to prerender every page, so bad content fails both.

const GUIDES = validateGuides({ en: enContent, es: esContent });

export { AID_GUIDE_LANGUAGES, AID_GUIDE_SECTION_IDS };
export type { AidGuide, AidGuideBlock, AidGuideSection, AidGuideSectionId, AidGuideSource, AidLanguage } from "./schema";
export { AidGuideContentError } from "./validate";
export { aidGuideHref } from "./navigation";

/** A section as other pages link to it. */
export type AidGuideSectionLink = { id: AidGuideSectionId; title: string; summary: string; href: string };

/** Sections that get a Print button (they work as a checklist on paper). */
export const PRINTABLE_SECTIONS: ReadonlySet<AidGuideSectionId> = new Set(["fafsa-step-by-step"]);

export function isAidLanguage(value: string): value is AidLanguage {
  return (AID_GUIDE_LANGUAGES as readonly string[]).includes(value);
}

/** The whole guide in one language, already validated. */
export function loadGuide(lang: AidLanguage): AidGuide {
  return GUIDES[lang];
}

/** One section by id, or undefined if the guide doesn't have it (yet). */
export function getSection(lang: AidLanguage, id: string): AidGuideSection | undefined {
  return GUIDES[lang].sections.find((s) => s.id === id);
}

/** Every section the guide has now, in order, with its title, summary and page address. */
export function listSections(lang: AidLanguage): AidGuideSectionLink[] {
  return GUIDES[lang].sections.map(({ id, title, summary }) => ({ id, title, summary, href: aidGuideHref(lang, id) }));
}

/** The sections before and after `id` (null at either end), or null if there is no such section. */
export function getNeighbors(
  lang: AidLanguage,
  id: string,
): { prev: AidGuideSectionLink | null; next: AidGuideSectionLink | null } | null {
  return neighborsIn(listSections(lang), id);
}

/** Every page of the guide, for generateStaticParams. */
export function aidGuidePageParams(): { lang: AidLanguage; section: AidGuideSectionId }[] {
  return AID_GUIDE_LANGUAGES.flatMap((lang) => GUIDES[lang].sections.map((s) => ({ lang, section: s.id })));
}
