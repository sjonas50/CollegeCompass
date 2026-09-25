// ---------------------------------------------------------------------------
// Major families (research-majorprep.md §2): 32 groups of college majors and career-training
// programs that share high school preparation. A student's north-star careers route to families
// through their majors' CIP codes (`getCareer().majors`, 6-digit CIP 2020); the planner then adds
// the family's reviewed math and science targets as "College Compass suggestion" demands.
//
// Ids are permanent (student_plan_prefs.targets stores them). `number` is the row number in the
// research table, kept for traceability. What each family recommends (math target, sciences,
// "rigor first" subjects, CTE pathways, published gates, cautions) is reviewed content in
// src/content/major-prep/families.json (schema: content-schema.ts), not code.
// ---------------------------------------------------------------------------

export const MAJOR_FAMILIES = [
  { id: "engineering", number: 1, title: "Engineering" },
  { id: "engineering_tech", number: 2, title: "Engineering technology and drafting" },
  { id: "computer_data_science", number: 3, title: "Computer science and data science" },
  { id: "it_cybersecurity", number: 4, title: "IT, networking and cybersecurity" },
  { id: "math_physical_sciences", number: 5, title: "Mathematics, statistics, physical and earth sciences" },
  { id: "biological_sciences", number: 6, title: "Biological and biomedical sciences" },
  { id: "pre_health", number: 7, title: "Pre-health professions" },
  { id: "nursing", number: 8, title: "Registered nursing" },
  { id: "practical_nursing", number: 9, title: "Practical nursing and nurse aide" },
  { id: "allied_health", number: 10, title: "Allied health and diagnostic technology" },
  { id: "kinesiology_public_health", number: 11, title: "Kinesiology, athletic training, public health and nutrition" },
  { id: "agriculture", number: 12, title: "Agriculture, animal and plant science" },
  { id: "natural_resources", number: 13, title: "Natural resources and environmental science" },
  { id: "architecture", number: 14, title: "Architecture and interior design" },
  { id: "business", number: 15, title: "Business, accounting and finance" },
  { id: "economics", number: 16, title: "Economics" },
  { id: "psychology", number: 17, title: "Psychology" },
  { id: "social_sciences_law", number: 18, title: "Social sciences, government, history and pre-law" },
  { id: "communication", number: 19, title: "Communication, journalism and media" },
  { id: "humanities", number: 20, title: "English, world languages and humanities" },
  { id: "education", number: 21, title: "Education, teaching and early childhood" },
  { id: "social_work", number: 22, title: "Social work and human services" },
  { id: "visual_arts", number: 23, title: "Visual arts, design, photography and animation" },
  { id: "music", number: 24, title: "Music" },
  { id: "theatre_dance_film", number: 25, title: "Theatre, dance and film" },
  { id: "public_safety", number: 26, title: "Law enforcement, fire and EMS" },
  { id: "construction_trades", number: 27, title: "Construction and building trades" },
  { id: "manufacturing", number: 28, title: "Manufacturing, welding and machining" },
  { id: "transportation_maintenance", number: 29, title: "Automotive, diesel and aircraft maintenance" },
  { id: "aviation", number: 30, title: "Aviation: pilots and operations" },
  { id: "culinary_hospitality", number: 31, title: "Culinary arts and hospitality" },
  { id: "cosmetology", number: 32, title: "Cosmetology and barbering" },
] as const;

export type MajorFamily = (typeof MAJOR_FAMILIES)[number];
export type FamilyId = MajorFamily["id"];

export const FAMILY_IDS = MAJOR_FAMILIES.map((f) => f.id) as [FamilyId, ...FamilyId[]];

export function isFamilyId(id: unknown): id is FamilyId {
  return typeof id === "string" && (FAMILY_IDS as readonly string[]).includes(id);
}

export function getFamily(id: FamilyId): MajorFamily {
  return MAJOR_FAMILIES.find((f) => f.id === id)!;
}

