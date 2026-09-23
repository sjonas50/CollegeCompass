/**
 * Assessment instruments. Items are stored in code and versioned; responses reference item ids.
 *
 * - Interests: O*NET Interest Profiler Short Form (60 items), verbatim under CC BY-ND 4.0.
 *   Rated on the 5-point like/dislike scale used by the validated computerized short form.
 * - Personality: Mini-IPIP (20 items, public domain), per the scoring key at ipip.ori.org.
 * - Values: a ranking of O*NET's six work values. Not a validated test; used to fine-tune matches.
 */

export type Riasec = "R" | "I" | "A" | "S" | "E" | "C";
export const RIASEC: readonly Riasec[] = ["R", "I", "A", "S", "E", "C"];

export const RIASEC_INFO: Record<Riasec, { name: string; short: string; description: string }> = {
  R: { name: "Realistic", short: "Doers", description: "Hands-on work: building, fixing, operating machines, working outdoors or with animals and plants." },
  I: { name: "Investigative", short: "Thinkers", description: "Figuring things out: science, research, solving problems with ideas and data." },
  A: { name: "Artistic", short: "Creators", description: "Making things that express ideas: art, music, writing, design, performing." },
  S: { name: "Social", short: "Helpers", description: "Working with people: teaching, caring for, coaching and helping others." },
  E: { name: "Enterprising", short: "Persuaders", description: "Leading and influencing: starting projects, selling ideas, managing and making decisions." },
  C: { name: "Conventional", short: "Organizers", description: "Keeping things in order: working with records, numbers, systems and clear procedures." },
};

export type ScaleOption = { value: number; label: string };

export const LIKE_SCALE: ScaleOption[] = [
  { value: 1, label: "Strongly dislike" },
  { value: 2, label: "Dislike" },
  { value: 3, label: "Not sure" },
  { value: 4, label: "Like" },
  { value: 5, label: "Strongly like" },
];

export const ACCURACY_SCALE: ScaleOption[] = [
  { value: 1, label: "Very inaccurate" },
  { value: 2, label: "Moderately inaccurate" },
  { value: 3, label: "Neither" },
  { value: 4, label: "Moderately accurate" },
  { value: 5, label: "Very accurate" },
];

export type InterestItem = { id: string; text: string; area: Riasec };

const INTEREST_TEXT: Record<Riasec, string[]> = {
  R: [
    "Build kitchen cabinets", "Lay brick or tile", "Repair household appliances", "Raise fish in a fish hatchery",
    "Assemble electronic parts", "Drive a truck to deliver packages to offices and homes", "Test the quality of parts before shipment",
    "Repair and install locks", "Set up and operate machines to make products", "Put out forest fires",
  ],
  I: [
    "Develop a new medicine", "Study ways to reduce water pollution", "Conduct chemical experiments", "Study the movement of planets",
    "Examine blood samples using a microscope", "Investigate the cause of a fire", "Develop a way to better predict the weather",
    "Work in a biology lab", "Invent a replacement for sugar", "Do laboratory tests to identify diseases",
  ],
  A: [
    "Write books or plays", "Play a musical instrument", "Compose or arrange music", "Draw pictures",
    "Create special effects for movies", "Paint sets for plays", "Write scripts for movies or television shows",
    "Perform jazz or tap dance", "Sing in a band", "Edit movies",
  ],
  S: [
    "Teach an individual an exercise routine", "Help people with personal or emotional problems", "Give career guidance to people",
    "Perform rehabilitation therapy", "Do volunteer work at a non-profit organization", "Teach children how to play sports",
    "Teach sign language to people who are deaf or hard of hearing", "Help conduct a group therapy session",
    "Take care of children at a day-care center", "Teach a high-school class",
  ],
  E: [
    "Buy and sell stocks and bonds", "Manage a retail store", "Operate a beauty salon or barber shop",
    "Manage a department within a large company", "Start your own business", "Negotiate business contracts",
    "Represent a client in a lawsuit", "Market a new line of clothing", "Sell merchandise at a department store", "Manage a clothing store",
  ],
  C: [
    "Develop a spreadsheet using computer software", "Proofread records or forms", "Install software across computers on a large network",
    "Operate a calculator", "Keep shipping and receiving records", "Calculate the wages of employees",
    "Inventory supplies using a hand-held computer", "Record rent payments", "Keep inventory records",
    "Stamp, sort, and distribute mail for an organization",
  ],
};

const interestItemsByArea = RIASEC.map((area) =>
  INTEREST_TEXT[area].map((text, i): InterestItem => ({ id: `${area}${i + 1}`, text, area })),
);

/** Interleaved (R1, I1, A1, … R2, I2, …) so each page mixes all six areas. */
export const INTEREST_ITEMS: InterestItem[] = Array.from({ length: 10 }, (_, i) =>
  interestItemsByArea.map((area) => area[i]),
).flat();

export type BigFive = "extraversion" | "agreeableness" | "conscientiousness" | "neuroticism" | "intellect";
export const BIG_FIVE: readonly BigFive[] = ["extraversion", "agreeableness", "conscientiousness", "neuroticism", "intellect"];

