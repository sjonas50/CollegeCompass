import type { CourseLevel, CourseSubject } from "@/db/schema";
import type { PlannerState, SchoolYear } from "./common";
import {
  COURSE_LEVEL_TO_TYPE_LEVEL,
  type CourseType,
  type CourseTypeId,
  type CourseTypeLevel,
  courseTypesForSubject,
  getCourseType,
  isCourseTypeId,
  LANGUAGE_LEVELS,
  LANGUAGES,
  type LanguageCode,
  type LanguageLevel,
  SUBJECT_FALLBACK_TYPE,
} from "./course-types";
import { type ExactCourseType, exactCourseType, otherKindsInState } from "./exact-titles";

// ---------------------------------------------------------------------------
// From a `student_courses` row to a course type (design §2.5, §5.2).
//
// A row's type comes from, in order:
//   1. its linked school-list row (`course_type_source: "catalog"`),
//   2. the type the student picked ("What kind of class is this?", source "student"),
//   3. an exact title: the official or canonical name of exactly one kind of class in the student's
//      state ("Algebra I", Texas's "Lifetime Fitness and Wellness Pursuits"; exact-titles.ts), taken
//      as that kind (source "exact": not assumed, nothing to confirm),
//   4. a guess from the typed name, limited to the row's subject. A guess is ASSUMED: it counts
//      only toward subject-level requirements ("3 science credits") and never makes a
//      specific-course requirement ("Chemistry") done or planned (design §5.4).
// Exact titles and guesses are computed at render time and never stored. The level comes from the
// row (the student's choice), except that an exact title's level marker ("Biology H", "Pre-AP
// English I") sets it on a row left at regular.
//
// Confirm first: a guess is also what the student is asked to confirm ("Algebra II?" Yes / Something
// else). `guessCourseType` says how sure the guess is (`confident`: the add and edit forms pre-select
// it) and every kind the row might be (`candidates`): the engine never claims a requirement is
// missing, or adds a "Required by" class, where the row might be that class. The candidates include
// the kinds the state's schools also use the name for, for the row's level and school year
// (exact-titles.ts `otherKindsInState`: Tennessee's "Health" may be Lifetime Wellness, Utah's
// "U.S. Government" from 2027-28 may be ACGC, Utah's "English 11 CE" may be ENGL 1010).
//
// A row the student saved with "Not sure" (source "unsure") is never taken as an exact title: they
// said they don't know what kind it is, so it's a guess they're asked to confirm.
// ---------------------------------------------------------------------------

export type CourseTypeSource = "catalog" | "student" | "exact" | "guess";

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
  /** `student_courses.course_type_source`. "unsure": saved as "Not sure" (no kind), so an exact title doesn't settle it. */
  courseTypeSource?: "catalog" | "student" | "unsure" | null;
};

type Pattern = {
  type: CourseTypeId;
  re: RegExp;
  states?: readonly PlannerState[];
  /**
   * A catch-all for a family of classes (any PE class, any computer science class, a career
   * cluster's classes at any level): the row might be any of `broad`'s kinds, so the guess is never
   * confident and every kind in the family is a candidate.
   */
  broad?: (t: CourseType) => boolean;
};

/** Every PE class, every arts class, every computer science class, a career cluster's classes. */
const PE_FAMILY = (t: CourseType) => t.id.startsWith("pe.");
const ARTS_FAMILY = (t: CourseType) => t.id.startsWith("arts.");
const CS_FAMILY = (t: CourseType) => t.id.startsWith("cs.");
const cluster = (c: string) => (t: CourseType) => t.ladder?.id === `cte.${c}` || t.cteCluster === c;
/** A "… wellness" class: health, Tennessee's Lifetime Wellness, or a fitness PE class. */
const WELLNESS_FAMILY = (t: CourseType) => t.id === "health.health" || t.id === "health.wellness" || t.id === "pe.fitness";

/**
 * Name patterns, most specific first. A pattern is only tried when its type belongs to the row's
 * subject (or lists it in `altSubjects`), so "Chemistry" filed under CTE falls back to cte.other.
 */
