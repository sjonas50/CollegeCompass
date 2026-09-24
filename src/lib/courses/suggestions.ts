import type { Db } from "@/db";
import type { CourseLevel, CourseSubject } from "@/db/schema";
import { RIASEC_INFO, type Riasec } from "../assessments/instruments";
import { type CareerDetail, getCareer } from "../careers";
import { listNorthStars } from "../goals";

/**
 * High school course ideas that connect to a student's north-star careers. Ideas are generic
 * course types (names vary by school), picked from the career's related college majors (CIP
 * families) or, when those don't help, from the career's RIASEC interest areas.
 */

export type IdeaCourse = { name: string; subject: CourseSubject; level: CourseLevel };

type CourseIdea = {
  id: string;
  title: string;
  subject: CourseSubject;
  /** Whether a course already in the student's plan covers this idea. */
  covers: (c: IdeaCourse) => boolean;
};

const named = (re: RegExp) => (c: IdeaCourse) => re.test(c.name);
const namedOrSubject = (re: RegExp, subject: CourseSubject) => (c: IdeaCourse) => c.subject === subject || re.test(c.name);

const IDEAS: CourseIdea[] = [
  // English and communication
  { id: "english", title: "English and writing", subject: "english", covers: namedOrSubject(/\b(english|writing|composition|literature)\b/i, "english") },
  { id: "creative_writing", title: "Creative writing", subject: "english", covers: named(/\bcreative writing\b/i) },
  { id: "journalism", title: "Journalism or yearbook", subject: "english", covers: named(/\b(journalism|yearbook|newspaper)\b/i) },
  { id: "speech_debate", title: "Speech and debate", subject: "english", covers: named(/\b(speech|debate|public speaking|forensics)\b/i) },
  // Math
  { id: "geometry", title: "Geometry", subject: "math", covers: named(/\bgeometry\b/i) },
  { id: "algebra2", title: "Algebra II", subject: "math", covers: named(/\balgebra\s*(ii|2)\b/i) },
  { id: "precalc_calc", title: "Pre-calculus or calculus", subject: "math", covers: named(/\b(pre-?\s?calc(ulus)?|calculus|calc)\b/i) },
  { id: "statistics", title: "Statistics", subject: "math", covers: named(/\b(statistics|stats?)\b/i) },
  // Science
  { id: "biology", title: "Biology", subject: "science", covers: named(/\b(biology|bio)\b/i) },
  { id: "chemistry", title: "Chemistry", subject: "science", covers: named(/\b(chemistry|chem)\b/i) },
  { id: "physics", title: "Physics", subject: "science", covers: named(/\bphysics\b/i) },
  { id: "anatomy", title: "Anatomy and physiology", subject: "science", covers: named(/\b(anatomy|physiology)\b/i) },
  { id: "environmental", title: "Environmental or earth science", subject: "science", covers: named(/\b(environmental|ecology|earth science|earth and space|geology|marine)\b/i) },
  // Social studies
  { id: "history", title: "History", subject: "social_studies", covers: named(/\bhistory\b/i) },
  { id: "government", title: "Government and civics", subject: "social_studies", covers: named(/\b(government|civics|gov)\b/i) },
  { id: "economics", title: "Economics", subject: "social_studies", covers: named(/\b(economics|econ)\b/i) },
  { id: "psychology", title: "Psychology", subject: "social_studies", covers: named(/\bpsych(ology)?\b/i) },
  { id: "sociology", title: "Sociology", subject: "social_studies", covers: named(/\bsociology\b/i) },
  // World language
  {
    id: "world_language",
    title: "A world language",
    subject: "world_language",
    covers: namedOrSubject(
      /\b(spanish|french|german|chinese|mandarin|japanese|korean|latin|arabic|italian|portuguese|russian|asl|sign language)\b/i,
      "world_language",
    ),
  },
  // Arts
  { id: "art", title: "Visual art", subject: "arts", covers: named(/\b(art|drawing|painting|ceramics|sculpture)\b/i) },
  { id: "music", title: "Music (band, choir or orchestra)", subject: "arts", covers: named(/\b(music|band|choir|chorus|orchestra|guitar|piano)\b/i) },
  { id: "theater", title: "Theater or drama", subject: "arts", covers: named(/\b(theat(er|re)|drama|acting|stagecraft)\b/i) },
  {
    id: "digital_media",
    title: "Digital media or graphic design",
    subject: "arts",
    covers: named(/\b(digital media|digital art|graphic design|video|film|animation|photography|web design|media arts)\b/i),
  },
  // Computer science
  { id: "computer_science", title: "Computer science", subject: "computer_science", covers: namedOrSubject(/\b(computer science|programming|coding)\b/i, "computer_science") },
  {
    id: "ap_cs",
    title: "AP Computer Science Principles or AP Computer Science A",
    subject: "computer_science",
    covers: (c) => (c.subject === "computer_science" && c.level === "ap") || /\b(ap\s*(cs|computer science)|computer science (principles|a)|csp)\b/i.test(c.name),
  },
  // Career and technical education
  { id: "cte_pathway", title: "A career and technical (CTE) pathway", subject: "career_technical", covers: (c) => c.subject === "career_technical" },
  { id: "engineering_cte", title: "Engineering or robotics (CTE)", subject: "career_technical", covers: named(/\b(engineering|robotics|pltw|cad|drafting)\b/i) },
  { id: "health_science_cte", title: "Health science (CTE)", subject: "career_technical", covers: named(/\b(health science|medical|nursing|cna|emt|pharmacy|sports medicine)\b/i) },
  { id: "business_cte", title: "Business or marketing (CTE)", subject: "career_technical", covers: named(/\b(business|marketing|entrepreneurship|deca)\b/i) },
  { id: "accounting", title: "Accounting", subject: "career_technical", covers: named(/\baccounting\b/i) },
  { id: "personal_finance", title: "Personal finance", subject: "other", covers: named(/\b(personal finance|financial literacy|money management)\b/i) },
  { id: "agriculture_cte", title: "Agriculture or animal science (CTE)", subject: "career_technical", covers: named(/\b(agri\w*|ag science|animal science|horticulture|veterinary|ffa)\b/i) },
  { id: "construction_cte", title: "Construction or building trades (CTE)", subject: "career_technical", covers: named(/\b(construction|carpentry|woodworking|wood shop|building trades|electrical|plumbing|hvac)\b/i) },
  { id: "auto_cte", title: "Automotive, aviation or transportation (CTE)", subject: "career_technical", covers: named(/\b(auto(motive)?|mechanics?|small engines?|diesel|aviation|transportation)\b/i) },
  { id: "manufacturing_cte", title: "Manufacturing or welding (CTE)", subject: "career_technical", covers: named(/\b(manufacturing|welding|machining|metal ?shop|cnc)\b/i) },
  { id: "culinary_cte", title: "Culinary arts (CTE)", subject: "career_technical", covers: named(/\b(culinary|cooking|baking|foods|nutrition)\b/i) },
  { id: "education_cte", title: "Child development or teaching (CTE)", subject: "career_technical", covers: named(/\b(child development|early childhood|teaching|teacher cadet|education)\b/i) },
  { id: "public_safety_cte", title: "Law and public safety (CTE)", subject: "career_technical", covers: named(/\b(criminal justice|law enforcement|public safety|fire science|forensics?)\b/i) },
  { id: "it_cte", title: "Information technology or cybersecurity (CTE)", subject: "career_technical", covers: named(/\b(information technology|networking|cyber\s?security|comptia)\b/i) },
  // Health
  { id: "health_pe", title: "Health and PE", subject: "health_pe", covers: namedOrSubject(/\b(physical education|pe|fitness|weight training)\b/i, "health_pe") },
];

