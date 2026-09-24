import { findAddresses, linkify, toSafeHref } from "./linkify";
import { AID_GUIDE_LANGUAGES, type AidGuide, type AidLanguage, parseGuide } from "./schema";

/** Thrown when a content file is invalid. The message lists every problem found. */
export class AidGuideContentError extends Error {
  constructor(readonly issues: string[]) {
    super(`The financial aid guide content has ${issues.length} problem(s):\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "AidGuideContentError";
  }
}

const fileLabel = (lang: AidLanguage) => `${lang}.json`;

/**
 * Checks that every language tells the same guide: the same section ids in the same order, each
 * file's "language" matching its name, and every source an https address.
 */
export function checkParity(guides: Record<AidLanguage, AidGuide>): string[] {
  const issues: string[] = [];
  const [base, ...others] = AID_GUIDE_LANGUAGES;
  const baseIds = guides[base].sections.map((s) => s.id);
  for (const lang of AID_GUIDE_LANGUAGES) {
    if (guides[lang].language !== lang) {
      issues.push(`${fileLabel(lang)}: "language" is "${guides[lang].language}", but this is the "${lang}" file.`);
    }
    guides[lang].sections.forEach((section, i) =>
      section.sources.forEach((source, j) => {
        if (!toSafeHref(source.url, { requireHttps: true })) {
          issues.push(`${fileLabel(lang)} sections.${i}.sources.${j}.url: Use a full https:// address.`);
        }
      }),
    );
  }
  for (const lang of others) {
    const ids = guides[lang].sections.map((s) => s.id);
    if (ids.join(",") !== baseIds.join(",")) {
      issues.push(
        `${fileLabel(lang)}: sections must match ${fileLabel(base)} (same ids, same order). ` +
          `${fileLabel(base)} has [${baseIds.join(", ")}]; ${fileLabel(lang)} has [${ids.join(", ")}].`,
      );
    }
  }
  return issues;
}

/**
 * Checks the web addresses written inside the guide. Block text and list items may hold bare
 * https addresses (they become links); titles, summaries and headings may not, because they are
 * shown inside other links. Every address must be one `linkify` will actually link.
 */
export function checkInlineLinks(guide: AidGuide, label = fileLabel(guide.language)): string[] {
  const issues: string[] = [];
  const noAddresses = (text: string | undefined, path: string) => {
    if (text && findAddresses(text).length) issues.push(`${label} ${path}: Titles, summaries and headings can't hold web addresses.`);
  };
  const linkable = (text: string, path: string) => {
    const links = linkify(text).flatMap((s) => (s.type === "link" ? [s] : []));
    const written = findAddresses(text);
    if (links.length < written.length) {
      issues.push(`${label} ${path}: "${written.join(" ")}" won't become a link. Put a space before it and use a real https:// address.`);
    }
    for (const link of links) {
      if (!link.href.startsWith("https://")) issues.push(`${label} ${path}: Use https:// for ${link.text}.`);
    }
  };
  guide.sections.forEach((section, i) => {
    noAddresses(section.title, `sections.${i}.title`);
    noAddresses(section.summary, `sections.${i}.summary`);
    section.blocks.forEach((block, j) => {
      const path = `sections.${i}.blocks.${j}`;
      noAddresses(block.heading, `${path}.heading`);
      if ("text" in block) linkable(block.text, `${path}.text`);
      else block.items.forEach((item, k) => linkable(item, `${path}.items.${k}`));
    });
  });
  return issues;
}

/**
 * Validates every language's raw content and checks them against each other. Returns the parsed
 * guides, or throws an AidGuideContentError listing every problem.
 */
export function validateGuides(raw: Record<AidLanguage, unknown>): Record<AidLanguage, AidGuide> {
  const issues: string[] = [];
  const parsed: Partial<Record<AidLanguage, AidGuide>> = {};
  for (const lang of AID_GUIDE_LANGUAGES) {
    const result = parseGuide(raw[lang], fileLabel(lang));
    if (result.ok) parsed[lang] = result.guide;
    else issues.push(...result.issues);
  }
  if (issues.length) throw new AidGuideContentError(issues);
  const guides = parsed as Record<AidLanguage, AidGuide>;
  issues.push(...checkParity(guides));
  for (const lang of AID_GUIDE_LANGUAGES) issues.push(...checkInlineLinks(guides[lang], fileLabel(lang)));
  if (issues.length) throw new AidGuideContentError(issues);
  return guides;
}
