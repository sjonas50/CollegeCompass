import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { occupationWorkStyles } from "@/db/schema";
import { type Strength, strengthFor } from "../assessments/descriptions";
import type { BigFive } from "../assessments/instruments";

/**
 * O*NET 31.0 Work Styles (https://www.onetcenter.org/dictionary/31.0/excel/work_styles.html),
 * CC BY 4.0 like the rest of the O*NET Database. 21 styles in four groups:
 *
 *   1.D.1 achievement and innovation, 1.D.2 interpersonal, 1.D.3 conscientiousness,
 *   1.D.4 adjustment (Stress Tolerance, Self-Control).
 *
 * Two scales per occupation: WI, Work Styles Impact (−3 to +3, how much the style helps or gets in
 * the way of the work), and DR, Distinctiveness Rank (up to 10 styles that set the occupation apart
 * from others; 0 means not ranked). Rank 1 is the most distinctive: O*NET OnLine lists an
 * occupation's work styles in DR order, and rank-1 styles sit furthest above the all-occupation
 * average (checked against the 31.0 file).
 *
 * Caution: the file's Domain Source is "AI/Expert". O*NET produced these ratings with a hybrid AI
 * and expert method rather than by surveying workers, so they're estimates. We use them lightly in
 * matching (PERSONALITY_WEIGHT) and say so wherever they're shown.
 */

export type WorkStyleGroup = "achievement" | "interpersonal" | "conscientiousness" | "adjustment";

export type WorkStyle =
  | "innovation"
  | "achievement_orientation"
  | "intellectual_curiosity"
  | "tolerance_for_ambiguity"
  | "initiative"
  | "adaptability"
  | "self_confidence"
  | "perseverance"
  | "leadership_orientation"
  | "humility"
  | "sincerity"
  | "empathy"
  | "cooperation"
  | "optimism"
  | "social_orientation"
  | "cautiousness"
  | "attention_to_detail"
  | "dependability"
  | "integrity"
  | "stress_tolerance"
  | "self_control";

export type WorkStyleInfo = {
  id: WorkStyle;
  /** O*NET element ID, e.g. "1.D.1.a". */
  elementId: string;
  onetName: string;
  group: WorkStyleGroup;
  /** Plain-language name and description (about a 7th-grade reading level), from O*NET's definitions. */
  name: string;
  description: string;
};

