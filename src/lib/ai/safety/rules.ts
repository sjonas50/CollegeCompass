import { type SafetySignal, maxSignal } from "./types";

// `unless` marks context in which a pattern is usually benign; those messages fall through to the
// lower-severity rules and the model decides.
type Rule = SafetySignal & { pattern: RegExp; unless?: RegExp };

const rx = (source: string) => new RegExp(source);

// Timeframes turn intent into a plan.
const TIME = String.raw`(tonight|today|right now|rn|this weekend|tomorrow|after school|before (school|morning|first period)|by (then|tomorrow|friday|the weekend)|this week|(on |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)( night| after school)?|in (a few|a couple( of)?|an?) (hours?|days?|minutes?))`;
// A negation just before the phrase: "I'm not gonna kms lol", "I haven't cut myself in months".
const NOT = String.raw`(?<!\b(not|never|don'?t|dont|won'?t|wont|haven'?t|havent|didn'?t|didnt|wouldn'?t|wouldnt|isn'?t|ain'?t|aint)\s+((actually|really|ever|even|seriously)\s+)?((going to|gonna|finna|about to|planning to|trying to)\s+)?)`;
const INTENT = String.raw`(going to|gonna|finna|about to|i'?ll|i will|plan(ning)? to|ready to)`;
// Unambiguous ways of saying suicide.
const SUICIDE = String.raw`(kill myself|end(ing)? (it all|my life)|take my (own )?life|unaliv(e|ing) myself)`;
// "End it" is as often a breakup or an essay. With one of these objects, or this context anywhere in
// the message, "end it" stays medium.
const BENIGN_END_OBJECT = String.raw`(?!\s+(with|w/?)\s+(him|her|them|us|my\s+(ex|bf|gf|boyfriend|girlfriend|partner|crush|friend|best friend)|(the|that|this|our)\s+(guy|girl|relationship|friendship|group chat|team)|(a|an|the|my)\s+((strong|good|short|funny)\s+)?(conclusion|quote|question|story|paragraph|sentence|essay|speech|joke|song|bang|twist)))`;
const END_IT_CONTEXT =
  /\b(essay|story|conclusion|paragraph|speech|poem|chapter|book|novel|song|video|game|match|season|episode|project|presentation|call|meeting|argument|fight|streak|club|bf|gf|boyfriend|girlfriend|relationship|dating|broke up|break up|breakup|my ex|crush|friendship|situationship|talking stage)\b/;
const FICTION = /\b(story|character|novel|book|poem|essay|fiction|protagonist|villain|plot|movie|show|script|scene)\b/;
const PILLS = String.raw`(pills|pill|meds|medication|medicine|tablets|tylenol|advil|ibuprofen|benadryl|xanax|melatonin|painkillers)`;
// "I took..." or a sentence that starts with the verb ("took a bunch of pills an hour ago"), not "my dad took".
const SELF = String.raw`(^|[.!?,;:]\s*|\b(i'?m|im|i am|i)\s+)((just|already|literally|actually)\s+)?`;
const LOTS = String.raw`(all\s+(of\s+)?(my|the|her|his|mom'?s|moms|dad'?s|dads|grandma'?s|grandpa'?s)\s+([a-z']+\s+){0,2}|the\s+(whole|entire|rest of the)\s+(bottle|pack|box)\s+(of\s+)?([a-z']+\s+){0,3}|(most|half|the rest)\s+of\s+(a|the|my|her|his|mom'?s|moms|dad'?s|dads)\s+([a-z']+\s+){0,5}|the rest of\s+([a-z']+\s+){0,3}|(like\s+|about\s+|over\s+)?(\d{2,}|[6-9])\s+([a-z']+\s+)?)`;
const SOME = String.raw`(a\s+(whole\s+)?bunch\s+of|too\s+many|a\s+(ton|lot)\s+of|a\s+handful\s+of|so\s+many)\s+([a-z']+\s+)?`;
const HEIGHT = String.raw`jump(ing)?\s+(off|from)\b.{0,30}?\b(bridge|roof|rooftop|building|overpass|balcony|parking garage|garage|cliff|tower|window)\b`;
const WATER = /\b(pool|lake|river|water|ocean|trampoline|diving|swim|cliff jumping|parkour|skydiv|bungee|parachute)\b/;

