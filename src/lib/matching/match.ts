import { type BigFive, RIASEC, type Riasec, WORK_VALUES, type WorkValue } from "../assessments/instruments";
import { isFlatProfile } from "../assessments/interest-pattern";
import { MAPPED_TRAITS, type MappedTrait, TRAIT_WORK_STYLES, WORK_STYLES, type WorkStyle } from "../reference/work-styles";

/**
 * Career matching. Deterministic and explainable:
 *
 * - Interest fit: correlation between the student's six RIASEC scores and the occupation's O*NET
 *   interest profile ("profile similarity"), rescaled to 0–100. Shape matters more than level,
 *   so a student who likes everything a little still gets distinct matches. When a student's
 *   scores are nearly flat, correlation is meaningless and distance is used instead.
 * - Values fit (optional): correlation between the student's value ranking and the occupation's
 *   O*NET work value scores. Weighted lightly: that O*NET data dates from 2008.
 * - Personality fit (optional, the lightest). The owner decided (2026-09-24) to show students their
 *   strengths first, then let personality count a little in ranking, at most about 10%. Cautions,
 *   and how the code respects them:
 *   - Published links between Big Five traits and specific occupations are weak, and O*NET's work
 *     styles are AI/Expert estimates, not surveys of workers. So personality can add at most
 *     PERSONALITY_WEIGHT × 100 = 10 points to a 0–100 score, and interests stay in charge.
 *   - Emotional stability (neuroticism) is never used: it's mood data about a minor and not a fair
 *     thing to steer careers by. `MappedTrait` leaves it out by type, and the adjustment work
 *     styles (Stress Tolerance, Self-Control) aren't mapped to any trait.
 *   - Personality never discourages, screens out or stereotypes. Only strengths a student reports
 *     (a trait above the scale midpoint) can raise a career, and a low score never lowers one: a
 *     quiet student's teaching matches don't drop because they're quiet, and careers that need
 *     less of a trait aren't pushed on students who scored low on it.
 *   - Personality mustn't stand in for years of school. O*NET rates jobs that need more school
 *     higher on nearly every work style, so each career is compared only with careers at its own
 *     Job Zone, after taking off its general level (withTraitDemands).
 *   See personalityFit and occupationTraitDemands for the method.
 */

export const VALUES_WEIGHT = 0.15;
/** Personality can add at most PERSONALITY_WEIGHT × 100 points, lighter than values (see above). */
export const PERSONALITY_WEIGHT = 0.1;
/**
 * How far above the average occupation (at the same Job Zone), in standard deviations, a trait
 * counts as fully called for.
 */
export const DEMAND_CAP = 2;
/**
 * How far above the scale midpoint (50, "Neither") a trait score counts as a full strength: 25
 * points is an average answer of "Moderately accurate" (75).
 */
export const STRENGTH_SPAN = 25;

/**
 * How much an occupation calls for each trait, in standard deviations from the average occupation
 * at its Job Zone (see occupationTraitDemands).
 */
export type TraitDemand = Record<MappedTrait, number>;

export type OccupationProfile = {
  code: string;
  title: string;
  jobZone: number | null;
  interests: Record<Riasec, number>; // O*NET OI, 1–7
  values: Partial<Record<WorkValue, number>>; // O*NET EX, 1–7
  /** From O*NET work styles (see withTraitDemands); missing when O*NET has none for it. */
  traitDemand?: TraitDemand;
};

export type StudentProfile = {
  interests: Record<Riasec, number>; // 0–40
  valuesRanking?: WorkValue[];
  /** Mini-IPIP trait scores, 0–100. Neuroticism may be present but is never read. */
  personality?: Record<BigFive, number>;
};

