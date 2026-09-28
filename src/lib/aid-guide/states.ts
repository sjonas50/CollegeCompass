import { stateName } from "../colleges/states";
import { headingAnchors } from "./navigation";
import type { AidGuide, AidGuideBlock, AidGuideSection } from "./schema";

// The guide's state tags (see "states" in ./schema.ts): which blocks and list items are about
// which states, so a page can put a student's own state first. Pure.

/** The section that explains state aid, and where it tells families to look for their own state's programs. */
export const STATE_AID_SECTION = "state-aid-and-promise-programs";
export const FIND_YOUR_STATE_HEADING = "Find your state's programs";

/** Content tagged with one of `states`: a list item's text, or a whole block (linked by its heading's anchor). */
export type StateContent =
  | { kind: "item"; text: string; states: string[] }
  | { kind: "block"; heading: string | null; anchor: string | undefined; states: string[] };

const overlaps = (tags: readonly string[] | undefined, states: readonly string[]) => Boolean(tags?.some((t) => states.includes(t)));

/** A list item's states (empty when untagged). */
export function itemStates(block: AidGuideBlock, index: number): string[] {
  return "itemStates" in block && block.itemStates ? (block.itemStates[index] ?? []) : [];
}

/** The section's blocks and items about any of `states`, in reading order. */
export function contentForStates(section: AidGuideSection, states: readonly string[]): StateContent[] {
  if (!states.length) return [];
  const anchors = headingAnchors(section.blocks);
  return section.blocks.flatMap((block, i): StateContent[] => {
    if (overlaps(block.states, states)) return [{ kind: "block", heading: block.heading ?? null, anchor: anchors[i], states: block.states ?? [] }];
    if (!("items" in block)) return [];
    return block.items.flatMap((text, j) => {
      const tags = itemStates(block, j);
      return overlaps(tags, states) ? [{ kind: "item" as const, text, states: tags }] : [];
    });
  });
}

/** Sections with content about any of `states`, for the guide's front page. */
export function sectionsForStates(guide: AidGuide, states: readonly string[]): AidGuideSection[] {
  return guide.sections.filter((s) => contentForStates(s, states).length > 0);
}

/** "Texas", "Texas and Utah", "Illinois, Kentucky and Texas". */
export function stateNames(codes: readonly string[]): string {
  const names = codes.map((c) => stateName(c) ?? c);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
