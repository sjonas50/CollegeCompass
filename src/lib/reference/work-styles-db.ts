import "server-only";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { occupationWorkStyles } from "@/db/schema";
import { type OccupationWorkStyle, WORK_STYLE_INFO } from "./work-styles";

/**
 * One occupation's work styles, most distinctive first. Empty when O*NET has none for it. Kept
 * apart from work-styles.ts, which client code reaches through matching (match.ts), so the browser
 * never bundles the database schema.
 */
export async function getOccupationWorkStyles(db: Db, code: string): Promise<OccupationWorkStyle[]> {
  const rows = await db
    .select({ style: occupationWorkStyles.style, impact: occupationWorkStyles.impact, distinctiveRank: occupationWorkStyles.distinctiveRank })
    .from(occupationWorkStyles)
    .where(eq(occupationWorkStyles.occupationCode, code))
    .orderBy(asc(occupationWorkStyles.distinctiveRank), asc(occupationWorkStyles.style));
  return rows.filter((r): r is OccupationWorkStyle => r.style in WORK_STYLE_INFO);
}
