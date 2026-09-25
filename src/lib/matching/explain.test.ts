import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb, schema } from "@/db";
import type { MatchExplanation } from "@/db/schema";
import { registerStudent } from "@/lib/accounts";
import { JOB_ZONE_INFO } from "../job-zones";
import { INTEREST_ITEMS, PERSONALITY_ITEMS, type Riasec } from "../assessments/instruments";
import { interestPattern } from "../assessments/interest-pattern";
import { completeAttempt, saveResponses, startOrResumeAttempt } from "../assessments/service";
import {
  AREA_PHRASE,
  EXPLANATION_FACTS_VERSION,
  MAX_REASON_WORDS,
  type TemplateCareer,
  careerClause,
  explainLatestMatches,
  interestFacts,
  longerClauses,
  storedExplanation,
  strengthFacts,
  templateExplanation,
} from "./explain";
import { fitLabel, scoreOccupation } from "./match";
import { computeMatches, latestMatchRun, loadOccupationProfiles } from "./service";

// The written explanation of a student's matches never claims interest areas their scores don't
// show: not for a tie, and not when every area scored about the same.

const areas = (scores: Partial<Record<Riasec, number>>) => ({ R: 0, I: 0, A: 0, S: 0, E: 0, C: 0, ...scores });
const profile = (scores: Partial<Record<Riasec, number>>) => ({ R: 1, I: 1, A: 1, S: 1, E: 1, C: 1, ...scores });
// Real O*NET descriptions and job zones.
const chemist = {
  occupationCode: "19-2031.00",
  title: "Chemists",
  jobZone: 4,
  description:
    "Conduct qualitative and quantitative chemical analyses or experiments in laboratories for quality or process control or to develop new products or knowledge.",
  interests: profile({ I: 7, R: 4 }),
};
const teacher = {
  occupationCode: "25-2031.00",
  title: "Secondary School Teachers",
  jobZone: 4,
  description: "Teach one or more subjects to students at the secondary school level.",
  interests: profile({ S: 7, A: 4 }),
};
const electrician = {
  occupationCode: "47-2111.00",
  title: "Electricians",
  jobZone: 3,
  description: "Install, maintain, and repair electrical wiring, equipment, and fixtures. Ensure that work is in accordance with relevant codes.",
  interests: profile({ R: 7, C: 4, I: 3 }),
};
const counselor = {
  occupationCode: "21-1014.00",
  title: "Mental Health Counselors",
  jobZone: 5,
  description: "Counsel and advise individuals and groups to promote optimum mental and emotional health, with an emphasis on prevention.",
  interests: profile({ S: 7, I: 4, A: 3 }),
};
const page = [chemist, teacher, electrician, counselor];
// Real careers whose reasons ran past MAX_REASON_WORDS: long descriptions with no clean shorter cut.
const longCareers: TemplateCareer[] = [
  {
    occupationCode: "49-3052.00",
    title: "Motorcycle Mechanics",
    jobZone: 3,
    description: "Diagnose, adjust, repair, or overhaul motorcycles, scooters, mopeds, dirt bikes, or similar motorized vehicles.",
    interests: { R: 7, I: 3.12, A: 1.23, S: 1.44, E: 1, C: 3.64 },
  },
  {
    occupationCode: "51-9071.00",
    title: "Jewelers and Precious Stone and Metal Workers",
    jobZone: 3,
    description: "Design, fabricate, adjust, repair, or appraise jewelry, gold, silver, other precious metals, or gems.",
    interests: { R: 6.59, I: 2.6, A: 3.7, S: 1.03, E: 1.51, C: 3.35 },
  },
  {
    occupationCode: "15-1254.00",
    title: "Web Developers",
    jobZone: 3,
    description:
      "Develop and implement websites, web applications, application databases, and interactive web interfaces. Evaluate code to ensure that it is properly structured, meets industry standards, and is compatible with browsers and devices.",
    interests: { R: 2.98, I: 5.01, A: 3.13, S: 2.22, E: 2.96, C: 5.03 },
  },
  {
    occupationCode: "33-2021.00",
    title: "Fire Inspectors and Investigators",
    jobZone: 3,
    description:
      "Inspect buildings to detect fire hazards and enforce local ordinances and state laws, or investigate and gather facts to determine cause of fires and explosions.",
    interests: { R: 5.49, I: 4.33, A: 1.02, S: 2.59, E: 3.32, C: 5.18 },
  },
  {
    occupationCode: "23-2011.00",
    title: "Paralegals and Legal Assistants",
    jobZone: 3,
    description:
      "Assist lawyers by investigating facts, preparing legal documents, or researching legal precedent. Conduct research to support a legal proceeding, to formulate a defense, or to initiate legal action.",
    interests: { R: 1.74, I: 5.04, A: 2.24, S: 3.12, E: 3.92, C: 5.28 },
  },
  {
    occupationCode: "49-3011.00",
    title: "Aircraft Mechanics and Service Technicians",
    jobZone: 3,
    description: "Diagnose, adjust, repair, or overhaul aircraft engines and assemblies, such as hydraulic and pneumatic systems.",
    interests: { R: 6.7, I: 3.81, A: 1, S: 1.31, E: 1.84, C: 4.7 },
  },
  {
    occupationCode: "19-1041.00",
    title: "Epidemiologists",
    jobZone: 5,
    description:
      "Investigate and describe the determinants and distribution of disease, disability, or health outcomes. May develop the means for prevention and control.",
    interests: { R: 2.82, I: 7, A: 2.19, S: 4.11, E: 2.37, C: 3.63 },
  },
  {
    occupationCode: "35-1011.00",
    title: "Chefs and Head Cooks",
    jobZone: 3,
    description:
      "Direct and may participate in the preparation, seasoning, and cooking of salads, soups, fish, meats, vegetables, desserts, or other foods. May plan and price menu items, order supplies, and keep records and accounts.",
    interests: { R: 4.84, I: 1.68, A: 2.72, S: 2.95, E: 5.13, C: 4.35 },
  },
];
/** A student who liked the career's two strongest areas and disliked the rest. */
const likesTopTwo = (career: TemplateCareer): Record<Riasec, number> => {
  const [first, second] = (["R", "I", "A", "S", "E", "C"] as const).toSorted((a, b) => career.interests![b] - career.interests![a]);
  return areas({ R: 10, I: 10, A: 10, S: 10, E: 10, C: 10, [first]: 40, [second]: 35 });
};
const reasons = (scores: Partial<Record<Riasec, number>>, careers: TemplateCareer[] = page) =>
  templateExplanation(areas(scores), careers).careers.map((c) => c.why);
