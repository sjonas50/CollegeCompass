import type { FamilyTarget } from "./engine-io";
import { MAX_FAMILY_TARGETS } from "./engine-io";
import { type CipRoutingRule, type FamilyId, routeCip } from "./families";

// From a student's north-star careers to major families (design §2.6, §7): each career's related
// majors (`getCareer().majors`, 6-digit CIP codes from the NCES CIP-SOC crosswalk) route through
// the ordered rules in major-prep/cip-routing.json to one of the 32 families. A career whose
// majors fall in several families counts each family by how many majors route there, like
// `familiesByWeight` in src/lib/courses/suggestions.ts; ties keep first-seen order. Pure: the
// rules come in as data (content.ts `cipRoutingRules()`), so client components can use this too.

export type RoutedFamily = {
  familyId: FamilyId;
  /** The related majors that routed here, in the career's order. */
  cip6: string[];
};

/** Families a career's majors route to, most majors first. Majors no rule matches are skipped. */
export function familiesForMajors(majors: readonly { cipCode: string }[], rules: readonly CipRoutingRule[]): RoutedFamily[] {
  const byFamily = new Map<FamilyId, string[]>();
  for (const { cipCode } of majors) {
    const family = routeCip(cipCode, rules);
    if (!family) continue;
    const list = byFamily.get(family) ?? [];
    if (!list.includes(cipCode)) list.push(cipCode);
    byFamily.set(family, list);
  }
  // Array.prototype.sort is stable, so equal counts keep the order families were first seen.
  return [...byFamily.entries()].map(([familyId, cip6]) => ({ familyId, cip6 })).sort((a, b) => b.cip6.length - a.cip6.length);
}

export type RoutableCareer = { title: string; majors: readonly { cipCode: string }[] };

/**
 * Family targets for the student's north stars, in the order the student added them: each
 * career's strongest family ("Because you picked Registered Nurse"). A family two careers share
 * appears once, for the first. At most MAX_FAMILY_TARGETS; a career whose majors route nowhere
 * adds nothing (the general college-prep checklist, with no family claim).
 */
export function familyTargetsForCareers(careers: readonly RoutableCareer[], rules: readonly CipRoutingRule[]): FamilyTarget[] {
  const targets: FamilyTarget[] = [];
  for (const career of careers) {
    const [top] = familiesForMajors(career.majors, rules);
    if (!top || targets.some((t) => t.familyId === top.familyId)) continue;
    targets.push({ familyId: top.familyId, source: "north_star", cip6: top.cip6[0], because: career.title });
    if (targets.length === MAX_FAMILY_TARGETS) break;
  }
  return targets;
}