// High-recall patterns for explicit statements; the model tier handles indirect language and
// benign uses. Rules rated high or imminent override the model (see combineSignals), so those tiers
// only hold phrasings that are unambiguous. Ambiguous slang ("kms", "I'm gonna die", "end it") is
// medium: the model decides when it runs. Patterns run on lowercased text with curly apostrophes
// normalized. Every self-harm rule is pinned by the phrasing tables in rules.test.ts.
const RULES: Rule[] = [
  // Self-harm and suicide: imminent (a plan, a method, a timeframe, or it's happening now)
  { category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b(going to|gonna|finna|about to|will|plan(ning)? to)\s+(kill|hurt|cut)\s+myself\b`) },
  { category: "self_harm", severity: "imminent", pattern: rx(String.raw`\b${TIME}\b.*${NOT}\b${SUICIDE}\b|${NOT}\b${SUICIDE}\b.*\b${TIME}\b`) },
  { category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+(end (it all|my life)|take my (own )?life|unalive myself)\b|\b(i'?m|im|i am)\s+ending\s+(it all|my life)\b`) },
  {
    category: "self_harm",
    severity: "imminent",
    pattern: rx(String.raw`${NOT}\b${INTENT}\s+end\s+(it|things)\b${BENIGN_END_OBJECT}.*\b${TIME}\b|\b${TIME}\b.*${NOT}\b${INTENT}\s+end\s+(it|things)\b${BENIGN_END_OBJECT}`),
    unless: END_IT_CONTEXT,
  },
  { category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+kms\b.*\b${TIME}\b|\b${TIME}\b.*${NOT}\b${INTENT}\s+kms\b`) },
  {
    category: "self_harm",
    severity: "imminent",
    // A method: "end it with pills", "end my life with my dad's gun".
    pattern: rx(String.raw`\bend(ing)?\s+(it|it all|my life|things|everything)\s+(with|by|using|w/?)\s+((some|my|the|a|mom'?s|moms|dad'?s|dads)\s+)*(${PILLS}|gun|knife|rope|blade|razor|belt|jumping|overdos\w*|hanging|cutting)`),
    unless: FICTION,
  },
  {
    category: "self_harm",
    severity: "imminent",
    // An overdose that just happened or is planned.
    pattern: rx(
      String.raw`${SELF}(took|swallowed|popped|downed|ate)\s+${LOTS}${PILLS}\b` +
        String.raw`|${SELF}(took|swallowed|popped|downed)\s+${SOME}${PILLS}\b.*\b(ago|just now|rn|right now|and now|i'?m scared|im scared|feel (sick|weird|dizzy|funny))\b` +
        String.raw`|(^|[.!?,;:]\s*|\bi\s+)just\s+(took|swallowed|popped|downed)\s+${SOME}${PILLS}\b` +
        String.raw`|${NOT}\b(${INTENT}|want to|wanna)\s+(take|swallow|down|od on)\s+(${LOTS}|${SOME})${PILLS}\b` +
        String.raw`|\b${PILLS}\b.*${NOT}\b(${INTENT}|i'?m|im)\s+(take|taking|swallow|swallowing)\s+(all|every one|every single one)\s+of\s+them\b`,
    ),
  },
  { category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+${HEIGHT}`), unless: WATER },
  { category: "self_harm", severity: "imminent", pattern: /\b(wrote|writing|write|written|left|leave|leaving|finished|started)\s+(a|my)\s+suicide\s+note\b|\bmy suicide note\b/ },

  // Self-harm: high (clear, first-person)
  { category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(kill(ing|ed)?|hurt(ing)?|cut(ting)?|hang(ing|ed)?|harm(ing|ed)?|burn(ing|ed)?)\s+myself\b`) },
  { category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(want|wanna|wish)(ed)?\s+(to\s+)?(die|be dead|disappear forever|not wake up)\b|\bwish i (was|were) (dead|never born)\b|\bwish i (wasn'?t|weren'?t|wasnt|werent) alive\b`) },
  { category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(end(ing)? my (own )?life|take my (own )?life)\b|\b(want|wanna|need|thinking about|think about|thought about)\s+(to\s+)?end(ing)?\s+it\s+all\b`) },
  { category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(gonna|going to|about to|finna|i'?ll|i will|want to|wanna|plan(ning)? to)\s+kms\b`) },
  { category: "self_harm", severity: "high", pattern: rx(String.raw`\b(thinking about|think about|thought about|want to|wanna)\s+${HEIGHT}`), unless: WATER },
  { category: "self_harm", severity: "high", pattern: /\bend(ing)?\s+(it|it all|things|my life)\s+without\s+(anyone|anybody|people)\s+(noticing|knowing|finding out)\b/ },
  { category: "self_harm", severity: "high", pattern: /\b(saving|saved|stockpiling|stockpiled|hoarding|hoarded)\s+(up\s+)?(my\s+|the\s+|some\s+|her\s+|his\s+|mom'?s\s+|moms\s+|dad'?s\s+|dads\s+)?(pills|meds)\b/ },
  {
    category: "self_harm",
    severity: "high",
    pattern: /\b(i'?m|i am|i feel|feeling|been|getting|get|i have|having|had)\s+((so|really|kinda|kind of|pretty|super|very)\s+)?suicidal\b|\bmy suicidal (thoughts|feelings)\b|\bi('ve| have)?\s*(been\s+)?self[- ]harm(ing|ed)?\b|\bi self[- ]harm\b/,
  },
  { category: "self_harm", severity: "high", pattern: /\b(don'?t|do not) want to (be alive|live|exist)( anymore)?\b|\bno reason to live\b|\bbetter off (dead|without me)\b/ },
  {
    category: "self_harm",
    severity: "high",
    // Coded or shorthand language that stays unambiguous in context.
    pattern: /\b(been|started|still|keep|kept|i'?m)\s+cutting(\s+again)?\b(?!\s+(class|classes|school|hair|corners|back|down|out|weight|coupons|wood|fabric|paper))|\bcutting again\b(?!\s+(class|classes|school))|\bunaliv(e|ing)\s+(myself|me)\b|\b(don'?t|do not)\s+plan\s+on\s+(being|sticking)\s+(here|around)\b/,
  },

  // Self-harm: medium (ambiguous alone; the model decides)
  { category: "self_harm", severity: "medium", pattern: /\bsuicidal\b|\bself[- ]harm(ing)?\b|\bsuicide\b/ },
  { category: "self_harm", severity: "medium", pattern: /\b(kill|hurt|cut|harm|hang|burn)(ing|ed)?\s+myself\b|\bkms\b|\bend(ing)? (it|it all|things|my life)\b|\bgoodbye (letter|note|post)s?\b|\bi'?d rather (die|be dead)\b/ },
  { category: "self_harm", severity: "medium", pattern: rx(String.raw`\b(gonna|going to|i'?ll|might) die\b.*\b${TIME}\b|\b${TIME}\b.*\b(gonna|going to|i'?ll|might) die\b`) },

  // Abuse and safety at home
  { category: "abuse", severity: "high", pattern: /\b(my )?(dad|father|mom|mother|stepdad|stepmom|step-?parent|uncle|aunt|brother|sister|cousin|coach|teacher|boyfriend|girlfriend|parent'?s? boyfriend|he|she|they)\s+(hits|beats|chokes|kicks|burns|touches|touched|hit|beat|choked)\s+me\b/ },
  { category: "abuse", severity: "high", pattern: /\b(not|don'?t feel) safe at home\b|\b(scared|afraid) to go home\b|\b(sexually )?abus(ed|ing|es) me\b/ },
  {
    category: "abuse",
    severity: "high",
    // Sextortion: someone holding images of the student, or threatening to post them unless paid.
    pattern:
      /\b(nudes|nude (pics|pictures|photos)|naked (pics|pictures|photos|videos?)|explicit (pics|photos|videos?))\s+of\s+me\b|\b(unless|if)\s+i\s+(don'?t\s+|dont\s+|do not\s+)?(pay|send\s+(him\s+|her\s+|them\s+)?(a\s+|another\s+|more\s+|the\s+)?(video|vid|pic|pics|picture|pictures|photo|photos|nudes))\b.*\b(post|posting|send|sending|share|sharing|leak|leaking|tag|tagging)\b|\b(post|posting|share|sharing|leak|leaking)\b.*\b(unless|if)\s+i\s+(don'?t\s+|dont\s+|do not\s+)?(pay|send)\b/,
  },

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
  return (
    text
      .toLowerCase()
      // Invisible characters would otherwise split a phrase ("kill\u200Bmyself") past the patterns.
      .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/\s+/g, " ")
  );
}

/** The strongest rule match, or null. */
export function classifyWithRules(text: string): SafetySignal | null {
  const normalized = normalize(text);
  let best: SafetySignal | null = null;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized) && !rule.unless?.test(normalized)) {
      best = maxSignal(best, { category: rule.category, severity: rule.severity });
    }
  }
  return best;
}
