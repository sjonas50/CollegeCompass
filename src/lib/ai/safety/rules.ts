import { type SafetySignal, maxSignal } from "./types";

type Rule = SafetySignal & { pattern: RegExp };

// High-recall patterns for explicit statements. The model tier handles indirect language and
// benign uses (idioms, schoolwork about difficult topics). Patterns run on lowercased text with
// curly apostrophes normalized.
const RULES: Rule[] = [
  // Self-harm and suicide
  { category: "self_harm", severity: "imminent", pattern: /\b(going to|gonna|about to|will|plan(ning)? to)\s+(kill|hurt|cut)\s+myself\b/ },
  { category: "self_harm", severity: "imminent", pattern: /\b(tonight|today|right now)\b.*\b(kill myself|end (it|my life)|die)\b|\b(kill myself|end (it all|my life))\b.*\b(tonight|today|right now)\b/ },
  { category: "self_harm", severity: "imminent", pattern: /\bsuicide note\b|\bgoodbye (letter|note)s?\b/ },
  { category: "self_harm", severity: "high", pattern: /\b(kill(ing|ed)?|hurt(ing)?|cut(ting)?|hang(ing|ed)?|harm(ing|ed)?|burn(ing|ed)?)\s+myself\b/ },
  { category: "self_harm", severity: "high", pattern: /\b(want|wanna|wish)(ed)?\s+(to\s+)?(die|be dead|disappear forever|not wake up)\b|\bwish i (was|were) dead\b/ },
  { category: "self_harm", severity: "high", pattern: /\bend(ing)? my (own )?life\b|\bsuicidal\b|\bself[- ]harm(ing)?\b/ },
  { category: "self_harm", severity: "high", pattern: /\b(don'?t|do not) want to (be alive|live|exist)( anymore)?\b|\bno reason to live\b|\bbetter off (dead|without me)\b/ },
  { category: "self_harm", severity: "medium", pattern: /\bsuicide\b/ },

  // Abuse and safety at home
  { category: "abuse", severity: "high", pattern: /\b(my )?(dad|father|mom|mother|stepdad|stepmom|step-?parent|uncle|aunt|brother|sister|cousin|coach|teacher|boyfriend|girlfriend|parent'?s? boyfriend|he|she|they)\s+(hits|beats|chokes|kicks|burns|touches|touched|hit|beat|choked)\s+me\b/ },
  { category: "abuse", severity: "high", pattern: /\b(not|don'?t feel) safe at home\b|\b(scared|afraid) to go home\b|\b(sexually )?abus(ed|ing|es) me\b/ },

  // Violence toward others
  { category: "violence", severity: "high", pattern: /\b(going to|gonna|want to|wanna|plan(ning)? to)\s+(kill|shoot|stab|hurt)\s+(him|her|them|someone|somebody|people|everyone|my|the)\b/ },
  { category: "violence", severity: "imminent", pattern: /\b(bring|bringing)\s+a\s+(gun|knife|weapon)\s+to\s+school\b|\bschool shooting\b.*\b(i|i'm|im)\b/ },

  // Eating disorders
  { category: "eating_disorder", severity: "medium", pattern: /\bstarv(e|ing) myself\b|\b(make|making) myself (throw up|puke|vomit)\b|\bthrow(ing)? up after (i )?eat/ },
  { category: "eating_disorder", severity: "medium", pattern: /\b(stopped|stop) eating\b|\bhaven'?t eaten in (days|\d+ days)\b/ },

  // Substances
  { category: "substance_use", severity: "medium", pattern: /\b(took|taking|take) (a bunch of|too many|all my|all the) (pills|meds)\b|\boverdos(e|ed|ing)\b/ },

  // Bullying
  { category: "bullying", severity: "medium", pattern: /\b(being|getting|i'?m) bullied\b|\beveryone (hates|makes fun of) me\b/ },

  // General distress
  { category: "distress", severity: "low", pattern: /\b(hopeless|worthless|can'?t take (it|this) anymore|nobody (cares|would care)|no one (cares|would care))\b/ },
];

export function normalize(text: string) {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
}

/** The strongest rule match, or null. */
export function classifyWithRules(text: string): SafetySignal | null {
  const normalized = normalize(text);
  let best: SafetySignal | null = null;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) {
      best = maxSignal(best, { category: rule.category, severity: rule.severity });
    }
  }
  return best;
}