export const WORK_STYLES: readonly WorkStyleInfo[] = [
  { id: "innovation", elementId: "1.D.1.a", onetName: "Innovation", group: "achievement", name: "Innovation", description: "Coming up with new ideas and new ways to do things." },
  { id: "achievement_orientation", elementId: "1.D.1.b", onetName: "Achievement Orientation", group: "achievement", name: "Drive to achieve", description: "Setting challenging goals and working hard to reach them." },
  { id: "intellectual_curiosity", elementId: "1.D.1.c", onetName: "Intellectual Curiosity", group: "achievement", name: "Love of learning", description: "Wanting to learn new things and understand them deeply." },
  { id: "tolerance_for_ambiguity", elementId: "1.D.1.d", onetName: "Tolerance for Ambiguity", group: "achievement", name: "Handling the unknown", description: "Staying comfortable when things are unclear or there's no single right answer." },
  { id: "initiative", elementId: "1.D.1.e", onetName: "Initiative", group: "achievement", name: "Initiative", description: "Getting started without being asked and taking on extra tasks." },
  { id: "adaptability", elementId: "1.D.1.f", onetName: "Adaptability", group: "achievement", name: "Adaptability", description: "Being open to change, new experiences and new ideas." },
  { id: "self_confidence", elementId: "1.D.1.g", onetName: "Self-Confidence", group: "achievement", name: "Self-confidence", description: "Believing in your ability to do the work well." },
  { id: "perseverance", elementId: "1.D.1.h", onetName: "Perseverance", group: "achievement", name: "Perseverance", description: "Sticking with a task until it's done, even when it gets hard." },
  { id: "leadership_orientation", elementId: "1.D.1.i", onetName: "Leadership Orientation", group: "achievement", name: "Leadership", description: "Taking charge, sharing your ideas and helping a group decide what to do." },
  { id: "humility", elementId: "1.D.2.a", onetName: "Humility", group: "interpersonal", name: "Humility", description: "Being modest and giving others credit." },
  { id: "sincerity", elementId: "1.D.2.b", onetName: "Sincerity", group: "interpersonal", name: "Sincerity", description: "Being genuine and honest with people." },
  { id: "empathy", elementId: "1.D.2.c", onetName: "Empathy", group: "interpersonal", name: "Empathy", description: "Caring about others and noticing what they need and how they feel." },
  { id: "cooperation", elementId: "1.D.2.d", onetName: "Cooperation", group: "interpersonal", name: "Cooperation", description: "Being friendly, helpful and ready to pitch in." },
  { id: "optimism", elementId: "1.D.2.e", onetName: "Optimism", group: "interpersonal", name: "Optimism", description: "Staying positive, even when things are hard." },
  { id: "social_orientation", elementId: "1.D.2.f", onetName: "Social Orientation", group: "interpersonal", name: "Enjoying people", description: "Liking to work with people and getting energy from it." },
  { id: "cautiousness", elementId: "1.D.3.a", onetName: "Cautiousness", group: "conscientiousness", name: "Carefulness", description: "Thinking things through and avoiding risks before deciding." },
  { id: "attention_to_detail", elementId: "1.D.3.b", onetName: "Attention to Detail", group: "conscientiousness", name: "Attention to detail", description: "Being careful, organized and thorough." },
  { id: "dependability", elementId: "1.D.3.c", onetName: "Dependability", group: "conscientiousness", name: "Dependability", description: "Being reliable and doing what you said you would." },
  { id: "integrity", elementId: "1.D.3.d", onetName: "Integrity", group: "conscientiousness", name: "Integrity", description: "Being honest and doing the right thing." },
  { id: "stress_tolerance", elementId: "1.D.4.a", onetName: "Stress Tolerance", group: "adjustment", name: "Handling pressure", description: "Doing good work when things get busy or stressful." },
  { id: "self_control", elementId: "1.D.4.b", onetName: "Self-Control", group: "adjustment", name: "Self-control", description: "Staying calm and keeping your cool, even when someone criticizes your work." },
];

export const WORK_STYLE_INFO = Object.fromEntries(WORK_STYLES.map((s) => [s.id, s])) as Record<WorkStyle, WorkStyleInfo>;

const BY_ELEMENT_ID = new Map(WORK_STYLES.map((s) => [s.elementId, s.id]));

/** Our id for an O*NET element ID ("1.D.3.b" → "attention_to_detail"), or null if unknown. */
export function workStyleForElement(elementId: string | undefined): WorkStyle | null {
  return (elementId && BY_ELEMENT_ID.get(elementId.trim())) || null;
}

// ---------------------------------------------------------------------------
// Mini-IPIP traits → work styles
// ---------------------------------------------------------------------------

/**
 * The Big Five traits we connect to work styles. Emotional stability (the Mini-IPIP's neuroticism
 * scale) is left out by type: it's mood data about a minor, and the owner's decision is that it's
 * never used to rank careers. The 1.D.4 "adjustment" styles, its closest work styles, are never
 * mapped either.
 */
export type MappedTrait = Exclude<BigFive, "neuroticism">;
export const MAPPED_TRAITS: readonly MappedTrait[] = ["extraversion", "agreeableness", "conscientiousness", "intellect"];

