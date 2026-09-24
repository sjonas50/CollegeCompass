import { contentFingerprint } from "./fingerprint";
import { guideTextSegments } from "./links";
import { type TextSegment, findAddresses, linkify, toSafeHref } from "./linkify";
import { AID_GUIDE_LANGUAGES, type AidGuide, type AidGuideSource, type AidLanguage, parseGuide } from "./schema";

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

/** Where each link starts and ends in the text it came from. */
function positioned(segments: TextSegment[]) {
  let cursor = 0;
  return segments.flatMap((segment) => {
    const start = cursor;
    cursor += segment.text.length;
    return segment.type === "link" ? [{ ...segment, start, end: cursor }] : [];
  });
}

// A link that ends at a quote or angle bracket with more address right after it ("…/parent's-guide")
// would only link part of what was written.
const CUT_SHORT = /^["'`<>][^\s.,;:!?)\]}"'`<>”’»]/u;

/**
 * Checks the web addresses written inside the guide. Block text and list items may hold bare
 * https addresses that become links (see ./links.ts); titles, summaries and headings may not,
 * because they are shown inside other links. Every address written must become a link, all of it.
 * An address that shouldn't be clickable (a scam example) is written without "https://".
 */
export function checkInlineLinks(guide: AidGuide, label = fileLabel(guide.language)): string[] {
  const issues: string[] = [];
  const noAddresses = (text: string | undefined, path: string) => {
    if (text && findAddresses(text).length) issues.push(`${label} ${path}: Titles, summaries and headings can't hold web addresses.`);
  };
  const linkable = (text: string, sources: AidGuideSource[], path: string) => {
    const issue = (message: string) => issues.push(`${label} ${path}: ${message}`);
    const links = positioned(linkify(text));
    const shown = new Set(positioned(guideTextSegments(text, sources)).map((link) => link.start));
    for (const link of links) {
      const written = text.slice(link.start).split(/\s/)[0].replace(/[.,;:!?]+$/, "");
      if (CUT_SHORT.test(text.slice(link.end, link.end + 2))) {
        issue(
          `Only "${link.text}" of "${written}" would become a link, because a web address ends at a quote or apostrophe. ` +
            "Put a space after the address, or write an apostrophe inside it as %27.",
        );
      }
      if (!link.href.startsWith("https://")) {
        issue(`Use https:// for ${link.text}.`);
      } else if (!shown.has(link.start)) {
        issue(
          `${link.text} won't become a link: it isn't a .gov or .edu site or one of this section's sources. ` +
            `If readers should go there, add the site to the section's "sources". If it's an example of a fake site, ` +
            `leave off the "https://" (write ${link.text.replace(/^https:\/\//, "")}) so it shows as plain text.`,
        );
      }
    }
    for (const { index, address } of findAddresses(text)) {
      if (!links.some((link) => index >= link.start && index < link.end)) {
        issue(`"${address}" won't become a link. Put a space before it and use a real https:// address.`);
      }
    }
  };
  guide.sections.forEach((section, i) => {
    noAddresses(section.title, `sections.${i}.title`);
    noAddresses(section.summary, `sections.${i}.summary`);
    section.blocks.forEach((block, j) => {
      const path = `sections.${i}.blocks.${j}`;
      noAddresses(block.heading, `${path}.heading`);
      if ("text" in block) linkable(block.text, section.sources, `${path}.text`);
      else block.items.forEach((item, k) => linkable(item, section.sources, `${path}.items.${k}`));
    });
  });
  return issues;
}

/**
 * The latest date it is anywhere on Earth (UTC+14), as YYYY-MM-DD. A date after this hasn't
 * started anywhere yet, whatever time zone the author or the build is in.
 */
export function latestToday(now: Date): string {
  return new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Checks the guide's dates and review credit: no date in the future, and a counselor-reviewed
 * guide must still be the one the counselor read. Its "contentFingerprint" has to match the
 * sections, and "updated" can't be after "reviewedOn".
 */
export function checkReview(guide: AidGuide, label: string, now: Date): string[] {
  const issues: string[] = [];
  const today = latestToday(now);
  const { updated, review } = guide;
  if (updated > today) issues.push(`${label} updated: ${updated} is in the future. Use the date the guide last changed.`);
  if (review.reviewedOn && review.reviewedOn > today) {
    issues.push(`${label} review.reviewedOn: ${review.reviewedOn} is in the future. Use the date the counselor reviewed the guide.`);
  }
  if (review.status !== "counselor-reviewed") return issues;

  const backToDraft = `Set "status" to "draft" until a counselor reviews the changes.`;
  if (review.reviewedOn && updated > review.reviewedOn) {
    issues.push(
      `${label} updated: The guide changed on ${updated}, after the counselor reviewed it on ${review.reviewedOn}. ` +
        `${backToDraft} Then set "reviewedOn" to the new review date.`,
    );
  }
  const fingerprint = contentFingerprint(guide);
  if (!review.contentFingerprint) {
    issues.push(
      `${label} review.contentFingerprint: Record which version the counselor reviewed. ` +
        `If they reviewed the sections exactly as they are now, add "contentFingerprint": "${fingerprint}".`,
    );
  } else if (review.contentFingerprint !== fingerprint) {
    issues.push(
      `${label} review.contentFingerprint: The sections changed after the counselor reviewed them. ${backToDraft} ` +
        `Once they have, set "reviewedOn" to that date and "contentFingerprint" to "${fingerprint}".`,
    );
  }
  return issues;
}

/**
 * Validates every language's raw content and checks them against each other. Returns the parsed
 * guides, or throws an AidGuideContentError listing every problem. `now` is for the date checks.
 */
export function validateGuides(
  raw: Record<AidLanguage, unknown>,
  { now = new Date() }: { now?: Date } = {},
): Record<AidLanguage, AidGuide> {
  const issues: string[] = [];
  const parsed: Partial<Record<AidLanguage, AidGuide>> = {};
  for (const lang of AID_GUIDE_LANGUAGES) {
    const result = parseGuide(raw[lang], lang, fileLabel(lang));
    if (result.ok) parsed[lang] = result.guide;
    else issues.push(...result.issues);
  }
  if (issues.length) throw new AidGuideContentError(issues);
  const guides = parsed as Record<AidLanguage, AidGuide>;
  issues.push(...checkParity(guides));
  for (const lang of AID_GUIDE_LANGUAGES) {
    issues.push(...checkInlineLinks(guides[lang], fileLabel(lang)), ...checkReview(guides[lang], fileLabel(lang), now));
  }
  if (issues.length) throw new AidGuideContentError(issues);
  return guides;
}