const IDEA_BY_ID = new Map(IDEAS.map((i) => [i.id, i]));

/** CIP 2020 two-digit families (the first two digits of a major's CIP code) to course ideas. */
export const CIP_FAMILY_IDEAS: Record<string, string[]> = {
  "01": ["biology", "chemistry", "agriculture_cte", "environmental"], // Agriculture
  "03": ["biology", "environmental", "chemistry", "agriculture_cte"], // Natural resources and conservation
  "04": ["geometry", "precalc_calc", "physics", "art", "engineering_cte"], // Architecture
  "05": ["world_language", "history", "english", "sociology"], // Area, ethnic and cultural studies
  "09": ["english", "journalism", "speech_debate", "digital_media"], // Communication and journalism
  "10": ["digital_media", "computer_science", "journalism"], // Communications technologies
  "11": ["computer_science", "ap_cs", "precalc_calc", "statistics", "it_cte"], // Computer and information sciences
  "12": ["culinary_cte", "business_cte", "health_pe"], // Personal and culinary services
  "13": ["education_cte", "psychology", "english", "speech_debate"], // Education
  "14": ["physics", "precalc_calc", "chemistry", "computer_science", "engineering_cte"], // Engineering
  "15": ["physics", "algebra2", "engineering_cte", "manufacturing_cte", "computer_science"], // Engineering technologies
  "16": ["world_language", "english", "history"], // Foreign languages
  "19": ["education_cte", "culinary_cte", "psychology", "health_pe"], // Family and consumer sciences
  "22": ["government", "english", "speech_debate", "history"], // Legal professions
  "23": ["english", "creative_writing", "journalism", "world_language"], // English language and literature
  "24": ["english", "history", "world_language", "statistics"], // Liberal arts
  "26": ["biology", "chemistry", "anatomy", "statistics", "precalc_calc"], // Biological sciences
  "27": ["precalc_calc", "statistics", "computer_science", "physics"], // Math and statistics
  "31": ["health_pe", "anatomy", "biology", "psychology"], // Parks, recreation and kinesiology
  "38": ["english", "history", "speech_debate"], // Philosophy and religious studies
  "40": ["chemistry", "physics", "precalc_calc", "environmental"], // Physical sciences
  "41": ["chemistry", "biology", "physics", "statistics"], // Science technologies
  "42": ["psychology", "statistics", "biology", "sociology"], // Psychology
  "43": ["public_safety_cte", "government", "psychology", "health_pe"], // Security, law enforcement, firefighting
  "44": ["government", "economics", "psychology", "sociology"], // Public administration and social service
  "45": ["history", "government", "economics", "statistics", "psychology"], // Social sciences
  "46": ["construction_cte", "geometry", "physics"], // Construction trades
  "47": ["auto_cte", "physics", "manufacturing_cte"], // Mechanic and repair technologies
  "48": ["manufacturing_cte", "geometry", "engineering_cte"], // Precision production
  "49": ["auto_cte", "physics", "geometry"], // Transportation
  "50": ["art", "music", "theater", "digital_media"], // Visual and performing arts
  "51": ["biology", "chemistry", "anatomy", "health_science_cte", "psychology", "statistics"], // Health professions
  "52": ["economics", "statistics", "business_cte", "accounting", "personal_finance"], // Business
  "54": ["history", "government", "english", "world_language"], // History
};

