import { z } from "zod";
import { toSafeHref } from "./linkify";

// ---------------------------------------------------------------------------
// The financial aid guide's content format. One JSON file per language lives in
// src/content/aid-guide/<language>.json; ./index.ts loads and checks them.
//
// {
//   "language": "en" | "es",
//   "updated": "YYYY-MM-DD",
//   "review": { "status": "draft" | "counselor-reviewed", "reviewedBy"?: "...", "reviewedOn"?: "YYYY-MM-DD",
//               "contentFingerprint"?: "16 letters and digits" },
//   "sections": [{
//     "id": one of AID_GUIDE_SECTION_IDS (below), in that order,
//     "title": "...", "summary": "One sentence.",
//     "blocks": [{ "kind": "paragraph" | "tip" | "warning", "heading"?: "...", "text": "..." }
//              | { "kind": "list" | "steps", "heading"?: "...", "items": ["...", "..."] }],
//     "sources": [{ "title": "...", "url": "https://..." }]
//   }]
// }
//
// Rules the checks enforce:
// - Plain text only. No HTML or Markdown, and no line breaks: each paragraph is its own block and
//   each list item its own item.
// - Links: write a bare address (https://studentaid.gov) with a space or an opening bracket/quote
//   before it. Every address written with https:// must become a link, so it has to go to a .gov
//   or .edu site or to a site in the section's "sources". To show an address that must not be
//   clicked (a scam example), leave off the "https://": "studentaid-gov.help" stays plain text.
//   Writing just "https://" (as in "starts with https://") is fine. No addresses in titles,
//   summaries or headings.
// - Length limits are in LENGTH_LIMITS; Spanish gets more room than English.
// - "draft" shows a review notice. "counselor-reviewed" needs "reviewedBy", "reviewedOn" and
//   "contentFingerprint" (the check tells you the value to use). If the sections change after the
//   review, the fingerprint no longer matches: set "status" back to "draft" until a counselor
//   reviews the change. "updated" can't be after "reviewedOn", and no date can be in the future.
// - en.json and es.json have the same section ids in the same order.
//
// To replace the content, overwrite both files and run `npx vitest run src/lib/aid-guide src/app/aid`:
// any problem is listed with its file and path (e.g. "es.json sections.2.blocks.0.text: ...").
// `next build` fails on the same problems. No code changes are needed.
// ---------------------------------------------------------------------------

export const AID_GUIDE_LANGUAGES = ["en", "es"] as const;
export type AidLanguage = (typeof AID_GUIDE_LANGUAGES)[number];

/**
 * Every section of the finished guide, in reading order. Content files may hold fewer while they
 * are drafts, but only these ids, in this order, so links to a section (from the counselor, the
 * roadmap, …) keep working. To add a section, add its id here first.
 */
export const AID_GUIDE_SECTION_IDS = [
  "how-aid-works",
  "fafsa-step-by-step",
  "special-situations",
  "pell-and-workforce-pell",
  "state-aid-and-promise-programs",
  "css-profile-and-fee-waivers",
  "scholarships-and-scams",
  "loans-wisely",
  "comparing-aid-offers",
  "training-programs-and-apprenticeships",
] as const;
export type AidGuideSectionId = (typeof AID_GUIDE_SECTION_IDS)[number];

export const REVIEW_STATUSES = ["draft", "counselor-reviewed"] as const;

type TextField = "title" | "summary" | "heading" | "text" | "item" | "sourceTitle" | "reviewedBy";

/**
 * The most characters each kind of text may have. They catch pasted-in mistakes (a whole section
 * in one paragraph), not normal writing: a 400-word English paragraph fits. Spanish runs longer
 * than English, about 25–30% for paragraphs and often 50% for a short title or sentence, so it
 * gets a third more room (half again for titles and summaries).
 */
export const LENGTH_LIMITS: Record<AidLanguage, Record<TextField, number>> = {
  en: { title: 100, summary: 240, heading: 120, text: 2500, item: 1000, sourceTitle: 200, reviewedBy: 120 },
  es: { title: 150, summary: 360, heading: 160, text: 3400, item: 1350, sourceTitle: 270, reviewedBy: 160 },
};

const HTML_TAG = /<\/?[a-z][^>]*>/i;
const MARKDOWN = /\]\(|\*\*|^#{1,6}\s/m;
// Browsers show a line break inside a paragraph as a space, so text with one would run together.
const LINE_BREAK = /[\r\n\v\f\u2028\u2029]/;

/** Plain text: trimmed, not empty, one paragraph, and no HTML or Markdown (neither is rendered). */
function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1, "Can't be empty.")
    .max(max, { error: (issue) => `Keep this to ${max} characters or fewer. It has ${String(issue.input).length}.` })
    .refine(
      (s) => !LINE_BREAK.test(s),
      "No line breaks: they don't show on the page, so the words would run together. Put each paragraph in its own block, and each list item in its own item.",
    )
    .refine((s) => !HTML_TAG.test(s), "Plain text only: HTML tags would show up as typed. Write links as bare addresses like https://studentaid.gov.")
    .refine((s) => !MARKDOWN.test(s), "Plain text only: Markdown isn't rendered. Write links as bare addresses like https://studentaid.gov.");
}

