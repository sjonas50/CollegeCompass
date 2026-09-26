import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState } from "./common";
import {
  COURSE_LEVEL_TO_TYPE_LEVEL,
  type CourseTypeId,
  type CourseTypeLevel,
  getCourseType,
  isCourseTypeId,
  LANGUAGE_LEVELS,
  type LanguageCode,
  type LanguageLevel,
  SUBJECT_FALLBACK_TYPE,
} from "./course-types";

// ---------------------------------------------------------------------------
// From a `student_courses` row to a course type (design §2.5, §5.2).
//
// A row's type comes from, in order:
//   1. its linked school-list row (`course_type_source: "catalog"`),
//   2. the type the student picked ("What kind of class is this?", source "student"),
//   3. a guess from the typed name, limited to the row's subject. A guess is ASSUMED: it counts
//      only toward subject-level requirements ("3 science credits") and never makes a
//      specific-course requirement ("Chemistry") done or planned (design §5.4). Guesses are
//      computed at render time and never stored.
// The level always comes from the row (the student's choice), never from the name.
// ---------------------------------------------------------------------------

export type CourseTypeSource = "catalog" | "student" | "guess";

export type ResolvedCourseType = {
  typeId: CourseTypeId;
  level: CourseTypeLevel;
  source: CourseTypeSource;
  /** True for guesses: only `subjects` selectors may match it. */
  assumed: boolean;
};

export type CourseRowForType = {
  name: string;
  subject: CourseSubject;
  level: CourseLevel;
  /** `student_courses.course_type_id` (null or unknown ids fall through to a guess). */
  courseTypeId?: string | null;
  courseTypeSource?: "catalog" | "student" | null;
};

type Pattern = { type: CourseTypeId; re: RegExp; states?: readonly PlannerState[] };

/**
 * Name patterns, most specific first. A pattern is only tried when its type belongs to the row's
 * subject (or lists it in `altSubjects`), so "Chemistry" filed under CTE falls back to cte.other.
 */