// ---------------------------------------------------------------------------
// Math targets (research-majorprep.md §1). The research's synthesis, not published rules: they
// render as "College Compass suggestion", and need counselor review like the rest of major prep.
// Ranks are math ladder ranks (course-types.ts): 3 = Algebra II / Math III, 4 = precalculus,
// 5 = calculus.
// ---------------------------------------------------------------------------

export const MATH_TARGETS = ["CALC", "PRECALC", "STATS", "ALG2+", "APPLIED"] as const;
export type MathTarget = (typeof MATH_TARGETS)[number];

export type MathTargetDef = {
  /** What the target asks for by 12th grade. */
  target: string;
  /** Math ladder rank to reach by 12th grade. */
  rank: number;
  /** Also take statistics (math.stats) by 12th grade. */
  statistics: boolean;
  /** Also take a fourth year of math, of the student's choice, after reaching `rank`. */
  fourthYear: boolean;
  /** "The minimum that still keeps the path open": what the "lower target" gap option offers. */
  minimum: string;
  minimumRank: number;
};

export const MATH_TARGET_DEFS: Record<MathTarget, MathTargetDef> = {
  CALC: {
    target: "Calculus: AP Calculus AB or BC, IB Math HL or SL, or college Calculus I",
    rank: 5,
    statistics: false,
    fourthYear: false,
    minimum: "Precalculus, plus proof of math readiness (a test score or placement exam)",
    minimumRank: 4,
  },
  PRECALC: {
    target: "Precalculus or trigonometry (in Utah, concurrent-enrollment Math 1050 or 1060)",
    rank: 4,
    statistics: false,
    fourthYear: false,
    minimum: "Algebra II, plus a fourth-year math",
    minimumRank: 3,
  },
  STATS: {
    target: "Algebra II plus statistics (AP or dual credit where offered); precalculus also works",
    rank: 3,
    statistics: true,
    fourthYear: false,
    minimum: "Algebra II, plus a fourth-year math",
    minimumRank: 3,
  },
  "ALG2+": {
    target: "Algebra II plus a fourth-year math the student chooses",
    rank: 3,
    statistics: false,
    fourthYear: true,
    minimum: "Algebra II",
    minimumRank: 3,
  },
  APPLIED: {
    target: "Algebra I, Geometry and Algebra II, with applied math (shop math, blueprint reading)",
    rank: 3,
    statistics: false,
    fourthYear: false,
    minimum: "Algebra I, Geometry and Algebra II",
    minimumRank: 3,
  },
};

// ---------------------------------------------------------------------------
// CIP routing (research-majorprep.md §2, "CIP routing rules"): an ordered list; the first rule
// with a matching prefix wins; a code no rule matches gets no family (the general college-prep
// checklist, with no family claim). The rules themselves are reviewed content in
// src/content/major-prep/cip-routing.json (schema: content-schema.ts).
// ---------------------------------------------------------------------------

/**
 * A CIP 2020 prefix at a digit boundary: "51" (a 2-digit series), "51.38" (4-digit) or
 * "51.3801" (a 6-digit code).
 */
export type CipPrefix = string;
export const CIP_PREFIX = /^\d{2}(\.\d{2}(\d{2})?)?$/;
export const CIP6 = /^\d{2}\.\d{4}$/;

export type CipRoutingRule = {
  /** Any one prefix matching routes the code to `family`. */
  match: CipPrefix[];
  family: FamilyId;
  /** Why this rule is where it is ("before 51: EMS belongs with public safety"). */
  note?: string;
};

/** The family a 6-digit CIP code routes to, or null (first matching rule wins). */
export function routeCip(cip6: string, rules: readonly CipRoutingRule[]): FamilyId | null {
  if (!CIP6.test(cip6)) return null;
  return rules.find((rule) => rule.match.some((prefix) => cip6.startsWith(prefix)))?.family ?? null;
}