const IsoDate = z.iso.date({ error: "Use a real date written YYYY-MM-DD, like 2026-10-01." });

/** The fingerprint of the sections a counselor reviewed (see ./fingerprint.ts). */
export const FINGERPRINT = /^[0-9a-f]{16}$/;

const SectionId = z.enum(AID_GUIDE_SECTION_IDS, {
  error: (issue) =>
    `Unknown section id ${JSON.stringify(issue.input)}. Use one of the ids in AID_GUIDE_SECTION_IDS (src/lib/aid-guide/schema.ts), or add the new id there first.`,
});

/** The content format, with the length limits for one language. */
function guideSchema(lang: AidLanguage) {
  const limit = LENGTH_LIMITS[lang];
  const heading = plainText(limit.heading).optional();

  const textBlock = <K extends "paragraph" | "tip" | "warning">(kind: K) =>
    z.strictObject({ kind: z.literal(kind), heading, text: plainText(limit.text) });
  const itemsBlock = <K extends "list" | "steps">(kind: K) =>
    z.strictObject({
      kind: z.literal(kind),
      heading,
      items: z.array(plainText(limit.item)).min(1, "A list needs at least one item."),
    });

  const block = z.discriminatedUnion("kind", [
    textBlock("paragraph"),
    textBlock("tip"),
    textBlock("warning"),
    itemsBlock("list"),
    itemsBlock("steps"),
  ]);

  const source = z.strictObject({
    title: plainText(limit.sourceTitle),
    url: z
      .string()
      .trim()
      .refine((url) => toSafeHref(url, { requireHttps: true }) !== null, "Use a full https:// address for a real website."),
  });

  const section = z.strictObject({
    id: SectionId,
    title: plainText(limit.title),
    summary: plainText(limit.summary),
    blocks: z.array(block).min(1, "A section needs at least one block."),
    sources: z.array(source).min(1, "Every section lists where its information comes from."),
  });

  const review = z
    .strictObject({
      status: z.enum(REVIEW_STATUSES),
      reviewedBy: plainText(limit.reviewedBy).optional(),
      reviewedOn: IsoDate.optional(),
      contentFingerprint: z
        .string()
        .trim()
        .regex(FINGERPRINT, "Copy the fingerprint exactly as the check gives it: 16 letters and digits.")
        .optional(),
    })
    .superRefine((review, ctx) => {
      if (review.status !== "counselor-reviewed") return;
      if (!review.reviewedBy) ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "Say who reviewed the guide." });
      if (!review.reviewedOn) ctx.addIssue({ code: "custom", path: ["reviewedOn"], message: "Say when the guide was reviewed." });
    });

  return z
    .strictObject({
      language: z.enum(AID_GUIDE_LANGUAGES),
      updated: IsoDate,
      review,
      sections: z.array(section).min(1, "The guide needs at least one section."),
    })
    .superRefine((guide, ctx) => {
      const seen = new Set<string>();
      let furthest = -1;
      guide.sections.forEach((section, i) => {
        const path = ["sections", i, "id"];
        const position = AID_GUIDE_SECTION_IDS.indexOf(section.id);
        if (seen.has(section.id)) {
          ctx.addIssue({ code: "custom", path, message: `Section "${section.id}" appears more than once.` });
        } else if (position < furthest) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `Section "${section.id}" is out of order. Sections follow the order of AID_GUIDE_SECTION_IDS.`,
          });
        }
        seen.add(section.id);
        furthest = Math.max(furthest, position);
      });
    });
}

const SCHEMAS = { en: guideSchema("en"), es: guideSchema("es") } satisfies Record<AidLanguage, unknown>;

export type AidGuide = z.infer<ReturnType<typeof guideSchema>>;
export type AidGuideSection = AidGuide["sections"][number];
export type AidGuideBlock = AidGuideSection["blocks"][number];
export type AidGuideSource = AidGuideSection["sources"][number];

/** "sections.1.blocks.0.text: Can't be empty." */
export function formatIssues(error: z.ZodError, label: string): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${label}${path ? ` ${path}` : ""}: ${issue.message}`;
  });
}

export type ParseResult = { ok: true; guide: AidGuide } | { ok: false; issues: string[] };

/**
 * Validates one language's content file with that language's length limits. `label` names the
 * file in error messages.
 */
export function parseGuide(raw: unknown, lang: AidLanguage, label = `${lang}.json`): ParseResult {
  const result = SCHEMAS[lang].safeParse(raw);
  return result.success ? { ok: true, guide: result.data } : { ok: false, issues: formatIssues(result.error, label) };
}
