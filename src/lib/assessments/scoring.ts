import {
  BIG_FIVE,
  type BigFive,
  INSTRUMENTS,
  INTEREST_ITEMS,
  type InstrumentId,
  PERSONALITY_ITEMS,
  RIASEC,
  type Riasec,
  WORK_VALUES,
  type WorkValue,
} from "./instruments";

/**
 * Recorded with each result and match run. "2": career matches count personality lightly
 * (src/lib/matching/match.ts). "3": match lists leave out careers that are for adults only, and
 * show at most one college teaching job and one modeling job in each group
 * (src/lib/matching/minors.ts). Assessment scoring itself is unchanged since "1".
 */
export const SCORING_VERSION = "3";

/** The first SCORING_VERSION whose match runs count personality (and record it only when it counted). */
export const PERSONALITY_COUNTS_SINCE = 2;

export type Responses = Record<string, number>;

export type InterestScores = {
  /** Raw area scores, 0–40 (ten items rated 0–4). */
  areas: Record<Riasec, number>;
  /** Top three areas, highest first, e.g. "IAS". */
  code: string;
};

export type PersonalityScores = {
  /** 0–100 per trait (mean item score rescaled). Neuroticism as keyed by the Mini-IPIP. */
  traits: Record<BigFive, number>;
};

export type ValuesScores = {
  /** 1 = most important. */
  ranking: WorkValue[];
};

export type ScoresFor = { interests: InterestScores; personality: PersonalityScores; values: ValuesScores };

export function missingItems(instrument: InstrumentId, responses: Responses): string[] {
  return INSTRUMENTS[instrument].itemIds.filter((id) => responses[id] === undefined);
}

export function scoreInterests(responses: Responses): InterestScores {
  const areas = Object.fromEntries(RIASEC.map((a) => [a, 0])) as Record<Riasec, number>;
  for (const item of INTEREST_ITEMS) areas[item.area] += responses[item.id] - 1;
  // Ties keep RIASEC order, so the code is deterministic.
  const code = [...RIASEC]
    .sort((a, b) => areas[b] - areas[a])
    .slice(0, 3)
    .join("");
  return { areas, code };
}

export function scorePersonality(responses: Responses): PersonalityScores {
  const sums = Object.fromEntries(BIG_FIVE.map((f) => [f, 0])) as Record<BigFive, number>;
  const counts = Object.fromEntries(BIG_FIVE.map((f) => [f, 0])) as Record<BigFive, number>;
  for (const item of PERSONALITY_ITEMS) {
    const raw = responses[item.id];
    sums[item.factor] += item.keyed === 1 ? raw : 6 - raw;
    counts[item.factor] += 1;
  }
  const traits = Object.fromEntries(
    BIG_FIVE.map((f) => [f, Math.round(((sums[f] / counts[f] - 1) / 4) * 100)]),
  ) as Record<BigFive, number>;
  return { traits };
}

/** Values responses map each value to its rank (1–6); ranks must be a permutation. */
export function scoreValues(responses: Responses): ValuesScores {
  const ranks = WORK_VALUES.map((v) => responses[v]);
  if (new Set(ranks).size !== WORK_VALUES.length) throw new Error("Each value needs a unique rank");
  return { ranking: [...WORK_VALUES].sort((a, b) => responses[a] - responses[b]) };
}

export function score<I extends InstrumentId>(instrument: I, responses: Responses): ScoresFor[I] {
  const missing = missingItems(instrument, responses);
  if (missing.length > 0) throw new Error(`Missing responses: ${missing.join(", ")}`);
  switch (instrument) {
    case "interests":
      return scoreInterests(responses) as ScoresFor[I];
    case "personality":
      return scorePersonality(responses) as ScoresFor[I];
    default:
      return scoreValues(responses) as ScoresFor[I];
  }
}
