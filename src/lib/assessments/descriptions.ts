import type { BigFive } from "./instruments";

type Level = "high" | "middle" | "low";

export function traitLevel(score: number): Level {
  if (score >= 67) return "high";
  if (score <= 33) return "low";
  return "middle";
}

/**
 * Strengths-based descriptions for students. Every level is framed as a way of being, not a
 * deficit. Neuroticism is shown reversed, as "staying calm".
 */
export const TRAIT_COPY: Record<BigFive, { name: string; reversed?: boolean } & Record<Level, string>> = {
  extraversion: {
    name: "Social energy",
    high: "You get energy from being around people and feel comfortable speaking up.",
    middle: "You enjoy people and also value time on your own, and you can adapt to both.",
    low: "You recharge with quieter time and think before you speak — a strength for focused, careful work.",
  },
  agreeableness: {
    name: "Warmth",
    high: "You're caring and tuned in to how other people feel.",
    middle: "You care about others and can also stand your ground when it matters.",
    low: "You're direct and objective, and you can make tough calls without being swayed.",
  },
  conscientiousness: {
    name: "Organization",
    high: "You like to plan ahead and get things done.",
    middle: "You can be organized when it counts and flexible when it doesn't.",
    low: "You're flexible and spontaneous. Simple habits, like a planner, can help you reach big goals.",
  },
  neuroticism: {
    name: "Staying calm",
    reversed: true,
    high: "You tend to stay steady when things get stressful.",
    middle: "You feel stress like everyone does, and you usually bounce back.",
    low: "You feel things deeply. Noticing stress early and knowing what helps you recharge will serve you well — that's a skill anyone can build.",
  },
  intellect: {
    name: "Curiosity",
    high: "You love ideas, imagination, and big questions.",
    middle: "You're curious about ideas, especially ones you can put to use.",
    low: "You like things that are concrete and practical, and you learn best by doing.",
  },
};

/** The level to display, with reversed traits flipped (low neuroticism = high "staying calm"). */
export function displayTrait(trait: BigFive, score: number) {
  const copy = TRAIT_COPY[trait];
  const shown = copy.reversed ? 100 - score : score;
  return { name: copy.name, score: shown, text: copy[traitLevel(shown)] };
}