const PATTERNS: Pattern[] = [
  // English
  { type: "ela.lang_comp", re: /\bap\b.*\blang(uage)?\b|\b(english\s*1010|engl\s*1301|college (composition|writing))\b/i },
  { type: "ela.lit_comp", re: /\bap\b.*\blit(erature)?\b/i },
  { type: "ela.research", re: /\b(ap\s*research|research (and|&) technical writing|technical writing)\b/i },
  { type: "ela.seminar", re: /\bap\s*seminar\b/i },
  { type: "ela.esol", re: /\b(esol|esl|ell|english (as a )?(second|new) language|english language (development|learners?))\b/i },
  { type: "ela.creative_writing", re: /\bcreative writing\b/i },
  { type: "ela.journalism", re: /\b(journalism|yearbook|newspaper|literary magazine|photojournalism)\b/i },
  { type: "ela.debate", re: /\bdebate\b/i },
  { type: "ela.speech", re: /\b(speech|public speaking|communication applications|oral communication)\b/i },
  { type: "ela.professional_comm", re: /\b(business|professional|technical) (english|communications?|writing)\b/i },
  { type: "ela.humanities", re: /\b(humanities|mythology|literary genres|world literature|shakespeare)\b/i },
  { type: "ela.college_prep", re: /\bcollege prep(aratory)? english\b/i },
  { type: "ela.ms", re: /\b(english|ela|language arts)\s*(7|8)\b|\b(7th|8th)\s*grade (english|ela|language arts)\b/i },
  { type: "ela.9", re: /\b(english|ela|language arts)\s*(i|1|9)\b|\b(9th|ninth)\s*grade (english|ela)\b/i },
  { type: "ela.10", re: /\b(english|ela|language arts)\s*(ii|2|10)\b|\b(10th|tenth)\s*grade (english|ela)\b/i },
  { type: "ela.11", re: /\b(english|ela|language arts)\s*(iii|3|11)\b|\b(11th|eleventh)\s*grade (english|ela)\b/i },
  { type: "ela.12", re: /\b(english|ela|language arts)\s*(iv|4|12)\b|\b(12th|twelfth)\s*grade (english|ela)\b/i },

  // Math (order matters: pre-algebra before algebra, precalculus before calculus)
  { type: "math.ms", re: /\b(pre-?\s?algebra|math\s*(6|7|8)|(7th|8th)\s*grade math)\b/i },
  { type: "math.alg_reasoning", re: /\balgebraic reasoning\b/i },
  { type: "math.college_alg", re: /\b(college algebra|math\s*1050|math\s*1314)\b/i },
  { type: "math.precalc", re: /\bpre-?\s?calc(ulus)?\b/i },
  { type: "math.calc2", re: /\b(multivariable|calc(ulus)?\s*(ii|2|iii|3)|linear algebra|differential equations)\b/i },
  { type: "math.calc", re: /\bcalc(ulus)?\b/i },
  { type: "math.trig", re: /\b(trig(onometry)?|math\s*1060)\b/i },
  { type: "math.ut_sec1", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(i|1)\b/i },
  { type: "math.ut_sec2", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(ii|2)\b/i },
  { type: "math.ut_sec3", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(iii|3)\b/i },
  { type: "math.int1", re: /\bintegrated\s*math(ematics)?\s*(i|1)\b/i },
  { type: "math.int2", re: /\bintegrated\s*math(ematics)?\s*(ii|2)\b/i },
  { type: "math.int3", re: /\bintegrated\s*math(ematics)?\s*(iii|3)\b/i },
  // "Math 1/2/3" alone is Utah's Secondary Math there, and integrated math elsewhere.
  { type: "math.ut_sec1", re: /\bmath(ematics)?\s*(i|1)\b/i, states: ["UT"] },
  { type: "math.ut_sec2", re: /\bmath(ematics)?\s*(ii|2)\b/i, states: ["UT"] },
  { type: "math.ut_sec3", re: /\bmath(ematics)?\s*(iii|3)\b/i, states: ["UT"] },
  { type: "math.int1", re: /\bmath(ematics)?\s*(i|1)\b/i },
  { type: "math.int2", re: /\bmath(ematics)?\s*(ii|2)\b/i },
  { type: "math.int3", re: /\bmath(ematics)?\s*(iii|3)\b/i },
  { type: "math.alg2", re: /\balgebra\s*(ii|2)\b/i },
  { type: "math.alg1", re: /\balgebra(\s*(i|1))?\b/i },
  { type: "math.geom", re: /\bgeometry\b/i },
  { type: "math.applied.models", re: /\b(math(ematical)? models|mma)\b/i },
  { type: "math.applied.finance", re: /\b(financial math(ematics)?|math(ematics)? of personal finance)\b/i },
  { type: "math.applied.business", re: /\b(business|small business) math\b/i },
  { type: "math.applied.decision", re: /\bdecision making\b/i },
  { type: "math.applied.medical", re: /\b(medical math|math(ematics)? for medical)\b/i },
  { type: "math.applied.engineering", re: /\bengineering math(ematics)?\b/i },
  { type: "math.applied.technical", re: /\b(technical|shop|trade|applied) math(ematics)?\b/i },
  { type: "math.adv_quant", re: /\b(advanced quantitative reasoning|aqr|quantitative reasoning|math\s*1030)\b/i },
  { type: "math.discrete", re: /\bdiscrete math(ematics)?\b/i },
  { type: "math.college_prep", re: /\b(college prep(aratory)? math(ematics)?|math\s*1010)\b/i },
  { type: "math.stats", re: /\b(statistics|stats?|math\s*1040)\b/i },

  // Science. Integrated Physics and Chemistry (the TEKS course name) before physics and chemistry.
  { type: "sci.ipc", re: /\b(ipc|integrated physics|physical science|physical world)\b/i },
  { type: "sci.phys_eng", re: /\bphysics for engineering\b/i },
  { type: "sci.phys2", re: /\b(ap\s*physics\s*(2|ii|c)|physics\s*(ii|2)|physics c)\b/i },
  { type: "sci.phys", re: /\bphysics\b/i },
  { type: "sci.chem2", re: /\b(chem(istry)?\s*(ii|2))\b/i },
  { type: "sci.chem", re: /\bchem(istry)?\b/i },
  { type: "sci.anat", re: /\b(anatomy|physiology|pathophysiology)\b/i },
  { type: "sci.microbio", re: /\bmicrobio(logy)?\b/i },
  { type: "sci.biotech", re: /\b(biotech(nology)?|biostem)\b/i },
  { type: "sci.bio2", re: /\bbio(logy)?\s*(ii|2)\b/i },
  { type: "sci.bio", re: /\bbio(logy)?\b/i },
  { type: "sci.astronomy", re: /\bastronomy\b/i },
  { type: "sci.earth", re: /\b(earth|geology|space science)\b/i },
  { type: "sci.env", re: /\b(environmental|ecology|apes)\b/i },
  { type: "sci.aquatic", re: /\b(aquatic|marine)\b/i },
  { type: "sci.forensic", re: /\bforensics?\b/i },
  { type: "sci.research", re: /\b(scientific research|science research|research (and|&) design)\b/i },
  { type: "sci.ms", re: /\b(integrated science|science\s*(6|7|8)|(7th|8th)\s*grade science)\b/i },

  // Social studies
  { type: "ss.ut_acgc", re: /\b(acgc|american constitutional)\b/i },
  { type: "ss.pfl_econ", re: /\b(personal financial literacy|pfl)\b.*\becon/i },
  { type: "ss.pfl", re: /\b(personal financ(e|ial)|financial literacy|money management|pfl)\b/i },
  { type: "ss.ms", re: /\b(texas|utah|tennessee|state) history\b|\b(social studies|history)\s*(7|8)\b/i },
  { type: "ss.us_hist", re: /\b((us|u\.s\.|united states|american)\s*hist(ory)?|apush)\b/i },
  // Utah's World Geography classes include Geography for Life and World/Cultural Geography CE [UT S3].
  { type: "ss.world_geo", re: /\b((world|human|cultural)\s*geo(graphy)?|geography for life)\b/i },
  { type: "ss.world_hist", re: /\b(world|european|ancient)\s*(hist(ory)?|civ(ilizations?)?)\b/i },
  { type: "ss.us_gov", re: /\b(government|civics|gov)\b/i },
  { type: "ss.econ", re: /\b(economics|econ|microeconomics|macroeconomics)\b/i },
  { type: "ss.psych", re: /\bpsych(ology)?\b/i },
  { type: "ss.soc", re: /\bsociology\b/i },

  // Arts
  { type: "arts.ms", re: /\b(art|music|band|choir)\s*(6|7|8)\b/i },
  { type: "arts.art_history", re: /\bart history\b/i },
  { type: "arts.music_theory", re: /\bmusic theory\b/i },
  { type: "arts.ensemble", re: /\b(band|choir|chorus|orchestra|ensemble|chamber singers|madrigals?)\b/i },
  { type: "arts.theatre", re: /\b(theat(er|re)|drama|acting|stagecraft)\b/i },
  { type: "arts.dance", re: /\bdance\b/i },
  { type: "arts.media", re: /\b(digital art|animation|film|photography|media arts|graphic design|video production)\b/i },
  { type: "arts.music", re: /\b(music|guitar|piano)\b/i },
  { type: "arts.visual", re: /\b(arts?|drawing|painting|ceramics|sculpture|studio)\b/i },

  // Computer science
  { type: "cs.prog2", re: /\b(ap\s*(cs|computer science)\s*a|computer science a|(programming|coding|computer science)\s*(ii|2))\b/i },
  { type: "cs.principles", re: /\b(computer science principles|csp)\b/i },
  { type: "cs.advanced", re: /\b((programming|coding|computer science)\s*(iii|3)|computer science advanced|data structures)\b/i },
  { type: "cs.cyber", re: /\bcyber\s?security\b/i },
  { type: "cs.web", re: /\bweb (development|design)\b/i },
  { type: "cs.data_science", re: /\bdata science\b/i },
  { type: "cs.intro", re: /\b(exploring computer science|computer science (foundations|discoveries)|intro(duction)? to computer science)\b/i },
  { type: "cs.ms", re: /\b(digital literacy|creative coding)\b/i },
  { type: "cs.prog1", re: /\b(computer science|programming|coding|python|java)\b/i },

  // Health and PE
  { type: "health.wellness", re: /\bwellness\b/i },
  { type: "health.health", re: /\bhealth\b(?!\s*science)/i },
  { type: "pe.fitness", re: /\bfitness\b/i },
  { type: "pe.lifetime", re: /\blifetime (activities|recreation|sports)\b/i },
  { type: "pe.athletics", re: /\b(athletics|football|basketball|volleyball|soccer|baseball|softball|track|cross country|swim(ming)?|tennis|golf|wrestling|cheer)\b/i },
  { type: "pe.skills", re: /\b(participation skills|team sports|individual sports)\b/i },
  { type: "pe.general", re: /\bp\.?e\.?(?=\s|$)|\b(physical education|gym)\b/i },

  // Other
  { type: "other.jrotc", re: /\bjrotc\b/i },
  { type: "other.driver_ed", re: /\bdriver'?s?\s*ed(ucation)?\b/i },
  { type: "other.study_support", re: /\b(avid|study skills|advisory|homeroom|study hall|tutorial)\b/i },

  // Career and technical education: named classes, then a cluster's level 1
  // A second-year class is its own type (Texas counts only Accounting II and Robotics II as math).
  { type: "cte.accounting2", re: /\baccounting\s*(ii|2)\b/i },
  { type: "cte.accounting", re: /\baccounting\b/i },
  { type: "cte.business_office", re: /\b(business office|microsoft office|digital business)\b/i },
  { type: "cte.floral_design", re: /\bfloral\b/i },
  { type: "cte.landscape_design", re: /\blandscap/i },
  { type: "cte.design_foundations", re: /\b(fashion|interior) design\b/i },
  { type: "cte.agriscience", re: /\b(agriscience|principles of (agriculture|afnr))\b/i },
  { type: "cte.animal_science", re: /\b(veterinary|animal science|vet med)\b/i },
  { type: "cte.engineering_design", re: /\b(engineering design|principles of (applied )?engineering|intro(duction)? to engineering)\b/i },
  { type: "cte.cad", re: /\b(cad|drafting)\b/i },
  { type: "cte.digital_electronics", re: /\bdigital electronics\b/i },
  { type: "cte.robotics2", re: /\brobotics?\s*(ii|2)\b/i },
  { type: "cte.robotics", re: /\brobotics?\b/i },
  { type: "cte.biomed", re: /\b(biomedical|human body systems|medical interventions)\b/i },
  { type: "cte.medical_terminology", re: /\bmedical terminology\b/i },
  { type: "cte.nurse_aide", re: /\b(cna|nurse aide|nursing assistant|patient care)\b/i },
  { type: "cte.emt", re: /\b(emt|emergency medical)\b/i },
  { type: "cte.health_principles", re: /\bhealth science\b/i },
  { type: "cte.manufacturing.1", re: /\b(welding|machining|manufacturing|cnc)\b/i },
  { type: "cte.hospitality.1", re: /\b(culinary|cooking|baking|hospitality|food science)\b/i },
  { type: "cte.transportation.1", re: /\b(auto(motive)?|diesel|aviation|aircraft|collision repair|small engines?)\b/i },
  { type: "cte.architecture_construction.1", re: /\b(construction|carpentry|electrical|plumbing|hvac|woodworking|architecture)\b/i },
  { type: "cte.education.1", re: /\b(child development|early childhood|teaching|education (and|&) training)\b/i },
  { type: "cte.law.1", re: /\b(criminal justice|law enforcement|fire science|public safety|legal studies|pre-?law)\b/i },
  { type: "cte.human_services.1", re: /\b(cosmetology|barbering|family (and|&) consumer|interpersonal)\b/i },
  { type: "cte.it.1", re: /\b(networking|information technology|comptia)\b/i },
  { type: "cte.business.1", re: /\b(business|marketing|entrepreneurship|finance)\b/i },
  { type: "cte.ag.1", re: /\b(agri\w*|ag science|horticulture|ffa)\b/i },
  { type: "cte.engineering.1", re: /\b(engineering|stem)\b/i },
  { type: "cte.health.1", re: /\b(medical|nursing|pharmacy|sports medicine|dental)\b/i },
  { type: "cte.arts_av.1", re: /\b(audio|video|broadcast|a\/v)\b/i },
  { type: "cte.energy.1", re: /\b(energy|oil and gas|solar)\b/i },
];

const LANGUAGE_PATTERNS: [LanguageCode, RegExp][] = [
  ["es", /\b(spanish|espa[nñ]ol)\b/i],
  ["fr", /\bfrench\b/i],
  ["de", /\bgerman\b/i],
  ["la", /\blatin\b/i],
  ["zh", /\b(chinese|mandarin)\b/i],
  ["ja", /\bjapanese\b/i],
  ["ru", /\brussian\b/i],
  ["ar", /\barabic\b/i],
  ["it", /\bitalian\b/i],
  ["ko", /\bkorean\b/i],
  ["pt", /\bportuguese\b/i],
  ["asl", /\b(asl|american sign language|sign language)\b/i],
];

const LANGUAGE_LEVEL_PATTERNS: [LanguageLevel, RegExp][] = [
  [4, /\b(iv|4|v|5|vi|6|ap|ib|advanced|literature)\b/i],
  [3, /\b(iii|3)\b/i],
  [2, /\b(ii|2)\b/i],
];

function fitsSubject(type: CourseTypeId, subject: CourseSubject) {
  const t = getCourseType(type);
  return t.subject === subject || t.altSubjects.includes(subject);
}

function guessLanguage(name: string): CourseTypeId {
  const code = LANGUAGE_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? "other";
  const level: LanguageLevel = LANGUAGE_LEVEL_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? LANGUAGE_LEVELS[0];
  return `lang.${code}.${level}`;
}

/**
 * The course type a typed class name most likely is, within the row's subject. Always returns a
 * type: the subject's "Other … class" when nothing matches. `state` only disambiguates names like
 * "Math 2" (Utah's Secondary Math II there).
 */
export function guessCourseTypeId(name: string, subject: CourseSubject, state: PlannerState | null = null): CourseTypeId {
  if (subject === "world_language") return guessLanguage(name);
  for (const p of PATTERNS) {
    if (p.states && (!state || !p.states.includes(state))) continue;
    if (fitsSubject(p.type, subject) && p.re.test(name)) return p.type;
  }
  return SUBJECT_FALLBACK_TYPE[subject];
}

/**
 * A `student_courses` row's course type and level. A stored type (from the school's list or the
 * student's pick) is used as is; otherwise the name is guessed and the result is `assumed`.
 */
export function resolveRowCourseType(row: CourseRowForType, state: PlannerState | null = null): ResolvedCourseType {
  const level = COURSE_LEVEL_TO_TYPE_LEVEL[row.level];
  if (row.courseTypeId && isCourseTypeId(row.courseTypeId) && row.courseTypeSource) {
    return { typeId: row.courseTypeId, level, source: row.courseTypeSource, assumed: false };
  }
  return { typeId: guessCourseTypeId(row.name, row.subject, state), level, source: "guess", assumed: true };
}