const PATTERNS: Pattern[] = [
  // English. A level can carry an honors or extended letter ("English 10H", "Eng 12").
  // College writing classes (Utah CE ENGL 1010 and 2010, Texas ENGL 1301 and 1302) are college
  // composition: Utah's level 12 list names "English Concurrent Enrollment" (UT-S3 p. 2), and Utah's
  // writing courses are ENGL 1010, 2010 or 2015 (research-utah.md, general education).
  // "AP" is the level, never "Pre-AP" (a school's own honors-style course), and "Language Arts" is
  // English, not AP English Language: "Pre-AP English Language Arts I" is English I.
  {
    type: "ela.lang_comp",
    re: /(?<!pre-?\s?)\bap\b.*\blang(uage)?\b(?!\s*arts)|\b(engl(ish)?\s*(1010|2010|2015|1301|1302)|college (composition|writing))\b|\b(ce|concurrent enrollment|dual (credit|enrollment))\s+engl(ish)?\b(?!\s*(i{1,3}|iv|9|10|11|12)\b)/i,
  },
  { type: "ela.lit_comp", re: /(?<!pre-?\s?)\bap\b.*\blit(erature)?\b/i },
  { type: "ela.research", re: /\b(ap\s*research|research (and|&) technical writing|technical writing)\b/i },
  { type: "ela.seminar", re: /(?<!pre-?\s?)\bap\s*seminar\b/i },
  { type: "ela.esol", re: /\b(esol|esl|ell|english (as a )?(second|new) language|english language (development|learners?))\b/i },
  { type: "ela.creative_writing", re: /\bcreative writing\b/i },
  { type: "ela.journalism", re: /\b(journalism|yearbook|newspaper|literary magazine|photojournalism)\b/i },
  { type: "ela.debate", re: /\bdebate\b/i },
  { type: "ela.speech", re: /\b(speech|public speaking|communication applications|oral communication)\b/i },
  { type: "ela.professional_comm", re: /\b(business|professional|technical) (english|communications?|writing)\b/i },
  { type: "ela.humanities", re: /\b(humanities|mythology|literary genres|world literature|shakespeare)\b/i },
  { type: "ela.college_prep", re: /\bcollege prep(aratory)? english\b/i },
  { type: "ela.ms", re: /\b(english|eng\.?|ela|language arts)\s*(7|8)\b|\b(7th|8th)\s*grade (english|ela|language arts)\b/i },
  { type: "ela.9", re: /\b(english|eng\.?|ela|language arts)\s*(i|1|9)(h|e)?\b|\b(9th|ninth)\s*grade (english|ela)\b|\bfreshman english\b/i },
  { type: "ela.10", re: /\b(english|eng\.?|ela|language arts)\s*(ii|2|10)(h|e)?\b|\b(10th|tenth)\s*grade (english|ela)\b|\bsophomore english\b/i },
  // American literature is the usual 11th-grade English class, British literature the 12th-grade one.
  { type: "ela.11", re: /\b(english|eng\.?|ela|language arts)\s*(iii|3|11)(h|e)?\b|\b(11th|eleventh)\s*grade (english|ela)\b|\bjunior english\b|\bamerican lit(erature)?\b/i },
  { type: "ela.12", re: /\b(english|eng\.?|ela|language arts)\s*(iv|4|12)(h|e)?\b|\b(12th|twelfth)\s*grade (english|ela)\b|\bsenior english\b|\bbritish lit(erature)?\b/i },

  // Math (order matters: pre-algebra before algebra, precalculus before calculus). A level can
  // carry an honors or extended letter: Utah's "Secondary Math IE", "IIE" and "IIIE" (the extended
  // courses R277-700-6(6) counts: "the foundation or foundation extended courses"), "Sec Math 1H".
  { type: "math.ms", re: /\b(pre-?\s?algebra|math\s*(6|7|8)|(7th|8th)\s*grade math)\b/i },
  { type: "math.alg_reasoning", re: /\balgebraic reasoning\b/i },
  { type: "math.college_alg", re: /\b(college algebra|math\s*1050|math\s*1314)\b/i },
  { type: "math.precalc", re: /\bpre-?\s?cal(c(ulus)?)?\b/i },
  { type: "math.calc2", re: /\b(multivariable|calc(ulus)?\s*(ii|2|iii|3)|linear algebra|differential equations)\b/i },
  { type: "math.calc", re: /\bcalc(ulus)?\b/i },
  // "Algebra II/Trigonometry", "Alg 2/Trig" and "Algebra 2 Trig Honors" are Algebra II courses.
  { type: "math.trig", re: /^(?!.*\balg(ebra)?\.?\s*(ii|2)(h|e)?\b).*\b(trig(onometry)?|math\s*1060)\b/i },
  { type: "math.ut_sec1", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(i|1)(h|e)?\b/i },
  { type: "math.ut_sec2", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(ii|2)(h|e)?\b/i },
  { type: "math.ut_sec3", re: /\bsec(ondary)?\.?\s*math(ematics)?\s*(iii|3)(h|e)?\b/i },
  { type: "math.int1", re: /\bintegrated\s*math(ematics)?\s*(i|1)(h|e)?\b/i },
  { type: "math.int2", re: /\bintegrated\s*math(ematics)?\s*(ii|2)(h|e)?\b/i },
  { type: "math.int3", re: /\bintegrated\s*math(ematics)?\s*(iii|3)(h|e)?\b/i },
  // "Math 1/2/3" alone is Utah's Secondary Math there, and integrated math elsewhere.
  { type: "math.ut_sec1", re: /\bmath(ematics)?\s*(i|1)(h|e)?\b/i, states: ["UT"] },
  { type: "math.ut_sec2", re: /\bmath(ematics)?\s*(ii|2)(h|e)?\b/i, states: ["UT"] },
  { type: "math.ut_sec3", re: /\bmath(ematics)?\s*(iii|3)(h|e)?\b/i, states: ["UT"] },
  { type: "math.int1", re: /\bmath(ematics)?\s*(i|1)(h|e)?\b/i },
  { type: "math.int2", re: /\bmath(ematics)?\s*(ii|2)(h|e)?\b/i },
  { type: "math.int3", re: /\bmath(ematics)?\s*(iii|3)(h|e)?\b/i },
  { type: "math.alg2", re: /\balg(ebra)?\.?\s*(ii|2)(h|e)?\b/i },
  // Never "Algebra III" (a school's own class after Algebra II), which no pattern names.
  { type: "math.alg1", re: /\balg(ebra)?\.?(\s*(i|1)(h|e)?)?\b(?!\s*(i{2,3}|iv|[2-4])\b)/i },
  { type: "math.geom", re: /\bgeom(etry)?\b/i },
  // Tennessee's senior-year applied math classes by their older names (Bridge Math, the SAILS
  // math class, Applied Mathematical Concepts): the state's approved list now has Mathematical
  // Reasoning for Decision Making as its applied 4th-year class (Policy 3.205, "8.14 Mathematical
  // Reasoning for Decision Making", TN-S6B), and the 4th math is "another mathematics course beyond
  // Algebra I" (Policy 2.103 I(10)). A guess the student confirms.
  { type: "math.applied.decision", re: /\b(bridge math(ematics)?|sails|applied mathematical concepts)\b/i, states: ["TN"] },
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

  // Texas's career classes on the lab-based science lists (19 TAC §74.12(b)(3)(B)(x), (xiv), (xx),
  // (xxi); §74.13(e)(6)(J), (N), (T), (U)), whether filed under science or career and technical.
  { type: "cte.engineering_problem_solving", re: /\bengineering design (and|&) problem solving\b/i },
  { type: "cte.engineering_science", re: /\bengineering science\b/i },
  { type: "cte.food_science", re: /\bfood science\b/i },
  { type: "cte.plant_soil_science", re: /\badvanced plant (and|&) soil science\b/i },

  // Science. Integrated Physics and Chemistry (the TEKS course name) before physics and chemistry.
  { type: "sci.ipc", re: /\b(ipc|integrated physics( (and|&) chemistry)?|physical science|physical world)\b/i },
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
  // Texas's and Utah's geography class is World Geography (TEKS "World Geography Studies"; Utah's
  // World Geography requirement), so a bare "Geography" there is that class.
  // (Tennessee's "World History and Geography" and "U.S. History and Geography" are one class each.)
  { type: "ss.world_geo", re: /(?<!\bhistory\s*(and|&)\s*)\bgeography\b/i, states: ["TX", "UT"] },
  { type: "ss.world_hist", re: /\b(world|european|ancient)\s*(hist(ory)?|civ(ilizations?)?)\b/i },
  { type: "ss.us_gov", re: /\b(government|civics|govt?|gov't)\b/i },
  { type: "ss.econ", re: /\b(economics|econ|microeconomics|macroeconomics)\b/i },
  { type: "ss.psych", re: /\bpsych(ology)?\b/i },
  { type: "ss.soc", re: /\bsociology\b/i },

  // Tennessee's Digital Arts & Design program (Policy 3.205 17.8-17.10): level I is one of the fine
  // arts substitutes (Policy 3.103 III(3), TN-S3), II and III the program's next levels. Utah's
  // Digital Media 1 and 2 are explorer courses in its Broadcasting & Digital Media and Graphic Design
  // pathways (MP-USBE-CTE). Before the arts, so a career class stays one.
  { type: "cte.arts_av.3", re: /\bdigital arts? (and|&) design\s*(iii|3)\b/i },
  { type: "cte.arts_av.2", re: /\bdigital arts? (and|&) design\s*(ii|2)\b/i },
  { type: "cte.digital_arts_design", re: /\bdigital arts? (and|&) design\b(?!\s*(ii|iii|iv|2|3|4)\b)/i },
  { type: "cte.arts_av.1", re: /\bdigital media\b/i },

  // Arts. Marching band and drill team first (Texas counts them toward PE by district policy,
  // 19 TAC §74.12(b)(6)(D); Tennessee Policy 2.103 I(15)), before band reads as a band class.
  { type: "arts.marching", re: /\b(marching band|drill team)\b/i },
  { type: "arts.ms", re: /\b(art|music|band|choir)\s*(6|7|8)\b/i },
  { type: "arts.art_history", re: /\bart history\b/i },
  { type: "arts.music_theory", re: /\bmusic theory\b/i },
  { type: "arts.ensemble", re: /\b(band|choir|chorus|orchestra|ensemble|chamber singers|madrigals?)\b/i },
  { type: "arts.theatre", re: /\b(theat(er|re)|drama|acting|stagecraft)\b/i },
  { type: "arts.dance", re: /\bdance\b/i },
  { type: "arts.media", re: /\b(digital arts?|digital media|animation|film|photography|media arts|graphic design|video production)\b/i },
  { type: "arts.music", re: /\b(music|guitar|piano)\b/i, broad: ARTS_FAMILY },
  { type: "arts.visual", re: /\b(arts?|drawing|painting|ceramics|sculpture|studio)\b/i, broad: ARTS_FAMILY },

  // Computer science
  { type: "cs.prog2", re: /\b(ap\s*(cs|computer science)\s*a|computer science a|(programming|coding|computer science)\s*(ii|2))\b/i },
  { type: "cs.principles", re: /\b(computer science principles|csp)\b/i },
  { type: "cs.advanced", re: /\b((programming|coding|computer science)\s*(iii|3)|computer science advanced|data structures)\b/i },
  { type: "cs.cyber", re: /\bcyber\s?security\b/i },
  { type: "cs.web", re: /\bweb (development|design)\b/i },
  { type: "cs.data_science", re: /\bdata science\b/i },
  { type: "cs.intro", re: /\b(exploring computer science|computer science (foundations|discoveries)|intro(duction)? to computer science)\b/i },
  { type: "cs.ms", re: /\b(digital literacy|creative coding)\b/i },
  // A first programming class by its level ("Computer Science I", "Coding 1") is that class; the
  // bare words are a catch-all for any computer science class.
  { type: "cs.prog1", re: /\b(computer science|programming|coding)\s*(i|1)\b/i },
  { type: "cs.prog1", re: /\b(computer science|programming|coding|python|java)\b/i, broad: CS_FAMILY },

  // Health and PE. Texas's PE courses by their TEKS names (19 TAC §74.12(b)(6)(A): "(i) Lifetime
  // Fitness and Wellness Pursuits; (ii) Lifetime Recreation and Outdoor Pursuits; and (iii)
  // Skill-Based Lifetime Activities"), before "wellness" reads as Tennessee's Lifetime Wellness.
  { type: "pe.fitness", re: /\blifetime fitness (and|&) wellness\b/i },
  { type: "pe.lifetime", re: /\blifetime recreation (and|&) outdoor\b/i },
  { type: "pe.skills", re: /\bskill-?\s?based lifetime\b/i },
  // "Lifetime Wellness" is Tennessee's required class (Policy 2.103 I(14)). Anywhere else, and any
  // other "… wellness" title ("Health & Wellness", "Fitness and Wellness"), might be health, PE or
  // wellness: a guess to confirm, never sure.
  { type: "health.wellness", re: /\blifetime wellness\b/i, states: ["TN"] },
  { type: "health.wellness", re: /\blifetime wellness\b/i, broad: WELLNESS_FAMILY },
  { type: "pe.fitness", re: /\bfitness\b.*\bwellness\b|\bwellness\b.*\bfitness\b/i, broad: WELLNESS_FAMILY },
  { type: "health.health", re: /\bhealth\b.*\bwellness\b|\bwellness\b.*\bhealth\b/i, broad: WELLNESS_FAMILY },
  { type: "health.wellness", re: /\bwellness\b/i, states: ["TN"], broad: WELLNESS_FAMILY },
  { type: "health.health", re: /\bwellness\b/i, broad: WELLNESS_FAMILY },
  { type: "health.health", re: /\bhealth\b(?!\s*science)/i },
  // Utah's Individualized Lifetime Activities classes by their usual names (weight training, yoga,
  // aerobics, conditioning), before "Walking Fitness" reads as Fitness for Life.
  {
    type: "pe.lifetime",
    re: /\b(weight (training|lifting|room)|weightlifting|weights|strength (training|(and|&) conditioning)|conditioning|yoga|pilates|aerobics|walking)\b/i,
    states: ["UT"],
  },
  { type: "pe.fitness", re: /\bfitness\b/i },
  { type: "pe.lifetime", re: /\blifetime (activities|recreation|sports)\b/i },
  { type: "pe.athletics", re: /\b(athletics|football|basketball|volleyball|soccer|baseball|softball|track|cross country|swim(ming)?|tennis|golf|wrestling|cheer)\b/i },
  { type: "pe.skills", re: /\b(participation skills|team sports|individual sports)\b/i },
  { type: "pe.general", re: /\bp\.?e\.?(?=\s|$)|\b(physical education|gym)\b/i, broad: PE_FAMILY },

  // Other
  { type: "other.jrotc", re: /\bjrotc\b/i },
  { type: "other.driver_ed", re: /\bdriver'?s?\s*ed(ucation)?\b/i },
  { type: "other.study_support", re: /\b(avid|study skills|advisory|homeroom|study hall|tutorial)\b/i },

  // Career and technical education: named classes, then a cluster (its level from the name's cues,
  // cteLevelFromName). Programs of study name their later classes without the cluster's words, so
  // those are listed by level first (TEA statewide programs of study, 2025, checked 2026-09-26
  // against the saved copies in .data/course-rules-verified/major-prep):
  // - Teaching and Training (MP-TEA-POS-ET-TEACHING-AND-TRAINING): "Level 1• Principles of
  //   Education and Training", "Level 2• Communication and Technology in Education • Human Growth
  //   and Development", "Level 3• Instructional Practices", "Level 4• ... Practicum in Education
  //   and Training".
  // - Nursing Science (MP-TEA-POS-HS-NURSING-SCIENCE): "Level 1• Principles of Health Science
  //   • Principles of Nursing Science", "Level 2• Science of Nursing", "Level 3• Health Science
  //   Theory • Health Science Theory + Health Science Clinical", "Level 4• ... Practicum in Nursing
  //   • Practicum in Health Science". Health Science Theory is Level 3 in Diagnostic and
  //   Therapeutic Services too (MP-TEA-POS-HS-DIAGNOSTIC-AND-THERAPEUTIC-SERVICES).
  // - Welding (MP-TEA-POS-M-WELDING): "Level 1• Principles of Manufacturing • Introduction to
  //   Welding", "Level 2• ... Welding I", "Level 3• Welding II", "Level 4• Practicum in
  //   Manufacturing".
  { type: "cte.education.4", re: /\bpracticum in education\b/i },
  { type: "cte.education.3", re: /\binstructional practices\b/i },
  { type: "cte.education.2", re: /\b(human growth (and|&) development|communication (and|&) technology in education)\b/i },
  { type: "cte.health.4", re: /\bpracticum in (health science|nursing)\b/i },
  { type: "cte.health.3", re: /\bhealth science theory\b/i },
  { type: "cte.health.2", re: /\bscience of nursing\b/i },
  { type: "cte.manufacturing.4", re: /\bpracticum in manufacturing\b/i },
  { type: "cte.manufacturing.3", re: /\bwelding\s*(ii|2)\b/i },
  { type: "cte.manufacturing.2", re: /\bwelding\s*(i|1)\b/i },
  // - Engineering Foundations (MP-TEA-POS-ENG-ENGINEERING-FOUNDATIONS): "Level 1 • Principles of
  //   Applied Engineering", "Level 3 • Engineering Design and Presentation", "Level 4 • Advanced
  //   Engineering Design and Presentation • Engineering Design and Problem Solving". The earlier
  //   two-year names put Engineering Design and Presentation I between them (level 2) and II at
  //   level 3.
  // - Electrical (MP-TEA-POS-AC-ELECTRICAL): "Level 1 • Principles of Architecture • Principles of
  //   Construction", "Level 2 • Electrical Technology I", "Level 3 • Electrical Technology II",
  //   "Level 4 • ... Practicum in Construction Technology". Construction Technology I and II sit at
  //   the same levels in the carpentry program.
  // - Automotive (MP-TEA-POS-TDL-AUTOMOTIVE-AND-COLLISION-REPAIR): "Level 2• ... Automotive
  //   Basics", "Level 3• ... Automotive Technology I: Maintenance and Light Repair", "Level 4•
  //   Automotive Technology II: Automotive Service".
  { type: "cte.engineering.4", re: /\badvanced engineering design (and|&) presentation\b/i },
  { type: "cte.engineering.3", re: /\bengineering design (and|&) presentation\s*(ii|2)\b/i },
  { type: "cte.engineering.2", re: /\bengineering design (and|&) presentation\s*(i|1)\b/i },
  { type: "cte.engineering.3", re: /\bengineering design (and|&) presentation\b/i },
  { type: "cte.architecture_construction.4", re: /\bpracticum in construction technology\b/i },
  { type: "cte.architecture_construction.3", re: /\b(electrical|construction) technology\s*(ii|2)\b/i },
  { type: "cte.architecture_construction.2", re: /\b(electrical|construction) technology(\s*(i|1))?\b/i },
  { type: "cte.transportation.4", re: /\bautomotive technology\s*(ii|2)\b/i },
  { type: "cte.transportation.3", re: /\bautomotive technology(\s*(i|1))?\b/i },
  { type: "cte.transportation.2", re: /\bautomotive basics\b/i },
  // - Transportation's programs (MP-TEA-POS-TDL-AUTOMOTIVE-AND-COLLISION-REPAIR, -AVIATION-*):
  //   "Level 1• Principles of Transportation Systems", "Level 4• ... Practicum in Transportation
  //   Systems". Education and Training (MP-TEA-POS-ET-TEACHING-AND-TRAINING, -EARLY-LEARNING):
  //   "Level 1• Principles of Education and Training • Principles of Human Services".
  { type: "cte.transportation.4", re: /\bpracticum in transportation\b/i },
  { type: "cte.transportation.1", re: /\bprinciples of transportation\b/i },
  { type: "cte.education.1", re: /\bprinciples of human services\b/i },
  // - Culinary Arts (MP-TEA-POS-HT-CULINARY-ARTS): "Level 1• Principles of Hospitality and Tourism
  //   • Introduction to Culinary Arts", "Level 2• Culinary Arts", "Level 3• Advanced Culinary
  //   Arts", "Level 4• ... Practicum in Culinary Arts". Early Learning
  //   (MP-TEA-POS-ET-EARLY-LEARNING): "Level 2• Child Development", "Level 3• Child Guidance",
  //   "Level 4• ... Practicum in Early Learning". Texas's plain "Culinary Arts" and "Child
  //   Development" are level 2 there (Utah's Child Development is an introductory class): still a
  //   guess to confirm, with the cluster's other levels as candidates.
  { type: "cte.hospitality.4", re: /\bpracticum in culinary arts\b/i },
  { type: "cte.hospitality.3", re: /\badvanced culinary arts\b/i },
  { type: "cte.hospitality.1", re: /\b(introduction to culinary arts|principles of hospitality)\b/i },
  { type: "cte.hospitality.2", re: /\bculinary arts\b(?!\s*(i{1,3}|iv|[1-4])\b)/i, states: ["TX"], broad: cluster("hospitality") },
  { type: "cte.education.4", re: /\bpracticum in early learning\b/i },
  { type: "cte.education.3", re: /\bchild guidance\b/i },
  { type: "cte.education.2", re: /\bchild development\b(?!\s*(i{1,3}|iv|[1-4])\b)/i, states: ["TX"], broad: cluster("education") },
  // Tennessee (course names from Policy 3.205, TN-S6B): Therapeutic Services runs Health Science
  // Education, Medical Therapeutics, Anatomy and Physiology, then Nursing Education, which Policy
  // 3.103 lists with the work-based learning courses (TN-S3 p. 6); Marketing runs Introduction to
  // Business & Marketing, then Marketing & Management I: Principles and II. Engineering Design I
  // and II stay one named type (they're 3rd lab science substitutes, TN-S3 p. 6): their order comes
  // from the grades they're in (engine/context.ts).
  { type: "cte.health.4", re: /\bnursing education\b/i },
  { type: "cte.health.2", re: /\bmedical therapeutics\b/i },
  // Diagnostic Medicine follows Anatomy and Physiology in Diagnostic Services (Policy 3.205 24.19),
  // and Clinical Internship is one of the work-based learning courses Policy 3.103 lists next to
  // Nursing Education (TN-S3 p. 6): level 4. The IT one is Information Technology's. Maintenance &
  // Light Repair I-IV (28.13-28.16) take their level from the numeral; Fundamentals of Education
  // starts Education and Training. Levels from TDOE's programs of study (not saved): the year count
  // covers a wrong level (engine/fill.ts cteYears).
  { type: "cte.it.4", re: /\b(it|information technology)\b.*\bclinical internship\b/i },
  { type: "cte.health.4", re: /\b(clinical internship|diagnostic medicine)\b/i },
  { type: "cte.transportation.1", re: /\bmaintenance (and|&) light repair\b/i },
  { type: "cte.education.1", re: /\bfundamentals of education\b/i },
  { type: "cte.business.3", re: /\bmarketing (and|&) management\s*(ii|2)\b/i },
  { type: "cte.business.2", re: /\bmarketing (and|&) management(\s*(i|1))?\b/i },
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
  // Utah's completer course is "Nurse Assistant (CNA)" (MP-USBE-CTE, Health Science).
  { type: "cte.nurse_aide", re: /\b(cna|nurse aide|nurse assistant|nursing assistant|patient care)\b/i },
  { type: "cte.emt", re: /\b(emt|emergency medical)\b/i },
  // A health science class with a later-level cue ("Health Science II", "Advanced Health Science")
  // is the cluster's level, not Principles of Health Science.
  { type: "cte.health.1", re: /\bhealth science\b.*\b(ii|iii|iv|2|3|4|advanced|practicum|clinicals?|internship|capstone)\b|\b(advanced|practicum in)\b.*\bhealth science\b/i },
  { type: "cte.health_principles", re: /\bhealth science\b/i },
  { type: "cte.manufacturing.1", re: /\b(welding|machining|manufacturing|cnc)\b/i, broad: cluster("manufacturing") },
  { type: "cte.hospitality.1", re: /\b(culinary|cooking|baking|hospitality)\b/i, broad: cluster("hospitality") },
  { type: "cte.transportation.1", re: /\b(auto(motive)?|diesel|aviation|aircraft|collision repair|small engines?)\b/i, broad: cluster("transportation") },
  { type: "cte.architecture_construction.1", re: /\b(construction|carpentry|electrical|plumbing|hvac|woodworking|woods|cabinet(making|ry)?|architecture)\b/i, broad: cluster("architecture_construction") },
  { type: "cte.education.1", re: /\b(child development|early childhood|teaching|education (and|&) training)\b/i, broad: cluster("education") },
  { type: "cte.law.1", re: /\b(criminal justice|law enforcement|fire science|public safety|legal studies|pre-?law)\b/i, broad: cluster("law") },
  { type: "cte.human_services.1", re: /\b(cosmetology|barbering|family (and|&) consumer|interpersonal)\b/i, broad: cluster("human_services") },
  { type: "cte.it.1", re: /\b(networking|information technology|comptia)\b/i, broad: cluster("it") },
  { type: "cte.business.1", re: /\b(business|marketing|entrepreneurship|finance)\b/i, broad: cluster("business") },
  { type: "cte.ag.1", re: /\b(agri\w*|ag science|horticulture|ffa)\b/i, broad: cluster("ag") },
  { type: "cte.engineering.1", re: /\b(engineering|stem)\b/i, broad: cluster("engineering") },
  { type: "cte.health.1", re: /\b(medical|nursing|pharmacy|sports medicine|dental)\b/i, broad: cluster("health") },
  { type: "cte.arts_av.1", re: /\b(audio|video|broadcast|a\/v)\b/i, broad: cluster("arts_av") },
  { type: "cte.energy.1", re: /\b(energy|oil (and|&) gas|solar)\b/i, broad: cluster("energy") },
];

const LANGUAGE_PATTERNS: [LanguageCode, RegExp][] = [
  ["es", /\b(spanish|espa[nñ]ol)\b/i],
  ["fr", /\b(french|fran[cç]ais)\b/i],
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

/**
 * A language class's level: its numeral first ("Pre-AP Spanish II" and "Spanish II Pre-AP" are level
 * 2), and only without one a college-level or advanced cue ("AP Spanish Language" is level 4).
 * "Pre-AP" is a school's own honors-style label, never AP.
 */
const LANGUAGE_LEVEL_PATTERNS: [LanguageLevel, RegExp][] = [
  [4, /\b(iv|4|v|5|vi|6)\b/i],
  [3, /\b(iii|3)\b/i],
  [2, /\b(ii|2)\b/i],
  [1, /\b(i|1)\b/i],
  [4, /(?<!pre-?\s?)\b(ap|ib)\b|\b(advanced|literature)\b/i],
];

function fitsSubject(type: CourseTypeId, subject: CourseSubject) {
  const t = getCourseType(type);
  return t.subject === subject || t.altSubjects.includes(subject);
}

/**
 * A language class: its language and level from the name. Without a level ("Spanish for Heritage
 * Speakers", "Spanish") it guesses level 1, but it might be any level (students are often placed
 * above level 1), and without a language it might be any language at that level.
 */
function guessLanguage(name: string): TypeGuess {
  const code = LANGUAGE_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? null;
  const cued = LANGUAGE_LEVEL_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? null;
  const level: LanguageLevel = cued ?? LANGUAGE_LEVELS[0];
  const typeId: CourseTypeId = `lang.${code ?? "other"}.${level}`;
  const codes = code ? [code] : LANGUAGES;
  const levels = cued ? [cued] : LANGUAGE_LEVELS;
  const candidates = uniq([typeId, ...codes.flatMap((c) => levels.map((l): CourseTypeId => `lang.${c}.${l}`))]);
  return { typeId, confident: code !== null && cued !== null, candidates };
}

function uniq<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * A career cluster class's level from its name (design §5.2 `cte.{cluster}.{level}`: 1 introduction
 * or principles, 2 concentrator, 3 advanced, 4 practicum or capstone): "Culinary Arts II" is level
 * 2, "Advanced Welding" level 3, "Practicum in Law Enforcement" level 4. A clinical is level 3,
 * next to Health Science Theory (MP-TEA-POS-HS-NURSING-SCIENCE). No cue: level 1.
 */
const CTE_LEVEL_CUES: [2 | 3 | 4, RegExp][] = [
  [4, /\b(practicum|capstone|internship|work-based learning|iv|4)\b/i],
  [3, /\b(advanced|clinicals?|iii|3)\b/i],
  [2, /\b(ii|2|intermediate)\b/i],
];

function cteLevelFromName(type: CourseTypeId, name: string): CourseTypeId {
  const m = /^cte\.([a-z_]+)\.1$/.exec(type);
  if (!m) return type;
  const level = CTE_LEVEL_CUES.find(([, re]) => re.test(name))?.[0];
  if (!level) return type;
  const next = `cte.${m[1]}.${level}`;
  return isCourseTypeId(next) ? next : type;
}

/**
 * A guess from a typed name, and how sure it is.
 * - `typeId`: the most likely kind (the first pattern that matches, within the row's subject).
 * - `confident`: the name names one kind of class. Not for a name no pattern knows (the subject's
 *   "Other … class"), a catch-all for a family of classes ("PE", "Computer Science", "Welding"), a
 *   language class without its level, or a name that matches two rungs of one sequence.
 * - `candidates`: every kind the row might be, the guess first: other rungs of the same sequence
 *   the name also matches, the family a catch-all stands for, or for a name no pattern knows, every
 *   kind of class in the subject (the engine narrows those by grade).
 */
export type TypeGuess = {
  typeId: CourseTypeId;
  confident: boolean;
  candidates: CourseTypeId[];
  /** A name joining two classes ("Gov/Econ"): see `combinedName`. */
  combined?: CombinedName;
};

/**
 * Two classes in one name ("Gov/Econ", "Economics & Personal Finance", "U.S. Government and
 * Economics"): a "/", "&", "+" or "and" with a different kind of class named on each side, and no
 * single class's name spanning it ("Personal Financial Literacy and Economics" is one Texas class,
 * "Anatomy and Physiology" one science class). The row might be either kind, or two half-credit
 * classes recorded as one: never a sure guess. `names` are the two sides of the name, as typed.
 */
export type CombinedName = { parts: [CourseTypeId, CourseTypeId]; names: [string, string] };

type Hit = { type: CourseTypeId; broad?: (t: CourseType) => boolean; from: number; to: number };

const JOINER = /\s*[/&+]\s*|\s+and\s+/gi;

function combinedName(name: string, hits: readonly Hit[]): CombinedName | null {
  for (const j of name.matchAll(JOINER)) {
    const at = j.index;
    const end = at + j[0].length;
    if (hits.some((h) => h.from < at && h.to > at)) continue;
    const left = hits.find((h) => h.to <= at);
    const right = hits.find((h) => h.from >= end && h.type !== left?.type);
    if (!left || !right) continue;
    // Two rungs of one sequence ("Algebra I/Geometry") or two classes of one family ("Art & Music")
    // are one class the student confirms, not two.
    const ladder = getCourseType(left.type).ladder?.id;
    if (ladder !== undefined && getCourseType(right.type).ladder?.id === ladder) continue;
    if ((left.broad && left.broad(getCourseType(right.type))) || (right.broad && right.broad(getCourseType(left.type)))) continue;
    const names: [string, string] = [name.slice(0, at).trim(), name.slice(end).trim()];
    if (!names[0] || !names[1]) continue;
    return { parts: [left.type, right.type], names };
  }
  return null;
}

/** What the guesser knows about a row besides its name: its level, and its school year (null: not known). */
export type RowContext = { level?: CourseTypeLevel; schoolYear?: SchoolYear | null };

/**
 * A guess from a typed name (`guessFromName`), with the kinds the state's schools also use the name
 * for, for the row's level (regular when not given) and school year (not known when not given):
 * those make the guess unsure and are candidates too (exact-titles.ts `otherKindsInState`).
 */
export function guessCourseType(name: string, subject: CourseSubject, state: PlannerState | null = null, row: RowContext = {}): TypeGuess {
  const guess = guessFromName(name, subject, state);
  if (!state) return guess;
  const facts = { level: row.level ?? "regular", schoolYear: row.schoolYear ?? null };
  const others = guess.candidates.flatMap((t) => otherKindsInState(t, name, state, facts)).filter((t) => !guess.candidates.includes(t) && fitsSubject(t, subject));
  return others.length > 0 ? { ...guess, confident: false, candidates: uniq([...guess.candidates, ...others]) } : guess;
}

function guessFromName(name: string, subject: CourseSubject, state: PlannerState | null): TypeGuess {
  if (subject === "world_language") return guessLanguage(name);
  const hits: Hit[] = [];
  for (const p of PATTERNS) {
    if (p.states && (!state || !p.states.includes(state))) continue;
    if (!fitsSubject(p.type, subject)) continue;
    const m = p.re.exec(name);
    if (m) hits.push({ type: cteLevelFromName(p.type, name), broad: p.broad, from: m.index, to: m.index + m[0].length });
  }
  const inSubject = courseTypesForSubject(subject);
  const first = hits[0];
  if (!first) {
    const fallback = SUBJECT_FALLBACK_TYPE[subject];
    return { typeId: fallback, confident: false, candidates: uniq([fallback, ...inSubject.map((t) => t.id)]) };
  }
  const familyOf = (h: Hit) => (h.broad ? inSubject.filter((t) => h.broad!(t)).map((t) => t.id) : []);
  const combined = combinedName(name, hits);
  if (combined) {
    const [left, right] = combined.parts.map((t) => hits.find((h) => h.type === t)!);
    return { typeId: left.type, confident: false, candidates: uniq([left.type, right.type, ...familyOf(left), ...familyOf(right)]), combined };
  }
  if (first.broad) {
    const family = first.broad;
    return { typeId: first.type, confident: false, candidates: uniq([first.type, ...inSubject.filter((t) => family(t)).map((t) => t.id)]) };
  }
  // Another rung of the same sequence named by another part of the name ("Algebra II/Trigonometry"
  // read as Trigonometry also names Algebra II): the row might be either. A pattern matching only
  // words a longer match already covers ("Algebra" inside "Algebra II") names nothing more.
  const ladder = getCourseType(first.type).ladder?.id;
  const same = hits.filter((h) => !h.broad && ladder !== undefined && getCourseType(h.type).ladder?.id === ladder);
  const covered = (h: (typeof hits)[number]) => same.some((o) => o !== h && o.from <= h.from && o.to >= h.to && o.to - o.from > h.to - h.from);
  const others = same.filter((h) => h.type !== first.type && !covered(h)).map((h) => h.type);
  const candidates = uniq([first.type, ...others]);
  return { typeId: first.type, confident: candidates.length === 1, candidates };
}

/**
 * The two half-credit classes a row's name joins ("Gov/Econ", "Economics/Personal Finance"), for a
 * row of a full credit or more (`units` in quarter credits): its kinds and the two sides of its
 * name, so "Confirm your classes" can offer to record it as two half-credit classes. Null for a
 * name that joins full-credit classes ("Speech and Debate") or a half-credit row.
 */
export function combinedHalves(name: string, subject: CourseSubject, units: number, state: PlannerState | null = null): CombinedName | null {
  const combined = guessFromName(name, subject, state).combined;
  return combined && units >= 4 && combined.parts.every((t) => getCourseType(t).units <= 2) ? combined : null;
}

/**
 * The course type a typed class name most likely is, within the row's subject. Always returns a
 * type: the subject's "Other … class" when nothing matches. `state` only disambiguates names like
 * "Math 2" (Utah's Secondary Math II there).
 */
export function guessCourseTypeId(name: string, subject: CourseSubject, state: PlannerState | null = null): CourseTypeId {
  return guessFromName(name, subject, state).typeId;
}

/**
 * A typed title that names one kind of class exactly in the student's state, in the row's school
 * year (null: not known; exact-titles.ts), never a name the guesser reads as two classes ("Algebra
 * II/Trigonometry", "Gov/Econ").
 */
export function exactRowType(name: string, subject: CourseSubject, level: CourseTypeLevel, state: PlannerState, schoolYear: SchoolYear | null = null): ExactCourseType | null {
  const exact = exactCourseType(name, subject, level, state, { schoolYear });
  return exact && !guessFromName(name, subject, state).combined ? exact : null;
}

/**
 * A `student_courses` row's course type and level. A stored type (from the school's list or the
 * student's pick) is used as is; then a title that's exact in the student's state, in the row's
 * school year (null: not known), is that kind (source "exact"), unless the student saved the row
 * as "Not sure"; otherwise the name is guessed and the result is `assumed`.
 */
export function resolveRowCourseType(row: CourseRowForType, state: PlannerState | null = null, schoolYear: SchoolYear | null = null): ResolvedCourseType {
  const level = COURSE_LEVEL_TO_TYPE_LEVEL[row.level];
  if (row.courseTypeId && isCourseTypeId(row.courseTypeId) && (row.courseTypeSource === "catalog" || row.courseTypeSource === "student")) {
    return { typeId: row.courseTypeId, level, source: row.courseTypeSource, assumed: false };
  }
  const exact = state && row.courseTypeSource !== "unsure" ? exactRowType(row.name, row.subject, level, state, schoolYear) : null;
  if (exact) return { typeId: exact.typeId, level: exact.level, source: "exact", assumed: false };
  return { typeId: guessCourseTypeId(row.name, row.subject, state), level, source: "guess", assumed: true };
}
