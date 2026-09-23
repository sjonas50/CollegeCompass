import { RIASEC, type Riasec, WORK_VALUES, type WorkValue } from "../assessments/instruments";

/**
 * Career matching. Deterministic and explainable:
 *
 * - Interest fit: correlation between the student's six RIASEC scores and the occupation's O*NET
 *   interest profile ("profile similarity"), rescaled to 0–100. Shape matters more than level,
 *   so a student who likes everything a little still gets distinct matches. When a student's
 *   scores are nearly flat, correlation is meaningless and distance is used instead.
 * - Values fit (optional): correlation between the student's value ranking and the occupation's
 *   O*NET work value scores. Weighted lightly: that O*NET data dates from 2008.
 * - Personality is not used for ranking; published links between Big Five traits and specific
 *   occupations are too weak to rank careers with. It informs the written explanation instead.
 */

export const VALUES_WEIGHT = 0.15;
const FLAT_PROFILE_SD = 2; // out of 0–40 per area

export type OccupationProfile = {
  code: string;
  title: string;
  jobZone: number | null;
  interests: Record<Riasec, number>; // O*NET OI, 1–7
  values: Partial<Record<WorkValue, number>>; // O*NET EX, 1–7
};

export type StudentProfile = {
  interests: Record<Riasec, number>; // 0–40
  valuesRanking?: WorkValue[];
};

export type ScoredOccupation = {
  code: string;
  title: string;
  jobZone: number | null;
  score: number;
  interestFit: number;
  valuesFit: number | null;
};

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[]) {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
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
  if (sd(student) < FLAT_PROFILE_SD) {
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

export function scoreOccupation(student: StudentProfile, occ: OccupationProfile): ScoredOccupation {
  const s = RIASEC.map((a) => student.interests[a]);
  const o = RIASEC.map((a) => occ.interests[a]);
  const iFit = interestFit(s, o);
  const vFit = student.valuesRanking ? valuesFit(student.valuesRanking, occ.values) : null;
  const score = vFit === null ? iFit : Math.round((1 - VALUES_WEIGHT) * iFit + VALUES_WEIGHT * vFit);
  return { code: occ.code, title: occ.title, jobZone: occ.jobZone, score, interestFit: iFit, valuesFit: vFit };
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

export function fitLabel(score: number): "Great fit" | "Good fit" | "Worth exploring" {
  if (score >= 85) return "Great fit";
  if (score >= 70) return "Good fit";
  return "Worth exploring";
}
