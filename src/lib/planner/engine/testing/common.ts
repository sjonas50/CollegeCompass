import type { SchoolGrade } from "../../common";
import type { Citation, ContentHeader, Source } from "../../rules";

// Shared bits for the engine's test content. The sources are fixtures (example.org), not real
// documents, and every quote is an invented test string that starts with "Fixture:". The
// structure follows design Appendix A so the engine meets realistic shapes; the real, quoted
// content is built separately under src/content. Never copy these into src/content.

export const FIXTURE_SOURCE = (state: string): Record<string, Source> => ({
  [`${state}F-1`]: {
    title: `${state} planner test rules (fixture)`,
    url: `https://example.org/fixtures/${state.toLowerCase()}`,
    publisher: "College Compass tests",
    kind: "rule",
    checkedOn: "2026-09-25",
  },
});

export function header(id: string, state: string, verifiedForSchoolYear = 2026): Omit<ContentHeader, "citations"> {
  return {
    schemaVersion: 1,
    id,
    updated: "2026-09-25",
    verifiedForSchoolYear,
    review: { status: "draft" },
    sources: FIXTURE_SOURCE(state),
  };
}

/** Citations from [id, pinpoint, what] triples; the quote is "Fixture: <what>". */
export function cites(state: string, list: [string, string, string][]): Citation[] {
  return list.map(([id, pinpoint, what]) => ({ id, source: `${state}F-1`, pinpoint, quote: `Fixture: ${what}` }));
}

export const HS: SchoolGrade[] = [9, 10, 11, 12];
