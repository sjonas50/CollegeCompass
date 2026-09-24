import { z } from "zod";
import { toSafeHref } from "./linkify";

// ---------------------------------------------------------------------------
// The financial aid guide's content format. One JSON file per language lives in
// src/content/aid-guide/<language>.json; ./index.ts loads and checks them.
//
// {
//   "language": "en" | "es",
//   "updated": "YYYY-MM-DD",
//   "review": { "status": "draft" | "counselor-reviewed", "reviewedBy"?: "...", "reviewedOn"?: "YYYY-MM-DD" },
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
// - Plain text only. No HTML or Markdown; write a link as a bare address (https://studentaid.gov)
//   with a space or an opening bracket/quote before it. Only https addresses; none in titles,
//   summaries or headings.
// - "counselor-reviewed" needs "reviewedBy" and "reviewedOn". "draft" shows a review notice.
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

const HTML_TAG = /<\/?[a-z][^>]*>/i;
const MARKDOWN = /\]\(|\*\*|^#{1,6}\s/m;

/** Plain text: trimmed, not empty, and no HTML or Markdown (neither is rendered). */
function plainText(max: number) {
  return z
    .string()
    .trim()
    .min(1, "Can't be empty.")
    .max(max, `Keep this under ${max} characters.`)
    .refine((s) => !HTML_TAG.test(s), "Plain text only: HTML tags would show up as typed. Write links as bare addresses like https://studentaid.gov.")
    .refine((s) => !MARKDOWN.test(s), "Plain text only: Markdown isn't rendered. Write links as bare addresses like https://studentaid.gov.");
}

const IsoDate = z.iso.date({ error: "Use a real date written YYYY-MM-DD, like 2026-10-01." });

const SectionId = z.enum(AID_GUIDE_SECTION_IDS, {
  error: (issue) =>
    `Unknown section id ${JSON.stringify(issue.input)}. Use one of the ids in AID_GUIDE_SECTION_IDS (src/lib/aid-guide/schema.ts), or add the new id there first.`,
});

const Heading = plainText(120);
const Text = plainText(2000);

function textBlock<K extends "paragraph" | "tip" | "warning">(kind: K) {
  return z.strictObject({ kind: z.literal(kind), heading: Heading.optional(), text: Text });
}
function itemsBlock<K extends "list" | "steps">(kind: K) {
  return z.strictObject({
    kind: z.literal(kind),
    heading: Heading.optional(),
    items: z.array(plainText(1000)).min(1, "A list needs at least one item."),
  });
}

export const AidGuideBlockSchema = z.discriminatedUnion("kind", [
  textBlock("paragraph"),
  textBlock("tip"),
  textBlock("warning"),
  itemsBlock("list"),
  itemsBlock("steps"),
]);

export const AidGuideSourceSchema = z.strictObject({
  title: plainText(200),
  url: z
    .string()
    .trim()
    .refine((url) => toSafeHref(url, { requireHttps: true }) !== null, "Use a full https:// address for a real website."),
});

export const AidGuideSectionSchema = z.strictObject({
  id: SectionId,
  title: plainText(100),
  summary: plainText(240),
  blocks: z.array(AidGuideBlockSchema).min(1, "A section needs at least one block."),
  sources: z.array(AidGuideSourceSchema).min(1, "Every section lists where its information comes from."),
});

export const AidGuideReviewSchema = z
  .strictObject({
    status: z.enum(REVIEW_STATUSES),
    reviewedBy: plainText(120).optional(),
    reviewedOn: IsoDate.optional(),
  })
  .superRefine((review, ctx) => {
    if (review.status !== "counselor-reviewed") return;
    if (!review.reviewedBy) ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "Say who reviewed the guide." });
    if (!review.reviewedOn) ctx.addIssue({ code: "custom", path: ["reviewedOn"], message: "Say when the guide was reviewed." });
  });

export const AidGuideSchema = z
  .strictObject({
    language: z.enum(AID_GUIDE_LANGUAGES),
    updated: IsoDate,
    review: AidGuideReviewSchema,
    sections: z.array(AidGuideSectionSchema).min(1, "The guide needs at least one section."),
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

export type AidGuide = z.infer<typeof AidGuideSchema>;
export type AidGuideSection = z.infer<typeof AidGuideSectionSchema>;
export type AidGuideBlock = z.infer<typeof AidGuideBlockSchema>;
export type AidGuideSource = z.infer<typeof AidGuideSourceSchema>;

/** "sections.1.blocks.0.text: Can't be empty." */
export function formatIssues(error: z.ZodError, label: string): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${label}${path ? ` ${path}` : ""}: ${issue.message}`;
  });
}

export type ParseResult = { ok: true; guide: AidGuide } | { ok: false; issues: string[] };

/** Validates one language's content file. `label` names the file in error messages. */
export function parseGuide(raw: unknown, label: string): ParseResult {
  const result = AidGuideSchema.safeParse(raw);
  return result.success ? { ok: true, guide: result.data } : { ok: false, issues: formatIssues(result.error, label) };
}
