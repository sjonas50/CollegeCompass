import type { Db } from "@/db";
import { getCareer } from "@/lib/careers";
import { listNorthStars } from "@/lib/goals";
import { cipRoutingRules } from "./content";
import type { FamilyTarget } from "./engine-io";
import { familyTargetsForCareers } from "./routing";

/**
 * Major-family targets suggested by the student's north-star careers, in the order they were
 * added (design §2.6): each career's related majors, from the NCES CIP-SOC crosswalk, routed
 * through the reviewed CIP rules. Careers missing from reference data are skipped, like
 * `courseSuggestions`. Reads reference tables only; stores nothing (the student's chosen targets
 * live in student_plan_prefs, built elsewhere).
 */
export async function northStarFamilyTargets(db: Db, userId: string): Promise<FamilyTarget[]> {
  const stars = await listNorthStars(db, userId);
  const careers = await Promise.all(stars.map((s) => getCareer(db, s.occupationCode)));
  return familyTargetsForCareers(
    careers.flatMap((c) => (c ? [{ title: c.title, majors: c.majors }] : [])),
    cipRoutingRules(),
  );
}