const wordCount = (s: string) => s.split(/\s+/).length;

describe("template explanation", () => {
  it("says what the work is, the preparation it needs, and the interests it shares with the student", () => {
    const e = templateExplanation(areas({ I: 40, R: 30, A: 20 }), [chemist, electrician, counselor]);
    expect(e.overview).toMatch(/^Your strongest interest areas are Investigative and Realistic, followed by Artistic\./);
    // Chemists: one shared area instead of two keeps it short. Electricians: the whole clause, which
    // has no shorter clean cut, and no area. (See "keeps each reason to one short sentence".)
    expect(e.careers.map((c) => c.why)).toEqual([
      "Usually after a bachelor's degree, you could conduct qualitative and quantitative chemical analyses or experiments, using your interest in figuring things out.",
      "Usually after career training or a two-year degree, you'd install, maintain, and repair electrical wiring, equipment, and fixtures.",
      "Usually after a graduate degree, you could counsel and advise individuals and groups, using your interest in figuring things out.",
    ]);
  });

  it("names only areas the student leans toward, never one they disliked", () => {
    // Artistic reached "Not sure" (20 of 40); teaching is strongly social, which this student disliked.
    expect(reasons({ I: 40, R: 30, A: 20 }, [teacher])).toEqual([
      "Usually after a bachelor's degree, you could teach one or more subjects, using your interest in creating things.",
    ]);
    // One "Dislike" among the social activities: Social scored 1 of 40.
    const [chemistWhy, teacherWhy, electricianWhy, counselorWhy] = reasons({ A: 40, S: 1 });
    expect(teacherWhy).toMatch(/your interest in creating things\.$/);
    for (const why of [chemistWhy, electricianWhy, counselorWhy]) expect(why).not.toMatch(/interest/);
    expect([chemistWhy, teacherWhy, electricianWhy, counselorWhy].join(" ")).not.toMatch(/helping people|figuring things out|hands-on/);

    // Areas the student liked count even when a tie keeps them out of the top interests.
    expect(reasons({ I: 40, A: 30, S: 30, E: 30 })[3]).toBe(
      "Usually after a graduate degree, you'd counsel and advise individuals and groups, which fits your interest in figuring things out and helping people.",
    );
  });

  it("never names an area the student leaned toward disliking, for any scores", () => {
    // A fixed pseudo-random walk over scores and career profiles.
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const areasList = ["R", "I", "A", "S", "E", "C"] as const;
    for (let round = 0; round < 300; round++) {
      const student = Object.fromEntries(areasList.map((a) => [a, next(41)])) as Record<Riasec, number>;
      const careers = Array.from({ length: 8 }, (_, i) => ({
        ...chemist,
        occupationCode: `code-${i}`,
        title: `Career ${i}`,
        interests: Object.fromEntries(areasList.map((a) => [a, 1 + next(7)])) as Record<Riasec, number>,
      }));
      const e = templateExplanation(student, careers);
      const disliked = areasList.filter((a) => student[a] < 20).map((a) => AREA_PHRASE[a]);
      for (const { why } of e.careers) {
        for (const phrase of disliked) expect(why, JSON.stringify(student)).not.toContain(phrase);
      }
      expect(new Set(e.careers.map((c) => c.why)).size).toBe(careers.length);
    }
  });

  it("says no area stands out when every area scored about the same, and names none in the reasons", () => {
    for (const level of [0, 20, 40]) {
      const e = templateExplanation(areas({ R: level, I: level, A: level, S: level, E: level, C: level }), page);
      expect(e.overview).toMatch(/^You rated all six interest areas about the same, so no area stands out yet\./);
      expect(e.overview).not.toMatch(/strongest|Realistic|Investigative/);
      expect(e.careers.map((c) => c.why)).toEqual([
        "Usually after a bachelor's degree, you could conduct qualitative and quantitative chemical analyses or experiments.",
        "Usually after a bachelor's degree, you'd teach one or more subjects to students at the secondary school level.",
        "Usually after career training or a two-year degree, you could install, maintain, and repair electrical wiring, equipment, and fixtures.",
        "Usually after a graduate degree, you'd counsel and advise individuals and groups.",
      ]);
      expect(e.careers.every((c) => !/interest/.test(c.why))).toBe(true);
    }
  });

  it("says no area stands out when no area reached 'Not sure' on average", () => {
    // "Dislike" on the Conventional activities and "Strongly dislike" on the rest.
    const e = templateExplanation(areas({ C: 10 }), page);
    expect(e.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(e.overview).not.toMatch(/strongest|Conventional/);
    expect(e.careers.every((c) => !/interest|organized/.test(c.why))).toBe(true);
  });

  it("never gives two careers on a page the same reason", () => {
    // No descriptions, the same preparation and the same interests: only the career's name differs.
    const alike = Array.from({ length: 6 }, (_, i) => ({ occupationCode: `27-10${i}`, title: `Designers ${i}`, jobZone: 4, interests: profile({ A: 7 }) }));
    const whys = reasons({ A: 40 }, alike);
    expect(new Set(whys).size).toBe(6);
    expect(whys.slice(0, 2)).toEqual([
      "Usually after a bachelor's degree, this career uses your interest in creating things.",
      "Usually after a bachelor's degree, this path fits your interest in creating things.",
    ]);
    // Neighbors start from different wordings. (Two areas would make the first too long, so one is named.)
    expect(reasons({ A: 40, S: 30 }, [teacher, counselor])).toEqual([
      "Usually after a bachelor's degree, you could teach one or more subjects, using your interest in creating things.",
      "Usually after a graduate degree, you'd counsel and advise individuals and groups, which fits your interest in helping people.",
    ]);
  });

  it("never says two careers on a page do the same work, with only the wording changed", () => {
    // Real O*NET descriptions that all start "Plan, direct, or coordinate activities".
    const managers: TemplateCareer[] = [
      {
        occupationCode: "11-2033.00",
        title: "Fundraising Managers",
        jobZone: 4,
        description: "Plan, direct, or coordinate activities to solicit and maintain funds for special projects or nonprofit organizations.",
        interests: { R: 1, I: 2.41, A: 2.61, S: 3.76, E: 7, C: 4.82 },
      },
      {
        occupationCode: "11-2032.00",
        title: "Public Relations Managers",
        jobZone: 4,
        description:
          "Plan, direct, or coordinate activities designed to create or maintain a favorable public image or raise issue awareness for their organization or client.",
        interests: { R: 1, I: 2.34, A: 3.67, S: 4.18, E: 7, C: 4.39 },
      },
      {
        occupationCode: "11-9179.02",
        title: "Spa Managers",
        jobZone: 3,
        description: "Plan, direct, or coordinate activities of a spa facility. Coordinate programs, schedule and direct staff, and oversee financial activities.",
        interests: { R: 2.5, I: 1.31, A: 1.84, S: 4.19, E: 7, C: 4.91 },
      },
    ];
    // The page from the bug report: "Strongly like" every enterprising activity, "Dislike" every
    // social one. Each would say "plan, direct, or coordinate activities" on its own.
    for (const manager of managers) {
      expect(reasons({ E: 40, S: 10 }, [manager])[0]).toMatch(/ plan, direct, or coordinate activities, (using|which fits) your interest in leading others\.$/);
    }
    // Together, the first keeps it, and the others say what sets them apart. The public relations
    // one fits only in the shorter wording ("you'd…"), which is exactly 24 words.
    const whys = reasons({ E: 40, S: 10 }, managers);
    expect(whys).toEqual([
      "Usually after a bachelor's degree, you could plan, direct, or coordinate activities, using your interest in leading others.",
      "Usually after a bachelor's degree, you'd plan, direct, or coordinate activities designed to create or maintain a favorable public image or raise issue awareness.",
      "Usually after career training or a two-year degree, you could plan, direct, or coordinate activities of a spa facility.",
    ]);
    for (const why of whys) expect(wordCount(why), why).toBeLessThanOrEqual(MAX_REASON_WORDS);
    // In another order the fundraising one takes the shortest cut that sets it apart, keeping the interest.
    expect(reasons({ E: 40, S: 10 }, [managers[2], managers[0]])).toEqual([
      "Usually after career training or a two-year degree, you could plan, direct, or coordinate activities, using your interest in leading others.",
      "Usually after a bachelor's degree, you'd plan, direct, or coordinate activities to solicit and maintain funds, which fits your interest in leading others.",
    ]);
  });

  it("says why a career fits instead, when its description says nothing another one's doesn't", () => {
    // O*NET describes both aides the same way once "Under close supervision of…," is left out.
    const aides: TemplateCareer[] = [
      {
        occupationCode: "31-2022.00",
        title: "Physical Therapist Aides",
        jobZone: 2,
        description:
          "Under close supervision of a physical therapist or physical therapy assistant, perform only delegated, selected, or routine tasks in specific situations. These duties include preparing the patient and the treatment area.",
        interests: { R: 4.74, I: 2.58, A: 1.07, S: 5.95, E: 2.06, C: 3.92 },
      },
      {
        occupationCode: "31-2012.00",
        title: "Occupational Therapy Aides",
        jobZone: 3,
        description:
          "Under close supervision of an occupational therapist or occupational therapy assistant, perform only delegated, selected, or routine tasks in specific situations. These duties include preparing patient and treatment room.",
        interests: { R: 3.91, I: 2.55, A: 1.69, S: 6, E: 1.82, C: 3.72 },
      },
    ];
    expect(reasons({ S: 40, R: 30 }, aides)).toEqual([
      "Usually with some on-the-job training, you could perform only delegated, selected, or routine tasks in specific situations, using your interest in helping people.",
      "Usually after career training or a two-year degree, this path fits your interest in helping people.",
    ]);
    // The same career twice (as `npm run check:reasons` checks it) never repeats its clause either.
    const twice = reasons({ S: 40, A: 30 }, [teacher, { ...teacher, occupationCode: "neighbor" }]);
    expect(twice[1]).not.toMatch(/teach/);
  });

  it("keeps each reason to one short sentence", () => {
    for (const scores of [{ I: 40, R: 30, A: 20 }, { A: 40, S: 30 }, { S: 40, I: 30, A: 25 }, { R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 }]) {
      for (const why of reasons(scores)) {
        expect(wordCount(why), why).toBeLessThanOrEqual(MAX_REASON_WORDS);
        expect(why.match(/[.!?](\s|$)/g), why).toHaveLength(1);
      }
    }
    // Real long descriptions, for a student who shares the career's two strongest areas, in both
    // wordings (a neighbor starts from the other one). `npm run check:reasons` checks every career.
    for (const career of longCareers) {
      const whys = templateExplanation(likesTopTwo(career), [career, { ...career, occupationCode: "neighbor" }]).careers.map((c) => c.why);
      for (const why of whys) {
        expect(wordCount(why), why).toBeLessThanOrEqual(MAX_REASON_WORDS);
        expect(why.match(/[.!?](\s|$)/g), why).toHaveLength(1);
      }
    }
  });

  it("trims a long reason in order: one area, a shorter clause, no area, then no clause", () => {
    const why = (career: TemplateCareer) => templateExplanation(likesTopTwo(career), [career]).careers[0].why;
    const [motorcycles, jewelers, web, fire, paralegals, aircraft, epidemiologists, chefs] = longCareers;
    // One area instead of two.
    expect(why(chemist)).toBe(
      "Usually after a bachelor's degree, you could conduct qualitative and quantitative chemical analyses or experiments, using your interest in figuring things out.",
    );
    // A shorter clause that still reads as a whole.
    expect(why(teacher)).toBe("Usually after a bachelor's degree, you could teach one or more subjects, using your interest in helping people.");
    // No clean shorter clause: what the work is, without an area.
    expect([motorcycles, jewelers, web, fire, paralegals, aircraft, epidemiologists, chefs].map(why)).toEqual([
      "Usually after career training or a two-year degree, you could diagnose, adjust, repair, or overhaul motorcycles, scooters, mopeds, dirt bikes, or similar motorized vehicles.",
      "Usually after career training or a two-year degree, you could design, fabricate, adjust, repair, or appraise jewelry, gold, silver, other precious metals, or gems.",
      "Usually after career training or a two-year degree, you could develop and implement websites, web applications, application databases, and interactive web interfaces.",
      "Usually after career training or a two-year degree, you could inspect buildings to detect fire hazards and enforce local ordinances and state laws.",
      "Usually after career training or a two-year degree, you could assist lawyers by investigating facts, preparing legal documents, or researching legal precedent.",
      "Usually after career training or a two-year degree, you could diagnose, adjust, repair, or overhaul aircraft engines and assemblies.",
      "Usually after a graduate degree, you could investigate and describe the determinants and distribution of disease, disability, or health outcomes.",
      "Usually after career training or a two-year degree, you could direct and may participate in the preparation, seasoning, and cooking of salads.",
    ]);
    // No clean clause at all: why it fits, without what the work is.
    const inspectors: TemplateCareer = {
      occupationCode: "51-9061.00",
      title: "Inspectors, Testers, Sorters, Samplers, and Weighers",
      jobZone: 2,
      description:
        "Inspect, test, sort, sample, or weigh nonagricultural raw materials or processed, machined, fabricated, or assembled parts or products for defects, wear, and deviations from specifications.",
      interests: profile({ R: 5, C: 5 }),
    };
    expect(why(inspectors)).toBe("Usually with some on-the-job training, this career uses your interest in hands-on work and keeping things organized.");
  });

  it("hedges the preparation a career needs, as its career page does", () => {
    for (const [zone, info] of Object.entries(JOB_ZONE_INFO)) {
      expect(info.detail).toMatch(/^Usually /);
      expect(info.reasonLead).toMatch(/^Usually /);
      const [why] = reasons({ A: 40 }, [{ ...teacher, jobZone: Number(zone) }]);
      expect(why.startsWith(`${info.reasonLead}, `), why).toBe(true);
    }
    // Never a flat requirement: zone 5 includes careers, like chief executives, that don't need one.
    expect(reasons({ A: 40 }, page).join(" ")).not.toMatch(/\bWith (a|an|some|little|career)\b/);
  });
});

describe("what a career involves, from its O*NET description", () => {
  it.each([
    [
      "Design or create graphics to meet specific commercial or promotional needs, such as packaging, displays, or logos. May use a variety of mediums.",
      "design or create graphics to meet specific commercial or promotional needs",
    ],
    [
      "Assess patient health problems and needs, develop and implement nursing care plans, and maintain medical records. Administer nursing care.",
      "assess patient health problems and needs",
    ],
    [
      "Install, configure, and maintain an organization's local area network (LAN), wide area network (WAN), data communications network, operating systems, and physical and virtual servers.",
      "install, configure, and maintain an organization's local area network",
    ],
    ["Create original artwork using any of a wide variety of media and techniques.", "create original artwork using any of a wide variety of media and techniques"],
    [
      "Teach courses pertaining to the culture and development of an area, an ethnic group, or any other group, such as Latin American studies.",
      "teach courses in the culture and development of an area",
    ],
    ["Under the direction of a dentist, perform limited clinical duties, such as equipment preparation and sterilization.", "perform limited clinical duties"],
    ["Lead U.S. Army units in combat. Plan missions.", "lead U.S. Army units in combat"],
    // Real descriptions that used to be cut partway through a phrase or a list.
    [
      "Assess, plan, organize, and participate in rehabilitative programs that improve mobility, relieve pain, increase strength, and improve or correct disabling conditions resulting from disease or injury.",
      "assess, plan, organize, and participate in rehabilitative programs",
    ],
    [
      "Direct and may participate in the preparation, seasoning, and cooking of salads, soups, fish, meats, vegetables, desserts, or other foods. May plan and price menu items, order supplies, and keep records and accounts.",
      "direct and may participate in the preparation, seasoning, and cooking of salads",
    ],
    [
      "Investigate and describe the determinants and distribution of disease, disability, or health outcomes. May develop the means for prevention and control.",
      "investigate and describe the determinants and distribution of disease, disability, or health outcomes",
    ],
    [
      "Sell business goods or services, the selling of which requires a technical background equivalent to a baccalaureate degree in engineering.",
      "sell business goods or services",
    ],
    [
      "Perform duties related to the purchase, sale, or holding of securities. Duties include writing orders for stock purchases or sales.",
      "perform duties related to the purchase, sale, or holding of securities",
    ],
    [
      "Using sophisticated climbing and rigging techniques, cut away dead or excess branches from trees or shrubs to maintain right-of-way for roads, sidewalks, or utilities, or to improve appearance, health, and value of tree.",
      "cut away dead or excess branches",
    ],
    ["In a gambling establishment, conduct financial transactions for patrons. Accept patron's credit application.", "conduct financial transactions for patrons"],
    [
      "Investigate atmospheric phenomena and interpret meteorological data, gathered by surface and air stations, satellites, and radar to prepare reports and forecasts for public and other uses.",
      "investigate atmospheric phenomena and interpret meteorological data",
    ],
    [
      "Inspect equipment or goods in connection with the safe transport of cargo or people. Includes rail transportation inspectors.",
      "inspect equipment or goods in connection with the safe transport of cargo or people",
    ],
    [
      "Post information enabling patrons to wager on various races and sporting events. Assist in the operation of games such as keno and bingo.",
      "post information enabling patrons to wager on various races and sporting events",
    ],
    [
      "Interview persons by telephone, mail, in person, or by other means for the purpose of completing forms, applications, or questionnaires.",
      "interview persons by telephone, mail, in person, or by other means",
    ],
    [
      "Inspect, test, sort, sample, or weigh nonagricultural raw materials or processed, machined, fabricated, or assembled parts or products for defects, wear, and deviations from specifications.",
      null,
    ],
    [
      "Install, inspect, test, maintain, or repair electric gate crossings, signals, signal equipment, track switches, section lines, or intercommunications systems within a railroad system.",
      "install, inspect, test, maintain, or repair electric gate crossings",
    ],
    [
      "Feed materials into or remove materials from machines or equipment that is automatic or tended by other workers.",
      "feed materials into or remove materials from machines or equipment",
    ],
    [
      "Plan, direct, or coordinate the work activities and resources necessary for manufacturing products in accordance with cost, quality, and quantity specifications.",
      "plan, direct, or coordinate the work activities and resources",
    ],
    [
      "Purchase machinery, equipment, tools, parts, supplies, or services necessary for the operation of an establishment. Purchase raw or semifinished materials for manufacturing.",
      "purchase machinery, equipment, tools, parts, supplies, or services",
    ],
    [
      "Perform technical activities at power plants or individual installations necessary for the generation of power from geothermal energy sources.",
      "perform technical activities at power plants or individual installations",
    ],
    // And others found checking every career (npm run check:reasons).
    [
      "Plan, direct, or coordinate, usually through subordinate supervisory personnel, activities concerned with the construction and maintenance of structures, facilities, and systems.",
      null,
    ],
    [
      "Plan, direct, or coordinate the academic, administrative, or auxiliary activities of kindergarten, elementary, or secondary schools.",
      null,
    ],
    ["Record drugs delivered to the pharmacy, store incoming merchandise, and inform the supervisor of stock needs.", "record drugs delivered to the pharmacy"],
    ["Set up or repair rigging for construction projects, manufacturing plants, logging yards, ships and shipyards.", "set up or repair rigging"],
    [
      "Set up, operate, or tend grinding and related tools that remove excess material or burrs from surfaces, sharpen edges or corners.",
      "set up, operate, or tend grinding and related tools",
    ],
    [
      "Provide individuals, families, and groups with the psychosocial support needed to cope with chronic, acute, or terminal illnesses.",
      "provide individuals, families, and groups with the psychosocial support",
    ],
    ["Transport patients to areas such as operating rooms or x-ray rooms using wheelchairs, stretchers, or moveable beds.", "transport patients"],
    ["Perform any or all of the following functions in the manufacture of electronic semiconductors.", null],
    ["Create, modify, and test the code and scripts that allow computer applications to run.", "create, modify, and test the code and scripts that allow computer applications to run"],
    [
      "Apply engineering theory and principles to problems of industrial layout or manufacturing production, usually under the direction of engineering staff.",
      "apply engineering theory and principles",
    ],
    ["Directly supervise and coordinate activities of correctional officers and jailers.", "directly supervise and coordinate activities of correctional officers and jailers"],
  ])("%s", (description, clause) => {
    expect(careerClause(description)).toBe(clause);
  });

  it.each([
    // Shorter cuts, for reasons that are too long: never partway through a phrase or a list.
    ["Assess, plan, organize, and participate in rehabilitative programs that improve mobility, relieve pain.", 7, null],
    ["Direct and may participate in the preparation, seasoning, and cooking of salads, soups, fish, meats.", 13, null],
    ["Investigate and describe the determinants and distribution of disease, disability, or health outcomes.", 12, null],
    ["Perform duties related to the purchase, sale, or holding of securities.", 10, null],
    ["Inspect equipment or goods in connection with the safe transport of cargo or people.", 13, "inspect equipment or goods"],
    ["Post information enabling patrons to wager on various races and sporting events.", 11, null],
    ["Interview persons by telephone, mail, in person, or by other means for the purpose of completing forms.", 10, null],
    ["Feed materials into or remove materials from machines or equipment that is automatic or tended by other workers.", 9, null],
    ["Investigate atmospheric phenomena and interpret meteorological data, gathered by surface and air stations.", 6, null],
    ["Appraise, edit, and direct safekeeping of permanent records and historically valuable documents.", 10, null],
    ["Teach one or more subjects to students at the secondary school level.", 10, "teach one or more subjects"],
  ])("%s (at most %i words)", (description, max, clause) => {
    expect(careerClause(description, max)).toBe(clause);
  });

  it("always starts with what the worker does", () => {
    expect(careerClause("Using hand tools cut and shape wood into furniture.")).toBeNull();
    expect(careerClause("In the field, collect and label soil samples.")).toBe("collect and label soil samples");
    expect(careerClause("Manually plant, cultivate, and harvest vegetables, fruits, nuts, and field crops.")).toBe(
      "manually plant, cultivate, and harvest vegetables, fruits, nuts, and field crops",
    );
  });

  it("cuts a long one before a linking word, never mid-list or after 'any'", () => {
    const artists = "Create original artwork using any of a wide variety of media and techniques.";
    expect(careerClause(artists, 12)).toBe("create original artwork");
    expect(careerClause("Evaluate, authorize, or recommend approval of commercial, real estate, or credit loans.", 10)).toBe(
      "evaluate, authorize, or recommend approval",
    );
  });

  it("has nothing to say without a description", () => {
    expect(careerClause("")).toBeNull();
    expect(careerClause(null)).toBeNull();
    expect(careerClause("Operate.")).toBeNull();
    expect(longerClauses(null, 0)).toEqual([]);
  });

  it("gives longer clean cuts, shortest first, to set a career apart from another", () => {
    const fundraising = "Plan, direct, or coordinate activities to solicit and maintain funds for special projects or nonprofit organizations.";
    expect(careerClause(fundraising)).toBe("plan, direct, or coordinate activities");
    expect(longerClauses(fundraising, 5)).toEqual([
      "plan, direct, or coordinate activities to solicit and maintain funds",
      "plan, direct, or coordinate activities to solicit and maintain funds for special projects or nonprofit organizations",
    ]);
    // Never "…activities in such fields" without what the fields are.
    const scientists =
      "Plan, direct, or coordinate activities in such fields as life sciences, physical sciences, mathematics, statistics, and research and development in these fields.";
    expect(longerClauses(scientists, 5)[0]).toBe("plan, direct, or coordinate activities in such fields as life sciences");
    // Never "…where technical or scientific knowledge is" without "required".
    const sales =
      "Sell goods for wholesalers or manufacturers where technical or scientific knowledge is required in such areas as biology, engineering, chemistry, and electronics, normally obtained from at least 2 years of postsecondary education.";
    expect(longerClauses(sales, 6).length).toBeGreaterThan(0);
    for (const clause of longerClauses(sales, 0)) expect(clause).not.toMatch(/\b(is|required)$/);
  });
});

describe("template overview", () => {
  it("calls a tie a tie", () => {
    expect(templateExplanation(areas({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. Enterprising and Conventional are tied after them\./,
    );
    expect(templateExplanation(areas({ R: 30, I: 30, A: 20, S: 10, E: 5 }), [chemist]).overview).toMatch(
      /^Your strongest interest areas are Realistic, Investigative and Artistic\. Realistic and Investigative are tied\./,
    );
    expect(templateExplanation(areas({ A: 40, S: 30, R: 20, I: 20, E: 20, C: 20 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. The other four areas are tied\./,
    );
  });

  it("never names an area below 'Not sure' as one of the student's interests", () => {
    // One "Dislike" among the social activities: Social scored 1 of 40, so it isn't second.
    const e = templateExplanation(areas({ A: 40, S: 1 }), [teacher]);
    expect(e.overview).toMatch(/^Artistic stands out\. You leaned toward disliking the other five areas\./);
    expect(e.careers[0].why).toBe("Usually after a bachelor's degree, you could teach one or more subjects, using your interest in creating things.");
    expect(templateExplanation(areas({ A: 40, S: 30 }), [teacher]).overview).toMatch(
      /^Artistic and Social stand out\. You leaned toward disliking the other four areas\./,
    );
  });
});

describe("fit labels", () => {
  it("never calls a career a great or good fit for a flat profile", () => {
    // Every answer "Not sure": closeness scores run high for careers with middling profiles.
    const notSure = areas({ R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 });
    const middling = { code: "11-9151.00", title: "Managers", jobZone: 4, interests: profile({ R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }), values: {} };
    const { score } = scoreOccupation({ interests: notSure }, middling);
    expect(fitLabel(score)).toBe("Great fit");
    expect(fitLabel(score, { noLead: true })).toBe("Worth exploring");
    expect(fitLabel(90, { noLead: false })).toBe("Great fit");
    expect(fitLabel(75)).toBe("Good fit");
  });

  it("never calls a career a great fit when no area was liked, though its shape matches", () => {
    const clerk = { code: "43-4071.00", title: "File Clerks", jobZone: 2, interests: profile({ C: 7 }), values: {} };
    const { score } = scoreOccupation({ interests: areas({ C: 10 }) }, clerk);
    expect(score).toBe(100);
    expect(fitLabel(score, { noLead: true })).toBe("Worth exploring");
  });
});

describe("what the model is told about interests", () => {
  const facts = (scores: Partial<Record<Riasec, number>>) => {
    const pattern = interestPattern(areas(scores));
    if (pattern.kind === "flat" || pattern.kind === "low") throw new Error(pattern.kind);
    return interestFacts(pattern, areas(scores));
  };
  const names = (f: ReturnType<typeof facts>) => f.topInterests.map((t) => t.area);

  it("gives a clear code and its areas", () => {
    const f = facts({ A: 40, S: 30, E: 20 });
    expect(f).toMatchObject({ interestCode: "ASE" });
    expect(names(f)).toEqual(["Artistic", "Social", "Enterprising"]);
    expect(f.topInterests[0].meaning).toMatch(/^Making things that express ideas/);
    expect(f).not.toHaveProperty("tiedAreas");
  });

  it("says when areas in the code are tied", () => {
    const f = facts({ R: 30, I: 30, A: 20, S: 10, E: 5 });
    expect(f).toMatchObject({ interestCode: "RIA", tiedAreas: "Realistic and Investigative are tied, so their order doesn't matter." });
    expect(names(f)).toEqual(["Realistic", "Investigative", "Artistic"]);
  });

  it("gives only the areas that reached 'Not sure' as top interests, with no code, and says the rest were disliked", () => {
    // The scoring's code is "ARI": Realistic and Investigative fill it in RIASEC order at 0 of 40.
    const f = facts({ A: 40 });
    expect(f).not.toHaveProperty("interestCode");
    expect(f).not.toHaveProperty("tiedAreas");
    expect(names(f)).toEqual(["Artistic"]);
    expect(f).toMatchObject({
      otherAreas: "Realistic, Investigative, Social, Enterprising and Conventional are below the top interests, and the student leaned toward disliking them.",
    });

    // One "Dislike" among the social activities (1 of 40) doesn't make Social an interest, or the code "ASR".
    const barely = facts({ A: 40, S: 1 });
    expect(barely).not.toHaveProperty("interestCode");
    expect(names(barely)).toEqual(["Artistic"]);
    expect(barely).toEqual(f);
    expect(names(facts({ A: 40, S: 30, E: 19 }))).toEqual(["Artistic", "Social"]);
  });

  it("gives only the areas above a tie as top interests, and how the tied areas were rated", () => {
    const third = facts({ A: 40, S: 30, E: 20, C: 20, R: 10, I: 5 });
    expect(third).not.toHaveProperty("interestCode");
    expect(names(third)).toEqual(["Artistic", "Social"]);
    expect(third).toMatchObject({
      tiedAreas: "Enterprising and Conventional are tied below the top interests, and on average the student was not sure about them.",
    });

    // Liked areas kept out of the top by a tie are still liked.
    const liked = facts({ I: 40, A: 30, S: 30, E: 30 });
    expect(names(liked)).toEqual(["Investigative"]);
    expect(liked).toMatchObject({
      tiedAreas: "Artistic, Social and Enterprising are tied below the top interests, and the student leaned toward liking them.",
    });
  });

  it("gives every area tied for first as a top interest, and says they're tied", () => {
    const f = facts({ R: 30, I: 30, A: 30, S: 30, E: 10, C: 10 });
    expect(f).not.toHaveProperty("interestCode");
    expect(names(f)).toEqual(["Realistic", "Investigative", "Artistic", "Social"]);
    expect(f).toMatchObject({ tiedAreas: "Realistic, Investigative, Artistic and Social are tied for the top interest." });
  });
});

describe("what the model is told about strengths", () => {
  it("gives only the strengths that count, highest first, in the wording students see", () => {
    const facts = strengthFacts({ extraversion: 60, agreeableness: 50, conscientiousness: 20, neuroticism: 10, intellect: 70 });
    expect(facts).toEqual([
      "Curiosity: You love ideas, imagination, and big questions.",
      "Social energy: You enjoy people and also value time on your own, and you can adapt to both.",
    ]);
    // Warmth at the middle and organization below it aren't strengths that count, and staying calm
    // (here, very calm) is never sent.
    expect(facts.join(" ")).not.toMatch(/Warmth|Organization|Staying calm|steady/);
  });

  it("never gives a low trait as a strength", () => {
    // A direct, objective student who feels things deeply, with high curiosity and organization.
    const facts = strengthFacts({ extraversion: 6, agreeableness: 20, conscientiousness: 81, neuroticism: 75, intellect: 100 });
    expect(facts).toEqual(["Curiosity: You love ideas, imagination, and big questions.", "Organization: You like to plan ahead and get things done."]);
    expect(strengthFacts({ extraversion: 50, agreeableness: 50, conscientiousness: 50, neuroticism: 0, intellect: 50 })).toEqual([]);
  });
});

describe("stored explanations", () => {
  const old: MatchExplanation = { source: "ai", overview: "Written from the code's three letters.", careers: [] };
  const current: MatchExplanation = { ...old, factsVersion: EXPLANATION_FACTS_VERSION };
  const stored = (explanation: MatchExplanation | null, scores: Partial<Record<Riasec, number>>) =>
    storedExplanation(explanation, interestPattern(areas(scores)));

  it("keeps one written from older facts only for a clear code with no ties", () => {
    expect(stored(old, { A: 40, S: 30, E: 20 })).toBe(old);
    // A tie inside the code, a tie below the top, only one or two areas at "Not sure".
    for (const scores of [{ R: 30, I: 30, A: 20 }, { A: 40, S: 30, E: 20, C: 20 }, { A: 40, S: 1 }, { A: 40, S: 30 }]) {
      expect(stored(old, scores), JSON.stringify(scores)).toBeNull();
      expect(stored(current, scores), JSON.stringify(scores)).toBe(current);
    }
  });

  it("never keeps one when no area stands out", () => {
    expect(stored(current, { R: 20, I: 20, A: 20, S: 20, E: 20, C: 20 })).toBeNull();
    expect(stored(current, { C: 10 })).toBeNull();
    expect(stored(null, { A: 40, S: 30, E: 20 })).toBeNull();
  });
});

describe("explaining matches when areas are tied or none stands out", () => {
  let db: Db;
  let userId: string;
  const now = new Date("2026-09-23T12:00:00Z");

  beforeEach(async () => {
    db = await createTestDb();
    const occs: [string, string, number, Partial<Record<Riasec, number>>][] = [
      ["19-2031.00", "Chemists", 4, { I: 7, R: 4 }],
      ["25-2031.00", "Secondary School Teachers", 4, { S: 7, A: 3 }],
    ];
    await db.insert(schema.occupations).values(occs.map(([code, title, jobZone]) => ({ code, title, jobZone, description: "" })));
    await db.insert(schema.occupationInterests).values(
      occs.flatMap(([code, , , i]) =>
        (["R", "I", "A", "S", "E", "C"] as const).map((interest) => ({ occupationCode: code, interest, score: i[interest] ?? 1 })),
      ),
    );
    await loadOccupationProfiles(db, { fresh: true });
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      now,
    );
    if (!res.ok) throw new Error(res.error);
    userId = res.value.userId;
  });

  /** Finishes interests with one answer for every activity in an area (1, "Strongly dislike", if not given). */
  async function takeInterests(answers: Partial<Record<Riasec, number>>) {
    const start = await startOrResumeAttempt(db, userId, "interests", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(INTEREST_ITEMS.map((i) => [i.id, answers[i.area] ?? 1])));
    await completeAttempt(db, userId, start.attempt.id, now);
    await computeMatches(db, userId);
  }

  /** A fake model that records what it was asked and answers with `output`. */
  function recordingClient(output: unknown) {
    const requests: { messages: { content: string }[] }[] = [];
    const client = {
      beta: {
        messages: {
          create: async (params: { model: string; messages: { content: string }[] }) => {
            requests.push(params);
            return {
              model: params.model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(output) }],
              usage: { input_tokens: 800, output_tokens: 300 },
            };
          },
        },
      },
    } as never;
    return { client, requests };
  }

  const refusingClient = () =>
    ({
      beta: {
        messages: {
          create: async () => {
            throw new Error("the model should not be asked");
          },
        },
      },
    }) as never;

  it("uses the template without asking the model, which would be told the RIASEC-order code as top interests", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toContain("no area stands out");
    expect(await db.select().from(schema.aiUsage)).toHaveLength(0);
    // Not stored, like any template.
    expect((await latestMatchRun(db, userId))?.explanation).toBeNull();
  });

  it("uses the template when no area reached 'Not sure' on average", async () => {
    await takeInterests({ C: 2 });
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^You leaned toward disliking all six interest areas, so no area stands out yet\./);
    expect(await db.select().from(schema.aiUsage)).toHaveLength(0);
  });

  it("shows the template, not an explanation stored before this rule, when no area stands out", async () => {
    await takeInterests({ R: 3, I: 3, A: 3, S: 3, E: 3, C: 3 });
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "Your strongest interest areas are hands-on work and figuring things out.",
      careers: [{ code: "19-2031.00", why: "You love hands-on work." }],
    };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^You rated all six interest areas about the same/);
    expect(JSON.stringify(explanation)).not.toContain("hands-on work and figuring");
  });

  it("still returns a stored explanation for a clear code, without asking again", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    const run = await latestMatchRun(db, userId);
    // Stored before facts had a version: for a clear code with no ties, the facts are the same.
    const stored: MatchExplanation = { source: "ai", overview: "You like figuring things out.", careers: [] };
    await db.update(schema.matchRuns).set({ explanation: stored }).where(eq(schema.matchRuns.id, run!.id));
    expect(await explainLatestMatches(db, userId, { now, client: refusingClient() })).toEqual(stored);
  });

  it.each([
    ["areas tied below the top", { A: 5, S: 4, E: 4, C: 4 }],
    ["only two areas reaching 'Not sure'", { A: 5, S: 2 }],
    ["areas tied inside the code", { R: 5, I: 5, A: 4 }],
  ])("writes an explanation stored from older facts again for %s", async (_, answers: Partial<Record<Riasec, number>>) => {
    await takeInterests(answers);
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = {
      source: "ai",
      overview: "You love creating things, working with your hands and figuring things out.",
      careers: [{ code: "19-2031.00", why: "Chemists use the hands-on skills you enjoy." }],
    };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const { client, requests } = recordingClient({ overview: "You love making things.", careers: [] });
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(requests).toHaveLength(1);
    expect(explanation).toMatchObject({ source: "ai", overview: "You love making things.", factsVersion: EXPLANATION_FACTS_VERSION });
    expect(JSON.stringify(explanation)).not.toContain("hands-on skills");

    // Stored with the new version, so it isn't written a third time.
    expect((await latestMatchRun(db, userId))?.explanation).toMatchObject({ factsVersion: EXPLANATION_FACTS_VERSION });
    expect(await explainLatestMatches(db, userId, { now, client: refusingClient() })).toEqual(explanation);
  });

  it("uses the template for a stale explanation when the model can't write a new one", async () => {
    await takeInterests({ A: 5 });
    const run = await latestMatchRun(db, userId);
    const stale: MatchExplanation = { source: "ai", overview: "You love hands-on work and figuring things out.", careers: [] };
    await db.update(schema.matchRuns).set({ explanation: stale }).where(eq(schema.matchRuns.id, run!.id));
    const explanation = await explainLatestMatches(db, userId, { now, client: refusingClient() });
    expect(explanation?.source).toBe("template");
    expect(explanation?.overview).toMatch(/^Artistic stands out\. You leaned toward disliking the other five areas\./);
  });

  it("tells the model only the areas that reached 'Not sure', not the code's RIASEC-order picks", async () => {
    // "Strongly like" on every artistic activity, "Strongly dislike" on the rest: the code is "ARI".
    await takeInterests({ A: 5 });
    const { client, requests } = recordingClient({
      overview: "You love making things.",
      careers: [{ code: "25-2031.00", why: "Teachers make lessons come alive." }],
    });
    const explanation = await explainLatestMatches(db, userId, { now, client });
    expect(explanation?.source).toBe("ai");
    expect(requests).toHaveLength(1);
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts).not.toHaveProperty("tiedAreas");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Artistic"]);
    expect(facts.otherAreas).toBe(
      "Realistic, Investigative, Social, Enterprising and Conventional are below the top interests, and the student leaned toward disliking them.",
    );
    expect(facts.grade).toBe(10);
    expect(facts.careers.map((c: { code: string }) => c.code).sort()).toEqual(["19-2031.00", "25-2031.00"]);
  });

  it("never tells the model a disliked area is a top interest", async () => {
    // "Dislike" on every social activity (10 of 40): the code is "ASR", but Social isn't an interest.
    await takeInterests({ A: 5, S: 2 });
    const { client, requests } = recordingClient({ overview: "You love making things.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Artistic"]);
  });

  it("tells the model how areas tied below the top were rated", async () => {
    // "Strongly like" investigative activities and "Like" artistic, social and enterprising ones.
    await takeInterests({ I: 5, A: 4, S: 4, E: 4 });
    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts).not.toHaveProperty("interestCode");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Investigative"]);
    expect(facts.tiedAreas).toBe("Artistic, Social and Enterprising are tied below the top interests, and the student leaned toward liking them.");
  });

  it("never tells the model how the student handles stress", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    // "Very accurate" for every statement, "I get upset easily" and "I have frequent mood swings" too.
    const start = await startOrResumeAttempt(db, userId, "personality", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, Object.fromEntries(PERSONALITY_ITEMS.map((i) => [i.id, 5])));
    await completeAttempt(db, userId, start.attempt.id, now);

    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const content = requests[0].messages[0].content;
    const facts = JSON.parse(content.replace(/^[^\n]*\n/, ""));
    // Every trait lands at the middle of the scale, so no strength counts and none is sent.
    expect(facts).not.toHaveProperty("strengths");
    expect(content).not.toMatch(/Staying calm|stress|feel things deeply|bounce back/i);
  });

  it("tells the model only the strengths that count, and never calls a direct student warm", async () => {
    await takeInterests({ I: 5, A: 4, S: 4 });
    // Low warmth (P2, P12 "Very inaccurate"; P7, P17 "Very accurate"), feels things deeply (mood
    // swings and getting upset "Very accurate"), high curiosity and organization, quiet.
    const answers: Record<string, number> = {
      P1: 1, P6: 5, P11: 1, P16: 5,
      P2: 1, P7: 5, P12: 1, P17: 5,
      P3: 5, P8: 1, P13: 5, P18: 1,
      P4: 5, P9: 1, P14: 5, P19: 1,
      P5: 5, P10: 1, P15: 1, P20: 1,
    };
    const start = await startOrResumeAttempt(db, userId, "personality", now);
    if (!start.ok) throw new Error();
    await saveResponses(db, userId, start.attempt.id, answers);
    await completeAttempt(db, userId, start.attempt.id, now);
    await computeMatches(db, userId);

    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const request = requests[0] as unknown as { system: string; messages: { content: string }[] };
    const facts = JSON.parse(request.messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts.strengths).toEqual(["Organization: You like to plan ahead and get things done.", "Curiosity: You love ideas, imagination, and big questions."]);
    expect(request.messages[0].content).not.toMatch(/Warmth|direct and objective|Social energy|Staying calm|feel things deeply/);
    // And the model is told not to add any.
    expect(request.system).toContain(
      "Mention a personal strength only if it is listed under strengths, and never describe the student's calm, stress, mood or feelings.",
    );
  });

  it("still gives the model a clear code", async () => {
    await takeInterests({ I: 5, R: 4, A: 3 });
    const { client, requests } = recordingClient({ overview: "You like science.", careers: [] });
    await explainLatestMatches(db, userId, { now, client });
    const facts = JSON.parse(requests[0].messages[0].content.replace(/^[^\n]*\n/, ""));
    expect(facts.interestCode).toBe("IRA");
    expect(facts.topInterests.map((t: { area: string }) => t.area)).toEqual(["Investigative", "Realistic", "Artistic"]);
    expect(facts).not.toHaveProperty("tiedAreas");
  });
});