/**
 * Which work styles each trait speaks to. Each style is the workplace form of a facet the trait's
 * Mini-IPIP items measure (imagination and ideas; orderliness and getting things done; sociability
 * and assertiveness; sympathy and care for others):
 *
 * - Openness/Intellect → Innovation, Intellectual Curiosity, Tolerance for Ambiguity, Adaptability.
 * - Conscientiousness → Attention to Detail, Dependability, Perseverance, Achievement Orientation.
 * - Extraversion → Social Orientation, Leadership Orientation.
 * - Agreeableness → Empathy, Cooperation.
 *
 * Not mapped: Initiative and Self-Confidence (they mix several traits, including emotional
 * stability), Humility and Sincerity (honesty-humility, which the Mini-IPIP doesn't measure),
 * Optimism (mostly emotional stability), Cautiousness and Integrity (only loosely tied to any one
 * trait), and Stress Tolerance and Self-Control (emotional stability, never used).
 *
 * Change this mapping only with a comment here giving the reason.
 */
export const TRAIT_WORK_STYLES: Record<MappedTrait, readonly WorkStyle[]> = {
  intellect: ["innovation", "intellectual_curiosity", "tolerance_for_ambiguity", "adaptability"],
  conscientiousness: ["attention_to_detail", "dependability", "perseverance", "achievement_orientation"],
  extraversion: ["social_orientation", "leadership_orientation"],
  agreeableness: ["empathy", "cooperation"],
};

const TRAIT_OF_STYLE = new Map<WorkStyle, MappedTrait>(
  MAPPED_TRAITS.flatMap((t) => TRAIT_WORK_STYLES[t].map((s) => [s, t] as const)),
);

/** The trait a work style is linked to, or null for styles we don't link to any trait. */
export function traitForStyle(style: WorkStyle): MappedTrait | null {
  return TRAIT_OF_STYLE.get(style) ?? null;
}

/** Every work style some trait is linked to. */
export const MAPPED_STYLES: readonly WorkStyle[] = [...TRAIT_OF_STYLE.keys()];

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export type OccupationWorkStyle = { style: WorkStyle; impact: number; distinctiveRank: number | null };

/** One occupation's work styles, most distinctive first. Empty when O*NET has none for it. */
export async function getOccupationWorkStyles(db: Db, code: string): Promise<OccupationWorkStyle[]> {
  const rows = await db
    .select({ style: occupationWorkStyles.style, impact: occupationWorkStyles.impact, distinctiveRank: occupationWorkStyles.distinctiveRank })
    .from(occupationWorkStyles)
    .where(eq(occupationWorkStyles.occupationCode, code))
    .orderBy(asc(occupationWorkStyles.distinctiveRank), asc(occupationWorkStyles.style));
  return rows.filter((r): r is OccupationWorkStyle => r.style in WORK_STYLE_INFO);
}

/**
 * The styles that most set an occupation apart (Distinctiveness Rank 1 first), at most `limit`.
 * Styles that hurt the work (negative impact) are never shown as ones that help.
 */
export function distinctiveStyles(styles: readonly OccupationWorkStyle[], limit = 5): WorkStyle[] {
  return styles
    .filter((s) => s.distinctiveRank !== null && s.distinctiveRank > 0 && s.impact > 0)
    .sort((a, b) => a.distinctiveRank! - b.distinctiveRank! || a.style.localeCompare(b.style))
    .slice(0, limit)
    .map((s) => s.style);
}

/**
 * Splits a career's key styles for a student who took the personality activity: styles linked to
 * a trait they scored high on ("high" on their strengths page) help, with that strength; the rest
 * are skills anyone can build. Styles linked to no trait, including stress tolerance and
 * self-control, are always in the second group: their emotional-stability score is never used.
 */
export function strengthsForCareer(styles: readonly WorkStyle[], traits: Record<BigFive, number>) {
  const helps: { style: WorkStyle; strength: Strength }[] = [];
  const building: WorkStyle[] = [];
  for (const style of styles) {
    const trait = traitForStyle(style);
    const strength = trait ? strengthFor(trait, traits[trait]) : null;
    if (strength?.level === "high") helps.push({ style, strength });
    else building.push(style);
  }
  return { helps, building };
}