export type ScoredOccupation = {
  code: string;
  title: string;
  jobZone: number | null;
  score: number;
  interestFit: number;
  valuesFit: number | null;
  /** 0–100: how much the career calls for strengths the student has. Null when not used. */
  personalityFit: number | null;
};

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function pearson(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

function interestFit(student: number[], occupation: number[]): number {
  if (isFlatProfile(student)) {
    // Put the student on O*NET's 1–7 scale and use closeness instead of shape.
    const scaled = student.map((s) => 1 + (s / 40) * 6);
    const dist = Math.sqrt(scaled.reduce((sum, s, i) => sum + (s - occupation[i]) ** 2, 0));
    const maxDist = Math.sqrt(6 * 36);
    return Math.round((1 - dist / maxDist) * 100);
  }
  return Math.round(((pearson(student, occupation) + 1) / 2) * 100);
}

function valuesFit(ranking: WorkValue[], values: Partial<Record<WorkValue, number>>): number | null {
  if (WORK_VALUES.some((v) => values[v] === undefined)) return null;
  const weights = WORK_VALUES.map((v) => WORK_VALUES.length - ranking.indexOf(v));
  const extents = WORK_VALUES.map((v) => values[v]!);
  return Math.round(((pearson(weights, extents) + 1) / 2) * 100);
}

function standardize(xs: number[]): number[] {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  return xs.map((x) => (sd === 0 ? 0 : (x - m) / sd));
}

const ALL_STYLES = WORK_STYLES.map((s) => s.id);

/**
 * How much each occupation in a group calls for each trait, from the O*NET Work Styles Impact (WI)
 * scores:
 *
 * 1. Each of the 21 styles is standardized across the group, so a style that varies little between
 *    jobs (Dependability matters nearly everywhere) counts as much as one that varies a lot.
 * 2. Each occupation's general level, its average over all 21 standardized styles, is taken off
 *    every style. WI rises with job level for every style at once, so without this, a job rated
 *    high on everything would seem to call for every trait. What's left is what the occupation
 *    especially calls for, compared with its own other styles.
 * 3. A trait's demand is the average of its styles (TRAIT_WORK_STYLES), standardized again so every
 *    trait is on the same scale: 0 is the average occupation in the group, 1 is one standard
 *    deviation above it.
 *
 * Styles no trait is linked to (Stress Tolerance, Self-Control, Integrity, …) only count toward the
 * general level. Occupations missing any of the 21 styles get no demand, and so no personality fit.
 * withTraitDemands runs this within each Job Zone.
 */
export function occupationTraitDemands(impacts: ReadonlyMap<string, Partial<Record<WorkStyle, number>>>): Map<string, TraitDemand> {
  const codes = [...impacts.keys()].filter((code) => ALL_STYLES.every((s) => Number.isFinite(impacts.get(code)![s])));
  const z = new Map(ALL_STYLES.map((s) => [s, standardize(codes.map((c) => impacts.get(c)![s]!))]));
  const general = codes.map((_, i) => mean(ALL_STYLES.map((s) => z.get(s)![i])));
  const demand = new Map(
    MAPPED_TRAITS.map((t) => [t, standardize(codes.map((_, i) => mean(TRAIT_WORK_STYLES[t].map((s) => z.get(s)![i])) - general[i]))]),
  );
  return new Map(codes.map((code, i) => [code, Object.fromEntries(MAPPED_TRAITS.map((t) => [t, demand.get(t)![i]])) as TraitDemand]));
}

/**
 * The profiles with each one's trait demand from its work style impacts, compared only with
 * occupations at the same Job Zone (see occupationTraitDemands). Higher Job Zones are rated higher
 * on nearly every style, and taking off each occupation's general level doesn't remove all of it,
 * so comparing across Job Zones would make personality a stand-in for years of school: a student
 * who rates themselves above the middle would get more lift toward careers that need more school.
 * Within each Job Zone, a student's strengths lift careers at every level about equally on average
 * (`npm run check:matching` checks this on the real data).
 */
export function withTraitDemands<P extends OccupationProfile>(
  profiles: P[],
  impacts: ReadonlyMap<string, Partial<Record<WorkStyle, number>>>,
): P[] {
  const byZone = new Map<number | null, Map<string, Partial<Record<WorkStyle, number>>>>();
  for (const p of profiles) {
    const impact = impacts.get(p.code);
    if (!impact) continue;
    const group = byZone.get(p.jobZone) ?? byZone.set(p.jobZone, new Map()).get(p.jobZone)!;
    group.set(p.code, impact);
  }
  const demands = new Map([...byZone.values()].flatMap((group) => [...occupationTraitDemands(group)]));
  return profiles.map((p) => ({ ...p, traitDemand: demands.get(p.code) }));
}

/**
 * 0–100: how much an occupation calls for the strengths a student reports. For each of the four
 * mapped traits: the student's strength (how far above the scale midpoint of 50 they scored, 0–1,
 * and 0 at or below the midpoint) times how much the occupation calls for the trait (its demand
 * above the average occupation at its Job Zone, 0 at or below average, capped at DEMAND_CAP
 * standard deviations and scaled to 0–1). The fit is the average over the four traits.
 *
 * Why not a correlation, as interests use: with only four numbers, a correlation can swing from +1
 * to −1 when one trait moves a little; it ignores how far from the midpoint the student is (52 on
 * every trait would look as sure as 95); and it's undefined when all four scores are equal. A
 * bounded average of products changes smoothly with every score, is 0 for a student at the
 * midpoint, and can't leave its range. It's one-sided on purpose (see the top of this file): only
 * strengths the student has add, and nothing subtracts.
 */
export function personalityFit(traits: Record<BigFive, number>, demand: TraitDemand): number {
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const sum = MAPPED_TRAITS.reduce((acc, t) => acc + clamp01((traits[t] - 50) / STRENGTH_SPAN) * clamp01(demand[t] / DEMAND_CAP), 0);
  return Math.round((sum / MAPPED_TRAITS.length) * 100);
}

/**
 * The traits that can raise a student's careers: the mapped traits they rated above the scale
 * midpoint (see personalityFit), highest first. Pages name these, so they never say a strength
 * counts when it doesn't.
 */
export function strengthsThatCount(traits: Record<BigFive, number>): MappedTrait[] {
  return MAPPED_TRAITS.filter((t) => traits[t] > 50).sort((a, b) => traits[b] - traits[a]);
}

export function scoreOccupation(student: StudentProfile, occ: OccupationProfile): ScoredOccupation {
  const s = RIASEC.map((a) => student.interests[a]);
  const o = RIASEC.map((a) => occ.interests[a]);
  const iFit = interestFit(s, o);
  const vFit = student.valuesRanking ? valuesFit(student.valuesRanking, occ.values) : null;
  const pFit = student.personality && occ.traitDemand ? personalityFit(student.personality, occ.traitDemand) : null;
  const base = vFit === null ? iFit : (1 - VALUES_WEIGHT) * iFit + VALUES_WEIGHT * vFit;
  // Personality only adds: at most PERSONALITY_WEIGHT × 100 points, and never past 100.
  const score = pFit === null ? Math.round(base) : Math.min(100, Math.round(base + PERSONALITY_WEIGHT * pFit));
  return { code: occ.code, title: occ.title, jobZone: occ.jobZone, score, interestFit: iFit, valuesFit: vFit, personalityFit: pFit };
}

/** Catch-all categories ("…, All Other") are too vague to be useful suggestions. */
export function isMatchable(occ: Pick<OccupationProfile, "title">) {
  return !/,\s*All Other$/i.test(occ.title);
}

/**
 * Ranks occupations and keeps the list varied: at most `perGroup` from any SOC minor group
 * (e.g. 27-1 art and design, 27-2 entertainers and performers), so one narrow field can't crowd
 * out the rest. Major groups are too coarse: nearly all artistic careers share group 27.
 */
export function rankOccupations(
  student: StudentProfile,
  occupations: OccupationProfile[],
  { limit = 20, perGroup = 4 }: { limit?: number; perGroup?: number } = {},
): ScoredOccupation[] {
  const ranked = occupations
    .filter(isMatchable)
    .map((occ) => scoreOccupation(student, occ))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  const perGroupCount = new Map<string, number>();
  const out: ScoredOccupation[] = [];
  for (const occ of ranked) {
    const group = occ.code.slice(0, 4);
    const n = perGroupCount.get(group) ?? 0;
    if (n >= perGroup) continue;
    perGroupCount.set(group, n + 1);
    out.push(occ);
    if (out.length >= limit) break;
  }
  return out;
}

export type Pathway = "degree" | "training";

/** O*NET Job Zones 4–5 usually need a bachelor's degree or more; 1–3 need training, an apprenticeship or an associate degree. */
export function pathwayFor(jobZone: number | null): Pathway {
  return jobZone !== null && jobZone >= 4 ? "degree" : "training";
}

export const PATHWAY_INFO: Record<Pathway, { title: string; description: string }> = {
  degree: { title: "College degree paths", description: "Usually need a bachelor's degree or more." },
  training: {
    title: "Career training paths",
    description: "Usually need a certificate, apprenticeship, associate degree or on-the-job training.",
  },
};

/**
 * Ranks degree and training paths separately so a hands-on student sees engineers as well as
 * tradespeople, and every student sees both routes.
 */
export function rankForStudent(
  student: StudentProfile,
  occupations: OccupationProfile[],
  { degree = 12, training = 8 }: { degree?: number; training?: number } = {},
): ScoredOccupation[] {
  const byPathway = (p: Pathway) => occupations.filter((o) => pathwayFor(o.jobZone) === p);
  return [
    ...rankOccupations(student, byPathway("degree"), { limit: degree }),
    ...rankOccupations(student, byPathway("training"), { limit: training }),
  ];
}

/**
 * When no interest area stands out (see noAreaStandsOut), no career is called a great or good fit. A
 * flat profile has no shape for a career to fit: its scores say only how close a career's interest
 * levels are to the student's. A profile where no area was liked still has a shape, but a career
 * that fits it is one the student disliked least, not one they would enjoy.
 */
export function fitLabel(score: number, { noLead = false } = {}): "Great fit" | "Good fit" | "Worth exploring" {
  if (noLead) return "Worth exploring";
  if (score >= 85) return "Great fit";
  if (score >= 70) return "Good fit";
  return "Worth exploring";
}
