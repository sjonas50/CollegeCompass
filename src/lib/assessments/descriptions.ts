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

type Guide = { label: string; school: string; work: string };

/**
 * What each trait level can mean at school and at work, and a short strength label for it. Like
 * TRAIT_COPY, every level is a strength: no level is a flaw to fix. Low scores never say what a
 * student can't or shouldn't do. "Staying calm" is written gently and never used to rank careers.
 */
export const TRAIT_GUIDE: Record<BigFive, Record<Level, Guide>> = {
  extraversion: {
    high: {
      label: "Outgoing",
      school: "Group projects, class discussions and clubs are great places to use your energy.",
      work: "You might enjoy work where you meet lots of people, speak up or lead a team.",
    },
    middle: {
      label: "Flexible with people",
      school: "You can do well in group work and on your own, so try some of both.",
      work: "You might enjoy work that mixes teamwork with time to focus on your own.",
    },
    low: {
      label: "Thoughtful",
      school: "You may do your best thinking on your own projects, in writing or in small groups.",
      work: "Quiet focus helps in every kind of job, including jobs with lots of people. You can find ways of working that suit you.",
    },
  },
  agreeableness: {
    high: {
      label: "Caring",
      school: "You help group work go well because you notice how others feel.",
      work: "Caring about people helps in any job, especially ones where you help, teach or look after others.",
    },
    middle: {
      label: "Fair-minded",
      school: "You can be a good teammate and still speak up for your own ideas.",
      work: "Being fair and kind helps you work well with all kinds of people.",
    },
    low: {
      label: "Direct",
      school: "You say what you think, which helps in debates and when a group has to decide.",
      work: "Being direct and fair helps when a job needs clear, honest decisions.",
    },
  },
  conscientiousness: {
    high: {
      label: "Organized",
      school: "Planning ahead helps you keep up with homework and big projects.",
      work: "Being reliable and careful is valued in almost every job.",
    },
    middle: {
      label: "Organized when it counts",
      school: "You can plan when it matters. A simple to-do list makes big projects easier.",
      work: "Knowing when to plan and when to go with the flow helps in lots of jobs.",
    },
    low: {
      label: "Spontaneous",
      school: "You go with the flow. A planner or phone reminders can help you keep track of due dates.",
      work: "Being flexible helps when plans change. Getting organized is a skill anyone can build, one habit at a time.",
    },
  },
  neuroticism: {
    high: {
      label: "Steady",
      school: "Staying steady can help you during tests and busy weeks.",
      work: "Keeping calm helps in any job when things get busy.",
    },
    middle: {
      label: "Bounces back",
      school: "Everyone feels stressed sometimes. Sleep, breaks and talking with someone you trust help.",
      work: "Knowing how to reset after a hard day helps in every job.",
    },
    low: {
      label: "Feels things deeply",
      school: "Noticing stress early is a strength. Breaks, sleep and talking with someone you trust can help.",
      work: "Feeling things deeply can help you understand other people. Handling stress is a skill anyone can learn.",
    },
  },
  intellect: {
    high: {
      label: "Curious",
      school: "You may enjoy classes that make you think and ask big questions, in science, writing, art or anything else.",
      work: "Work where you keep learning, solve problems or create new things may keep you interested.",
    },
    middle: {
      label: "Practical",
      school: "You learn best when you can see how an idea is used in real life.",
      work: "You might enjoy work where new ideas get put to real use.",
    },
    low: {
      label: "Hands-on",
      school: "You learn well by doing: labs, projects, shop classes and real examples.",
      work: "Work where you can see and use the results of what you do may suit you.",
    },
  },
};

/** The traits connected to careers, in the order the strengths view lists them. Staying calm isn't one. */
const CAREER_TRAITS = ["intellect", "conscientiousness", "extraversion", "agreeableness"] as const satisfies readonly BigFive[];

export type Strength = { trait: BigFive; name: string; label: string; text: string; school: string; work: string; level: Level };

export function strengthFor(trait: BigFive, score: number): Strength {
  const shown = displayTrait(trait, score);
  const level = traitLevel(shown.score);
  return { trait, name: shown.name, text: shown.text, level, ...TRAIT_GUIDE[trait][level] };
}

/**
 * A student's five strengths for display: the four traits connected to careers first, the ones
 * that stand out most (furthest from the middle, either way) first, and "Staying calm" last.
 */
export function strengthsFor(traits: Record<BigFive, number>): Strength[] {
  const ordered = [...CAREER_TRAITS].sort((a, b) => Math.abs(traits[b] - 50) - Math.abs(traits[a] - 50));
  return [...ordered, "neuroticism" as const].map((t) => strengthFor(t, traits[t]));
}

/** Trait names to use in a sentence, e.g. "curiosity, organization and warmth". */
export function traitNames(traits: readonly BigFive[]): string {
  const names = traits.map((t) => TRAIT_COPY[t].name.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** A short summary, e.g. "Curious, organized and caring": the three that stand out most, never "Staying calm". */
export function strengthsSummary(traits: Record<BigFive, number>): string {
  const labels = strengthsFor(traits)
    .filter((s) => s.trait !== "neuroticism")
    .slice(0, 3)
    .map((s, i) => (i === 0 ? s.label : s.label.toLowerCase()));
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
