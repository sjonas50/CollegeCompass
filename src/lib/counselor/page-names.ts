import { inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { colleges, occupations } from "@/db/schema";
import { isUnitId } from "../colleges/detail";

/** Names of college and career pages by path ("/colleges/204796": "Ohio State University-Main Campus"). */
export type PageNames = Record<string, string>;

// The paths our tools give the counselor. Wider than what the chat links (it decides that), so every
// page it links is looked up.
const COLLEGE_PATH = /\/colleges\/(\d+)/g;
const CAREER_PATH = /\/careers\/(\d{2}-\d{4}\.\d{2})/g;

/**
 * The real names of the college and career pages linked in counselor replies, so the chat names each
 * link after its college or career whatever the counselor wrote around it. One query for colleges
 * and one for careers. A path to a page that doesn't exist gets no name.
 */
export async function pageNames(db: Db, texts: string[]): Promise<PageNames> {
  const unitIds = new Map<string, number>();
  const codes = new Map<string, string>();
  for (const text of texts) {
    for (const [path, digits] of text.matchAll(COLLEGE_PATH)) {
      const unitId = Number(digits);
      if (isUnitId(unitId)) unitIds.set(path, unitId);
    }
    for (const [path, code] of text.matchAll(CAREER_PATH)) codes.set(path, code);
  }
  const [collegeRows, careerRows] = await Promise.all([
    unitIds.size
      ? db
          .select({ unitId: colleges.unitId, name: colleges.name })
          .from(colleges)
          .where(inArray(colleges.unitId, [...new Set(unitIds.values())]))
      : [],
    codes.size
      ? db
          .select({ code: occupations.code, title: occupations.title })
          .from(occupations)
          .where(inArray(occupations.code, [...new Set(codes.values())]))
      : [],
  ]);
  const collegeNames = new Map(collegeRows.map((r) => [r.unitId, r.name]));
  const careerTitles = new Map(careerRows.map((r) => [r.code, r.title]));
  const names: PageNames = {};
  for (const [path, unitId] of unitIds) {
    const name = collegeNames.get(unitId);
    if (name) names[path] = name;
  }
  for (const [path, code] of codes) {
    const title = careerTitles.get(code);
    if (title) names[path] = title;
  }
  return names;
}
