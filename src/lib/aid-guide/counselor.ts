import { aidGuideHref } from "./navigation";
import type { AidGuide, AidGuideSection } from "./schema";

// What the AI counselor's get_aid_guide tool returns (src/lib/counselor/college-tools.ts). Pure:
// it takes the guide, so it can be tested with draft and reviewed content alike.

export const DRAFT_NOTE =
  "This guide is a draft: a counselor hasn't reviewed it yet. Tell the student that, and have them confirm dates and amounts at https://studentaid.gov or with the school's financial aid office.";

/** How far to trust the guide: its review status and dates, and a caveat to pass on while it's a draft. */
export function guideReviewForCounselor(guide: AidGuide) {
  const { review, updated } = guide;
  return review.status === "counselor-reviewed"
    ? { review: review.status, reviewedOn: review.reviewedOn, updated }
    : { review: review.status, updated, reviewNote: DRAFT_NOTE };
}

/** A section's blocks as plain text: headings on their own line, steps numbered, lists bulleted. */
export function sectionAsText(section: AidGuideSection): string {
  return section.blocks
    .map((b) => {
      const body = "items" in b ? b.items.map((item, i) => (b.kind === "steps" ? `${i + 1}. ${item}` : `- ${item}`)).join("\n") : b.text;
      return b.heading ? `${b.heading}\n${body}` : body;
    })
    .join("\n\n");
}

/**
 * The tool's answer: every section (with no `sectionId`), or one section's words, sources and page
 * to link. Either way it says whether a counselor has reviewed the guide.
 */
export function aidGuideToolResult(guide: AidGuide, sectionId?: string) {
  const review = guideReviewForCounselor(guide);
  const sections = guide.sections.map(({ id, title, summary }) => ({ id, title, summary, href: aidGuideHref(guide.language, id) }));
  if (!sectionId) return { ...review, sections };
  const section = guide.sections.find((s) => s.id === sectionId);
  if (!section) return { note: "That section isn't published yet.", ...review, sections };
  return {
    title: section.title,
    page: aidGuideHref(guide.language, section.id),
    ...review,
    text: sectionAsText(section),
    sources: section.sources,
  };
}
