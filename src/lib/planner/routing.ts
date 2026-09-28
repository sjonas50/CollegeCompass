import type { FamilyTarget } from "./engine-io";
import { MAX_FAMILY_TARGETS } from "./engine-io";
import { type CipRoutingRule, type FamilyId, routeCip } from "./families";

// From a student's north-star careers to major families (design §2.6, §7): each career's related
// majors (`getCareer().majors`, 6-digit CIP codes from the NCES CIP-SOC crosswalk) route through
// the ordered rules in major-prep/cip-routing.json to one of the 32 families. A career whose
// majors fall in several families counts each family by its majors, each weighted by how many
// colleges we list offer its 4-digit family (`getCareer().majorPaths`): the degree most students
// with that career earn, not how finely the crosswalk splits it. Software Developers has 8
// narrow IT majors (11.02xx, 11.0804, 11.0902, 15.1204) but its widely offered majors are
// computer science (11.01, 11.07, 11.04), so it routes to computer science (design §5.13: "Software
// developer → CIP 11.07 → family 3"). Without that information (or when it ties), the family with
// more majors wins, then the order families were first seen. Pure: the rules come in as data
// (content.ts `cipRoutingRules()`), so client components can use this too.

export type RoutedFamily = {
  familyId: FamilyId;
  /** The related majors that routed here, in the career's order. */
  cip6: string[];
};

/** How widely a major is offered: colleges we list that offer its 4-digit family (0 when none or unknown). */
export type MajorWeight = (cipCode: string) => number;

/** Families a career's majors route to, most widely offered majors first. Majors no rule matches are skipped. */
export function familiesForMajors(majors: readonly { cipCode: string }[], rules: readonly CipRoutingRule[], weight: MajorWeight = () => 0): RoutedFamily[] {
  const byFamily = new Map<FamilyId, { cip6: string[]; weight: number }>();
  for (const { cipCode } of majors) {
    const family = routeCip(cipCode, rules);
    if (!family) continue;
    const entry = byFamily.get(family) ?? { cip6: [], weight: 0 };
    if (!entry.cip6.includes(cipCode)) {
      entry.cip6.push(cipCode);
      entry.weight += weight(cipCode);
    }
    byFamily.set(family, entry);
  }
  // Array.prototype.sort is stable, so ties keep the order families were first seen.
  return [...byFamily.entries()]
    .sort(([, a], [, b]) => b.weight - a.weight || b.cip6.length - a.cip6.length)
    .map(([familyId, { cip6 }]) => ({ familyId, cip6 }));
}

export type RoutableCareer = {
  title: string;
  majors: readonly { cipCode: string }[];
  /** How each major is studied (`getCareer().majorPaths`): colleges offering its family weigh it. */
  majorPaths?: Readonly<Record<string, { kind: string; colleges?: number }>>;
};

function weightOf(career: RoutableCareer): MajorWeight {
  return (cipCode) => {
    const path = career.majorPaths?.[cipCode];
    return path?.kind === "colleges" ? (path.colleges ?? 0) : 0;
  };
}

/**
 * Family targets for the student's north stars, in the order the student added them: each
 * career's strongest family ("Because you picked Registered Nurse"). A family two careers share
 * appears once, for the first. At most MAX_FAMILY_TARGETS; a career whose majors route nowhere
 * adds nothing (the general college-prep checklist, with no family claim).
 */
export function familyTargetsForCareers(careers: readonly RoutableCareer[], rules: readonly CipRoutingRule[]): FamilyTarget[] {
  const targets: FamilyTarget[] = [];
  for (const career of careers) {
    const [top] = familiesForMajors(career.majors, rules, weightOf(career));
    if (!top || targets.some((t) => t.familyId === top.familyId)) continue;
    targets.push({ familyId: top.familyId, source: "north_star", cip6: top.cip6[0], because: career.title });
    if (targets.length === MAX_FAMILY_TARGETS) break;
  }
  return targets;
}