/** Fallback when a career's majors don't map to course ideas. */
export const RIASEC_IDEAS: Record<Riasec, string[]> = {
  R: ["engineering_cte", "construction_cte", "physics", "auto_cte"],
  I: ["biology", "chemistry", "physics", "statistics", "computer_science"],
  A: ["art", "music", "theater", "creative_writing", "digital_media"],
  S: ["psychology", "education_cte", "health_science_cte", "speech_debate", "sociology"],
  E: ["business_cte", "economics", "speech_debate", "personal_finance"],
  C: ["accounting", "statistics", "computer_science", "business_cte"],
};

export const MAX_IDEAS_PER_CAREER = 6;
const MIN_IDEAS = 4;

export const SUGGESTIONS_NOTE =
  "Class names are different at every school. Ask your school counselor which of these your school offers.";

export type SuggestedIdea = { id: string; title: string; subject: CourseSubject; inPlan: boolean };

export type CareerSuggestion = {
  occupationCode: string;
  title: string;
  /** "majors" when ideas come from related college majors, "interests" when from RIASEC areas. */
  basis: "majors" | "interests";
  /** One plain sentence explaining where the ideas come from. */
  because: string;
  ideas: SuggestedIdea[];
};

export type SuggestionCareer = Pick<CareerDetail, "code" | "title" | "pathway" | "interests" | "majors">;

/** CIP families ordered by how many of the career's majors fall in them (ties keep first-seen order). */
function familiesByWeight(majors: { cipCode: string }[]) {
  const counts = new Map<string, number>();
  for (const m of majors) {
    const family = m.cipCode.slice(0, 2);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

function listJoin(items: string[]) {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function ideasForCareer(career: SuggestionCareer, courses: IdeaCourse[]): CareerSuggestion {
  const picked: CourseIdea[] = [];
  const add = (ids: string[]) => {
    for (const id of ids) {
      const idea = IDEA_BY_ID.get(id);
      if (idea && !picked.includes(idea)) picked.push(idea);
    }
  };

  // Career-training paths value CTE pathway courses, so lead with one.
  if (career.pathway === "training") add(["cte_pathway"]);
  const families = familiesByWeight(career.majors).filter((f) => CIP_FAMILY_IDEAS[f]);
  add(families.flatMap((f) => CIP_FAMILY_IDEAS[f]));
  const fromMajors = families.length > 0;

  const topAreas = career.interests.filter((i) => i.score > 0).slice(0, 2).map((i) => i.area);
  if (picked.length < MIN_IDEAS) for (const area of topAreas) add(RIASEC_IDEAS[area]);

  const ideas = picked.slice(0, MAX_IDEAS_PER_CAREER).map(
    (idea): SuggestedIdea => ({ id: idea.id, title: idea.title, subject: idea.subject, inPlan: courses.some(idea.covers) }),
  );

  const majorTitles = families
    .flatMap((f) => career.majors.filter((m) => m.cipCode.slice(0, 2) === f))
    .slice(0, 2)
    .map((m) => m.title);
  const because = fromMajors
    ? `Connected to ${career.pathway === "training" ? "training programs" : "college majors"} like ${listJoin(majorTitles)}.`
    : topAreas.length
      ? `Based on the ${listJoin(topAreas.map((a) => RIASEC_INFO[a].name))} interests this career uses.`
      : "General ideas to explore while you learn more about this career.";

  return { occupationCode: career.code, title: career.title, basis: fromMajors ? "majors" : "interests", because, ideas };
}

/** Course ideas for each of the student's north stars (careers missing from reference data are skipped). */
export async function courseSuggestions(db: Db, userId: string, courses: IdeaCourse[]): Promise<CareerSuggestion[]> {
  const stars = await listNorthStars(db, userId);
  const careers = await Promise.all(stars.map((s) => getCareer(db, s.occupationCode)));
  return careers.filter((c): c is CareerDetail => c !== null).map((c) => ideasForCareer(c, courses));
}
