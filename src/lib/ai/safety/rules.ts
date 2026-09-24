import { type SafetySignal, maxSignal } from "./types";

/**
 * Keyword rules, in two tiers.
 *
 * - "explicit": unambiguous first-person statements ("I'm going to kill myself", "I want to die",
 *   "he has nudes of me"). At high or imminent these stand even when the safety model says the
 *   message is fine, so they must almost never fire on ordinary teen messages. Every phrase that
 *   has shown up as a false alarm is pinned in rules.test.ts.
 * - "outage": broader patterns (overdose, method, jump, "end it tonight", "kms", misspellings) used
 *   only when the safety model couldn't run. Then the counselor is usually down too, so showing
 *   crisis resources to a student who is fine costs little, and missing a crisis costs a lot.
 *
 * Patterns run on normalized text (lowercase, curly apostrophes straightened, invisible characters
 * handled). `unless` is checked against the clause around the match, never the whole message, so
 * one word elsewhere ("game", "essay") can't hide a crisis.
 */
type Tier = "explicit" | "outage";
type Rule = SafetySignal & { tier: Tier; pattern: RegExp; unless?: RegExp };

const rx = (source: string) => new RegExp(source);

// Timeframes turn intent into a plan.
const TIME = String.raw`(tonight|tonite|2nite|today|2day|right now|rn|this weekend|tomorrow|tmrw|tmr|after school|before (school|morning|first period)|by (then|tomorrow|friday|the weekend)|this week|(on |this )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)( night| after school)?|in (a few|a couple( of)?|an?) (hours?|days?|minutes?))`;
// A negation just before the phrase: "I'm not gonna kms lol", "I haven't cut myself in months".
// "why not" / "or not" aren't negations of what follows.
const NOT = String.raw`(?<!(?<!\b(why|or|whether)\s+)\b(not|never|don'?t|dont|won'?t|wont|haven'?t|havent|didn'?t|didnt|wouldn'?t|wouldnt|isn'?t|ain'?t|aint)\s+((actually|really|ever|even|seriously)\s+)?((going to|gonna|finna|about to|planning to|trying to)\s+)?)`;
const INTENT = String.raw`(going to|gonna|finna|about to|i'?ll|i will|will|plan(ning)? to|ready to|decided to)`;
const WANT = String.raw`(want|wanna|wana|wanta|wish|wished|wanted)`;
const MYSELF = String.raw`my ?self`;
// "Take my life" is also "take my life back / seriously / in a new direction".
const TAKE_MY_LIFE = String.raw`take my (own )?life(?!\s+(back|seriously|more|in|into|to|path|further|forward|over|around|up|somewhere|places|one|by|as|for|a|the)\b)`;
const COMMIT = String.raw`commit(ting)? suicide`;
// Unambiguous ways of saying suicide.
const SUICIDE = String.raw`(kill?|shoot|hang|poison|off) ${MYSELF}|end(ing)? my (own )?life|${TAKE_MY_LIFE}|${COMMIT}|unaliv(e|ing) ${MYSELF}`;
// "I've been killing myself studying" is hyperbole.
const HYPERBOLE_AFTER = String.raw`(?!\s+(laughing|studying|trying|working|practicing|over (this|that|it|a|an|the)|to (get|finish|make|keep|study|learn|pass)|for (this|that|a|an|the)|at (the gym|practice|work)|with (work|homework|studying))\b)`;
const PILLS = String.raw`(pills|pill|meds|medication|medicine|tablets|tylenol|advil|ibuprofen|benadryl|xanax|melatonin|painkillers|sleeping pills|oxy|percs?)`;
// "I took..." or a sentence that starts with the verb ("took a bunch of pills an hour ago"), not "my dad took".
const SELF = String.raw`(^|[.!?,;:]\s*|\b(i'?m|im|i am|i)\s+)((just|already|literally|actually)\s+)?`;
const COUNT = String.raw`((like|about|over|around)\s+)?(\d{2,}|[6-9]|ten|twelve|fifteen|twenty|thirty|forty|fifty|a hundred)\s+(?!(mg|mcg|ml|milligrams?|hours?|minutes?|mins?)\b)`;
const LOTS = String.raw`(all\s+(of\s+)?(my|the|her|his|mom'?s|moms|dad'?s|dads|grandma'?s|grandpa'?s)\s+([a-z']+\s+){0,2}|the\s+(whole|entire|rest of the)\s+(bottle|pack|box)\s*(of\s+)?([a-z']+\s+){0,3}|(most|half|the rest)\s+of\s+(a|the|my|her|his|mom'?s|moms|dad'?s|dads)\s+([a-z']+\s+){0,5}|the rest of\s+([a-z']+\s+){0,3}|${COUNT}([a-z']+\s+)?(of\s+([a-z']+\s+){0,2})?)`;
const SOME = String.raw`(a\s+(whole\s+)?bunch\s+of|too\s+many|a\s+(ton|lot)\s+of|a\s+handful\s+of|so\s+many)\s+([a-z']+\s+)?`;
const HEIGHT = String.raw`jump(ing)?\s+(off|from)\b.{0,30}?\b(bridge|roof|rooftop|building|overpass|balcony|parking garage|garage|cliff|tower|window)\b|jump(ing)?\s+in front of\s+(a|the)\s+(train|car|bus|truck)`;
// Jumping in a game or into water.
const PLAY = /\b(minecraft|fortnite|roblox|gta|assassin'?s creed|zelda|mario|in (the |a )?(game|video game)|into (the |a )?(pool|lake|river|water|ocean)|cliff jumping|trampoline|parkour|skydiv\w*|bungee|parachute)\b/;
// "End it with him", "end it with Jake", "end it with a strong conclusion". Methods aren't benign.
const BENIGN_END_OBJECT = String.raw`(?!\s+(with|w/?)\s+(?!(some|my|the|a|mom'?s|moms|dad'?s|dads)?\s*${PILLS}|(a|my|the|mom'?s|dad'?s)\s+(gun|knife|rope|blade|razor|belt)))`;
const FICTION = /\b(story|character|novel|poem|fiction|protagonist|villain|plot|movie|script|scene)\b/;
const ACCIDENT = /\b(practice|game|gym|shaving|shave|stove|oven|cooking|baking|playing|workout|lifting|running|soccer|football|basketball|volleyball|softball|baseball|skating|skateboard|bike|fell|accident(ally)?|by accident|paper cut|onions?|curling iron|straightener|bangs|hair)\b/;
// Sextortion pieces.
const IMAGES = String.raw`(nudes|nude (pics|pictures|photos)|naked (pics|pictures|photos|videos?)|explicit (pics|photos|videos?))`;
const THREAT = String.raw`(?<!(can'?t|cannot|won'?t|wont|not|never)\s+)\b(post|leak|share|spread|expose|tag)\w*\s+(them|it|those|the (first |other |last |old )?(one|ones|pics|photos|pictures|video|videos|vid)|my (pics|photos|pictures|videos?|nudes))\b`;
const CONDITION = String.raw`\b(unless\s+i\s+(pay|send)|if\s+i\s+(don'?t|dont|do not|won'?t|wont)\s+(pay|send))\b`;

const RULES: Rule[] = [
  // --- Explicit: self-harm and suicide ---------------------------------------------------------
  // Imminent: intent to act, a timeframe, or a note.
  { tier: "explicit", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b(going to|gonna|finna|about to|will|i'?ll|plan(ning)? to|ready to|decided to)\s+(kill?|shoot|hang|poison|stab|drown|off) ${MYSELF}\b${HYPERBOLE_AFTER}`) },
  { tier: "explicit", category: "self_harm", severity: "imminent", pattern: rx(String.raw`\b${TIME}\b.*${NOT}\b(${SUICIDE})\b|${NOT}\b(${SUICIDE})\b.*\b${TIME}\b`) },
  { tier: "explicit", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+(end my (own )?life|${TAKE_MY_LIFE}|${COMMIT}|unalive ${MYSELF})`) },
  { tier: "explicit", category: "self_harm", severity: "imminent", pattern: /\b(wrote|writing|write|written|left|leave|leaving|finished|started)\s+(a|my)\s+suicide\s+note\b|\bmy suicide note\b/ },
  // High: first-person statements.
  { tier: "explicit", category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(kill(ing|ed)?|kil|shoot(ing)?|hang(ing|ed)?|poison(ing|ed)?|stab(bing|bed)?|drown(ing|ed)?|off(ing)?)\s+${MYSELF}\b${HYPERBOLE_AFTER}`) },
  {
    tier: "explicit",
    category: "self_harm",
    severity: "high",
    pattern: rx(String.raw`${NOT}\b${WANT}\s+(to\s+|2\s+)?(die|be dead|not (wake up|exist))\b(?!\s+((my|your|his|her|their|our)\s+hair|of|from|laughing|for|in (a|the) (game|movie))\b)|\bwish i (was|were) (dead|never born)\b|\bwish i (wasn'?t|weren'?t|wasnt|werent) alive\b`),
  },
  { tier: "explicit", category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(end(ing)? my (own )?life|${TAKE_MY_LIFE})|\b(want to|wanna|going to|gonna|thinking (about|of)|think about|thought about|plan(ning)? to|might|should i|ready to|trying to|tried to|about to)\s+(${COMMIT}|kill(ing)? ${MYSELF})|\bunaliv(e|ing)\s+(${MYSELF}|me)\b`) },
  {
    tier: "explicit",
    category: "self_harm",
    severity: "high",
    pattern: /\b(i'?m|i am|i feel|feeling|been|getting|get|i have|having|had)\s+((so|really|kinda|kind of|pretty|super|very)\s+)?suicidal\b|\bmy suicidal (thoughts|feelings)\b|\bi('ve| have)?\s*(been\s+)?self[- ]harm(ing|ed)?\b|\bi self[- ]harm\b/,
  },
  {
    tier: "explicit",
    category: "self_harm",
    severity: "high",
    pattern: /\b(don'?t|dont|do not)\s+(want|wanna|wana)\s+(to\s+)?(be alive|exist)\b|\b(don'?t|dont|do not)\s+(want|wanna|wana)\s+(to\s+)?live\b(?!\s+(in|with|at|on|near|there|here|alone|far|close|off|by|like|a|my|that|this|the|so|through|without)\b)|\bno reason to live\b|\bbetter off (dead|without me)\b/,
  },
  {
    tier: "explicit",
    category: "self_harm",
    severity: "high",
    // Self-injury, in the present tense. Accidents ("hurt myself at practice") are excluded.
    pattern: rx(String.raw`\b(i'?ve been|ive been|i keep|i kept|i started|i'?m|im|been|still)\s+(cutting|burning|hurting|harming)\s+${MYSELF}\b(?!\s+(off|out|some|a|slack|free|short)\b)`),
    unless: ACCIDENT,
  },
  {
    tier: "explicit",
    category: "self_harm",
    severity: "high",
    // Coded or shorthand language that stays unambiguous in context.
    pattern: /\b(been|started|still|keep|kept|i'?m)\s+cutting(\s+again)?\b(?!\s+(class|classes|school|hair|corners|back|down|out|weight|coupons|wood|fabric|paper|onions?|vegetables|it close|in line|ties|off|my ?self)\b)|\bcutting again\b(?!\s+(class|classes|school))|\b(don'?t|do not)\s+plan\s+on\s+(being|sticking)\s+(here|around)\b/,
    unless: /\b(onions?|vegetables|hair|bangs|coupons|class|school|fabric|paper|wood|lawn|grass)\b/,
  },

  // --- Explicit: abuse, sextortion, violence -----------------------------------------------------
  {
    tier: "explicit",
    category: "abuse",
    severity: "high",
    pattern: /\b(my )?(dad|father|mom|mother|stepdad|stepmom|step-?parent|uncle|aunt|brother|sister|cousin|coach|teacher|boyfriend|girlfriend|parent'?s? boyfriend|he|she|they)\s+(hits|beats|chokes|kicks|burns|touches|touched|hit|beat|choked|hurts|hurt|slaps|slapped|punches|punched)\s+me\b(?!\s+(up|back|in|at|to|by|on (snap|insta|instagram|discord|text|tiktok)|with (the|a) (ball|question|text|message|snowball|pillow|joke)|off)\b)/,
  },
  { tier: "explicit", category: "abuse", severity: "high", pattern: /\b(not|don'?t feel) safe at home\b|\b(sexually )?abus(ed|ing|es) me\b/ },
  {
    tier: "explicit",
    category: "abuse",
    severity: "high",
    // Sextortion: someone holding images of the student, or threatening to post them unless paid.
    pattern: rx(String.raw`\b${IMAGES}\s+(of|from)\s+me\b|\b(leak|post|share|spread|send|expose)\w*\s+(my|the)\s+(nudes|naked pics)\b|${CONDITION}[^.!?]{0,80}${THREAT}|${THREAT}[^.!?]{0,80}${CONDITION}`),
  },
  {
    tier: "explicit",
    category: "violence",
    severity: "high",
    pattern: rx(String.raw`${NOT}\b(going to|gonna|want to|wanna|plan(ning)? to)\s+(kill|shoot|stab|hurt)\s+(him|her|them|someone|somebody|people|everyone|everybody|(my|the|that|this|those)\s+([a-z]+\s+)?(teacher|dad|mom|brother|sister|stepdad|stepmom|coach|boss|bully|bullies|principal|class|kids?|guy|girl|boyfriend|girlfriend|ex|friend|classmates?|family|neighbor|people))\b(?!\s+(a|an)\s+(text|dm|message|snap|email|call|look)\b)`),
  },
  { tier: "explicit", category: "violence", severity: "imminent", pattern: /\b(bring|bringing)\s+a\s+(gun|knife|weapon)\s+to\s+school\b|\bschool shooting\b.*\b(i|i'm|im)\b/ },

  // --- Outage only: broader self-harm patterns ---------------------------------------------------
  { tier: "outage", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+(hurt|cut) ${MYSELF}\b`), unless: ACCIDENT },
  { tier: "outage", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+end (it all|everything)\b|\b(i'?m|im|i am)\s+ending\s+(it all|it|everything)\b${BENIGN_END_OBJECT}`) },
  {
    tier: "outage",
    category: "self_harm",
    severity: "imminent",
    pattern: rx(String.raw`${NOT}\b${INTENT}\s+end\s+(it|things)\b${BENIGN_END_OBJECT}.*\b${TIME}\b|\b${TIME}\b.*${NOT}\b${INTENT}\s+end\s+(it|things)\b${BENIGN_END_OBJECT}`),
  },
  {
    tier: "outage",
    category: "self_harm",
    severity: "imminent",
    // A method: "end it with pills", "end my life with my dad's gun".
    pattern: rx(String.raw`\bend(ing)?\s+(it|it all|my life|things|everything)\s+(with|by|using|w/?)\s+((some|my|the|a|mom'?s|moms|dad'?s|dads)\s+)*(${PILLS}|gun|knife|rope|blade|razor|belt|jumping|overdos\w*|hanging|cutting)`),
    unless: FICTION,
  },
  {
    tier: "outage",
    category: "self_harm",
    severity: "imminent",
    // An overdose that happened or is planned.
    pattern: rx(
      String.raw`${SELF}(took|swallowed|popped|downed|ate)\s+${LOTS}${PILLS}\b` +
        String.raw`|${SELF}(took|swallowed|popped|downed)\s+${SOME}${PILLS}\b[^.!?]*\b(ago|just now|rn|right now|and now|scared|feel (sick|weird|dizzy|funny|bad))\b` +
        String.raw`|(^|[.!?,;:]\s*|\bi\s+)just\s+(took|swallowed|popped|downed)\s+${SOME}${PILLS}\b` +
        String.raw`|${SELF}(took|swallowed|downed)\s+the\s+(whole|entire)\s+(bottle|pack|box)\b` +
        String.raw`|${NOT}\b(${INTENT}|want to|wanna)\s+(take|swallow|down|od on)\s+(${LOTS}|${SOME})${PILLS}\b` +
        String.raw`|\b${PILLS}\b[^.!?]{0,60}${NOT}\b(${INTENT}|i'?m|im)\s+(take|taking|swallow|swallowing)\s+(all|every one|every single one)\s+of\s+them\b` +
        String.raw`|${NOT}\b(${INTENT}|want to|wanna)\s+(od|overdose)\b|\b(od|overdose|overdosing)\b[^.!?]{0,40}\b${TIME}\b`,
    ),
    unless: /\b(classes|courses|aps?|electives|subjects)\b/,
  },
  { tier: "outage", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b(${INTENT}|want to|wanna)\s+kms\b.*\b${TIME}\b|\b${TIME}\b.*${NOT}\b(${INTENT}|want to|wanna)\s+kms\b`) },
  { tier: "outage", category: "self_harm", severity: "imminent", pattern: rx(String.raw`${NOT}\b${INTENT}\s+(${HEIGHT})`), unless: PLAY },
  { tier: "outage", category: "self_harm", severity: "imminent", pattern: /\b(slit|slitting|cut|cutting)\s+my\s+wrists?\b/ },
  { tier: "outage", category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(${INTENT}|want to|wanna)\s+kms\b`) },
  { tier: "outage", category: "self_harm", severity: "high", pattern: rx(String.raw`\b(thinking about|think about|thought about|want to|wanna)\s+(${HEIGHT})`), unless: PLAY },
  { tier: "outage", category: "self_harm", severity: "high", pattern: rx(String.raw`${NOT}\b(kill(ing|ed)?|hurt(ing)?|cut(ting)?|harm(ing|ed)?|hang(ing|ed)?|burn(ing|ed)?)\s+${MYSELF}\b`), unless: ACCIDENT },
  { tier: "outage", category: "self_harm", severity: "high", pattern: rx(String.raw`\b(want|wanna|need|thinking about|think about|thought about)\s+(to\s+)?end(ing)?\s+it\s+all\b|\bend(ing)?\s+(it|it all|things|my life)\s+without\s+(anyone|anybody|people)\s+(noticing|knowing|finding out)\b`) },
  { tier: "outage", category: "self_harm", severity: "high", pattern: /\b(i'?m|im|i've been|ive been|been|i keep|i kept)\s+(saving|stockpiling|hoarding|collecting)\s+(up\s+)?(my\s+|some\s+|mom'?s\s+|moms\s+|dad'?s\s+|dads\s+)?(pills|meds)\b/ },
  { tier: "outage", category: "self_harm", severity: "high", pattern: /\b(don'?t|dont|do not)\s+(want|wanna|wana)\s+(to\s+)?(live|be alive|be here)\s+(anymore|any more|no more)\b/ },
  // With the model down, a self-harm word plus a timeframe is enough.
  { tier: "outage", category: "self_harm", severity: "high", pattern: rx(String.raw`\b(suicid\w*|kms|end (it|it all|things)\b${BENIGN_END_OBJECT}|(gonna|going to|i'?ll|might) die|kill ${MYSELF}|hurt ${MYSELF})\b.*\b${TIME}\b|\b${TIME}\b.*\b(suicid\w*|kms|end (it|it all|things)\b${BENIGN_END_OBJECT}|(gonna|going to|i'?ll|might) die|kill ${MYSELF}|hurt ${MYSELF})\b`) },

  // --- Outage only: abuse ----------------------------------------------------------------------
  { tier: "outage", category: "abuse", severity: "high", pattern: /\b(scared|afraid) to go home\b|\bthreaten\w*\s+to\s+(leak|post|share|send|spread|expose)\s+(my|the|those|them|pics|photos|nudes)\b/ },

  // --- Medium and below (the model decides when it runs) ------------------------------------------
  { tier: "explicit", category: "self_harm", severity: "medium", pattern: /\bsuicidal\b|\bself[- ]harm(ing)?\b|\bsuicide\b/ },
  { tier: "explicit", category: "self_harm", severity: "medium", pattern: /\b(kill(ing|ed)?|hurt(ing)?|cut(ting)?|harm(ing|ed)?|hang(ing|ed)?|burn(ing|ed)?)\s+my ?self\b|\bkms\b|\bend(ing)? (it|it all|things|my life)\b|\bgoodbye (letter|note|post)s?\b|\bi'?d rather (die|be dead)\b/ },
  { tier: "explicit", category: "self_harm", severity: "medium", pattern: rx(String.raw`\b(gonna|going to|i'?ll|might) die\b.*\b${TIME}\b|\b${TIME}\b.*\b(gonna|going to|i'?ll|might) die\b`) },
  { tier: "explicit", category: "eating_disorder", severity: "medium", pattern: /\bstarv(e|ing) myself\b|\b(make|making) myself (throw up|puke|vomit)\b|\bthrow(ing)? up after (i )?eat/ },
  { tier: "explicit", category: "eating_disorder", severity: "medium", pattern: /\b(stopped|stop) eating\b|\bhaven'?t eaten in (days|\d+ days)\b/ },
  { tier: "explicit", category: "substance_use", severity: "medium", pattern: /\b(took|taking|take) (a bunch of|too many|all my|all the) (pills|meds)\b|\boverdos(e|ed|ing)\b/ },
  { tier: "explicit", category: "bullying", severity: "medium", pattern: /\b(being|getting|i'?m) bullied\b|\beveryone (hates|makes fun of) me\b/ },
  { tier: "explicit", category: "distress", severity: "low", pattern: /\b(hopeless|worthless|can'?t take (it|this) anymore|nobody (cares|would care)|no one (cares|would care))\b/ },
];

export function normalize(text: string) {
  return (
    text
      .toLowerCase()
      // A zero-width space is a word break; the other invisible characters join or hide letters.
      .replace(/​/g, " ")
      .replace(/[­‌‍⁠﻿]/g, "")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/\s+/g, " ")
  );
}

/** The sentence or clause around a match, for `unless` checks. */
function clauseAround(text: string, start: number, end: number) {
  const before = text.slice(0, start);
  const from = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1;
  const rest = text.slice(end).search(/[.!?;\n]/);
  return text.slice(from, rest === -1 ? text.length : end + rest);
}

function matches(rule: Rule, text: string) {
  const match = rule.pattern.exec(text);
  if (!match) return false;
  return !rule.unless?.test(clauseAround(text, match.index, match.index + match[0].length));
}

/**
 * The strongest rule match, or null. `tier: "explicit"` uses only the rules allowed to override
 * the safety model; the default uses every rule (for when the model couldn't run).
 */
export function classifyWithRules(text: string, tier: "explicit" | "all" = "all"): SafetySignal | null {
  const normalized = normalize(text);
  let best: SafetySignal | null = null;
  for (const rule of RULES) {
    if (tier === "explicit" && rule.tier !== "explicit") continue;
    if (matches(rule, normalized)) best = maxSignal(best, { category: rule.category, severity: rule.severity });
  }
  return best;
}