export type PersonalityItem = { id: string; text: string; factor: BigFive; keyed: 1 | -1 };

// Mini-IPIP (Donnellan et al., 2006) as keyed at https://ipip.ori.org/MiniIPIPKey.htm, in its
// standard administration order. IPIP items are public domain; "I" is added for readability.
export const PERSONALITY_ITEMS: PersonalityItem[] = [
  { id: "P1", text: "I am the life of the party.", factor: "extraversion", keyed: 1 },
  { id: "P2", text: "I sympathize with others' feelings.", factor: "agreeableness", keyed: 1 },
  { id: "P3", text: "I get chores done right away.", factor: "conscientiousness", keyed: 1 },
  { id: "P4", text: "I have frequent mood swings.", factor: "neuroticism", keyed: 1 },
  { id: "P5", text: "I have a vivid imagination.", factor: "intellect", keyed: 1 },
  { id: "P6", text: "I don't talk a lot.", factor: "extraversion", keyed: -1 },
  { id: "P7", text: "I am not interested in other people's problems.", factor: "agreeableness", keyed: -1 },
  { id: "P8", text: "I often forget to put things back in their proper place.", factor: "conscientiousness", keyed: -1 },
  { id: "P9", text: "I am relaxed most of the time.", factor: "neuroticism", keyed: -1 },
  { id: "P10", text: "I am not interested in abstract ideas.", factor: "intellect", keyed: -1 },
  { id: "P11", text: "I talk to a lot of different people at parties.", factor: "extraversion", keyed: 1 },
  { id: "P12", text: "I feel others' emotions.", factor: "agreeableness", keyed: 1 },
  { id: "P13", text: "I like order.", factor: "conscientiousness", keyed: 1 },
  { id: "P14", text: "I get upset easily.", factor: "neuroticism", keyed: 1 },
  { id: "P15", text: "I have difficulty understanding abstract ideas.", factor: "intellect", keyed: -1 },
  { id: "P16", text: "I keep in the background.", factor: "extraversion", keyed: -1 },
  { id: "P17", text: "I am not really interested in others.", factor: "agreeableness", keyed: -1 },
  { id: "P18", text: "I make a mess of things.", factor: "conscientiousness", keyed: -1 },
  { id: "P19", text: "I seldom feel blue.", factor: "neuroticism", keyed: -1 },
  { id: "P20", text: "I do not have a good imagination.", factor: "intellect", keyed: -1 },
];

export type WorkValue = "achievement" | "independence" | "recognition" | "relationships" | "support" | "working_conditions";
export const WORK_VALUES: readonly WorkValue[] = [
  "achievement", "independence", "recognition", "relationships", "support", "working_conditions",
];

/** Plain-language versions of O*NET's work value definitions. */
export const WORK_VALUE_INFO: Record<WorkValue, { name: string; onetName: string; description: string }> = {
  achievement: { name: "Using my strengths", onetName: "Achievement", description: "Work that uses what I'm good at and lets me see results." },
  independence: { name: "Independence", onetName: "Independence", description: "Working on my own, trying my own ideas and making decisions." },
  recognition: { name: "Recognition", onetName: "Recognition", description: "Chances to move up, lead others and be respected for my work." },
  relationships: { name: "Helping people", onetName: "Relationships", description: "Helping others and working with people I get along with." },
  support: { name: "Support", onetName: "Support", description: "A boss and a workplace that treat people fairly and back them up." },
  working_conditions: { name: "Security & stability", onetName: "Working Conditions", description: "Steady work, good pay and a job that keeps things interesting." },
};

export type InstrumentId = "interests" | "personality" | "values";

export const INSTRUMENTS = {
  interests: {
    id: "interests",
    version: "ipsf-1",
    title: "Interests",
    tagline: "60 quick activities. About 10 minutes.",
    itemIds: INTEREST_ITEMS.map((i) => i.id),
  },
  personality: {
    id: "personality",
    version: "mini-ipip-1",
    title: "Personality",
    tagline: "20 statements about you. About 5 minutes.",
    itemIds: PERSONALITY_ITEMS.map((i) => i.id),
  },
  values: {
    id: "values",
    version: "values-rank-1",
    title: "What matters to you",
    tagline: "Put 6 things in order. About 2 minutes.",
    itemIds: [...WORK_VALUES],
  },
} as const satisfies Record<InstrumentId, { id: InstrumentId; version: string; title: string; tagline: string; itemIds: readonly string[] }>;

export function isInstrumentId(value: string): value is InstrumentId {
  return value in INSTRUMENTS;
}

/** Valid response values per instrument: 1–5 ratings, or ranks 1–6 for values. */
export function isValidResponse(instrument: InstrumentId, itemId: string, value: number): boolean {
  if (!(INSTRUMENTS[instrument].itemIds as readonly string[]).includes(itemId)) return false;
  if (!Number.isInteger(value)) return false;
  return instrument === "values" ? value >= 1 && value <= WORK_VALUES.length : value >= 1 && value <= 5;
}
