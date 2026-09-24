import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { registerStudent } from "../accounts";
import { RIASEC, type Riasec } from "../assessments/instruments";
import { addNorthStar } from "../goals";
import {
  CIP_FAMILY_IDEAS,
  type IdeaCourse,
  MAX_IDEAS_PER_CAREER,
  RIASEC_IDEAS,
  type SuggestionCareer,
  courseSuggestions,
  ideasForCareer,
} from "./suggestions";

function career(over: Partial<SuggestionCareer> & { top?: Riasec[] } = {}): SuggestionCareer {
  const { top = ["I", "R"], ...rest } = over;
  return {
    code: "00-0000.00",
    title: "Some Career",
    pathway: "degree",
    majors: [],
    interests: RIASEC.map((area) => ({ area, score: top.includes(area) ? 7 - top.indexOf(area) : 0 })).sort((a, b) => b.score - a.score),
    ...rest,
  };
}

const titles = (s: { ideas: { title: string }[] }) => s.ideas.map((i) => i.title);

describe("ideasForCareer", () => {
  it("maps engineering majors to physics, math, chemistry, CS and engineering courses", () => {
    const s = ideasForCareer(career({ majors: [{ cipCode: "14.0801", title: "Civil Engineering, General" }] }), []);
    expect(s.basis).toBe("majors");
    expect(titles(s)).toEqual(["Physics", "Pre-calculus or calculus", "Chemistry", "Computer science", "Engineering or robotics (CTE)"]);
    expect(s.because).toBe("Connected to college majors like Civil Engineering, General.");
  });

  it("maps health and biology majors, with the most common family first", () => {
    const s = ideasForCareer(
      career({
        majors: [
          { cipCode: "26.0101", title: "Biology/Biological Sciences, General" },
          { cipCode: "51.3801", title: "Registered Nursing" },
          { cipCode: "51.0907", title: "Medical Radiologic Technology" },
        ],
      }),
      [],
    );
    expect(titles(s)).toEqual(["Biology", "Chemistry", "Anatomy and physiology", "Health science (CTE)", "Psychology", "Statistics"]);
    expect(s.because).toBe("Connected to college majors like Registered Nursing and Medical Radiologic Technology.");
  });

  it("covers arts, business and computer science families", () => {
    expect(titles(ideasForCareer(career({ majors: [{ cipCode: "50.0409", title: "Graphic Design" }] }), []))).toEqual([
      "Visual art", "Music (band, choir or orchestra)", "Theater or drama", "Digital media or graphic design",
    ]);
    expect(titles(ideasForCareer(career({ majors: [{ cipCode: "52.0301", title: "Accounting" }] }), []))).toContain("Accounting");
    expect(titles(ideasForCareer(career({ majors: [{ cipCode: "11.0701", title: "Computer Science" }] }), []))).toEqual([
      "Computer science", "AP Computer Science Principles or AP Computer Science A", "Pre-calculus or calculus", "Statistics",
      "Information technology or cybersecurity (CTE)",
    ]);
  });

  it("falls back to interest areas when no majors map to course ideas", () => {
    const s = ideasForCareer(career({ top: ["A", "S"], majors: [{ cipCode: "99.9999", title: "Unknown" }] }), []);
    expect(s.basis).toBe("interests");
    expect(s.because).toBe("Based on the Artistic and Social interests this career uses.");
    expect(titles(s).slice(0, 5)).toEqual(["Visual art", "Music (band, choir or orchestra)", "Theater or drama", "Creative writing", "Digital media or graphic design"]);
    expect(s.ideas).toHaveLength(MAX_IDEAS_PER_CAREER);
  });

  it("leads with a CTE pathway for career-training paths", () => {
    const s = ideasForCareer(career({ pathway: "training", majors: [{ cipCode: "48.0508", title: "Welding Technology/Welder" }] }), []);
    expect(titles(s)).toEqual(["A career and technical (CTE) pathway", "Manufacturing or welding (CTE)", "Geometry", "Engineering or robotics (CTE)"]);
    expect(s.because).toBe("Connected to training programs like Welding Technology/Welder.");
  });

  it("tops up thin family lists from interests", () => {
    const s = ideasForCareer(career({ top: ["E"], majors: [{ cipCode: "10.0304", title: "Animation" }] }), []);
    expect(s.basis).toBe("majors");
    expect(titles(s)).toEqual([
      "Digital media or graphic design", "Computer science", "Journalism or yearbook", "Business or marketing (CTE)", "Economics", "Speech and debate",
    ]);
  });

  it("marks ideas already in the plan by name or subject, ignoring case", () => {
    const courses: IdeaCourse[] = [
      { name: "AP PHYSICS 1", subject: "science", level: "ap" },
      { name: "precalculus", subject: "math", level: "honors" },
      { name: "Intro to Java", subject: "computer_science", level: "regular" },
    ];
    const s = ideasForCareer(career({ majors: [{ cipCode: "14.0901", title: "Computer Engineering, General" }] }), courses);
    expect(Object.fromEntries(s.ideas.map((i) => [i.id, i.inPlan]))).toEqual({
      physics: true,
      precalc_calc: true,
      chemistry: false,
      computer_science: true,
      engineering_cte: false,
    });
  });

  it("recognizes AP computer science by level or name, and world languages by name", () => {
    const cs = career({ majors: [{ cipCode: "11.0701", title: "Computer Science" }] });
    const ap = ideasForCareer(cs, [{ name: "Computer Science", subject: "computer_science", level: "ap" }]);
    expect(ap.ideas.find((i) => i.id === "ap_cs")?.inPlan).toBe(true);
    const named = ideasForCareer(cs, [{ name: "AP CS Principles", subject: "other", level: "regular" }]);
    expect(named.ideas.find((i) => i.id === "ap_cs")?.inPlan).toBe(true);
    const plain = ideasForCareer(cs, [{ name: "Robotics", subject: "career_technical", level: "regular" }]);
    expect(plain.ideas.find((i) => i.id === "ap_cs")?.inPlan).toBe(false);

    const lang = ideasForCareer(career({ majors: [{ cipCode: "16.0905", title: "Spanish Language and Literature" }] }), [
      { name: "Spanish II", subject: "other", level: "regular" },
    ]);
    expect(lang.ideas.find((i) => i.id === "world_language")?.inPlan).toBe(true);
  });

  it("only references ideas that exist", () => {
    for (const [family, ids] of Object.entries(CIP_FAMILY_IDEAS)) {
      const s = ideasForCareer(career({ majors: [{ cipCode: `${family}.0101`, title: "Major" }] }), []);
      expect(s.ideas.slice(0, ids.length).map((i) => i.id), family).toEqual(ids.slice(0, MAX_IDEAS_PER_CAREER));
    }
    for (const area of RIASEC) {
      const s = ideasForCareer(career({ top: [area] }), []);
      expect(s.ideas.map((i) => i.id), area).toEqual(RIASEC_IDEAS[area].slice(0, MAX_IDEAS_PER_CAREER));
    }
  });

  it("handles a career with no majors or interest scores", () => {
    const s = ideasForCareer(career({ top: [] }), []);
    expect(s).toMatchObject({ basis: "interests", ideas: [], because: "General ideas to explore while you learn more about this career." });
  });
});

describe("courseSuggestions", () => {
  it("suggests courses for each north star and skips careers missing from reference data", async () => {
    const db = await createTestDb();
    const res = await registerStudent(
      db,
      { displayName: "Ana", email: "ana@example.com", password: "correct horse battery", birthDate: "2011-01-15", grade: 10 },
      new Date("2026-09-23T12:00:00Z"),
    );
    if (!res.ok) throw new Error(res.error);
    const userId = res.value.userId;

    await db.insert(schema.occupations).values([
      { code: "17-2051.00", title: "Civil Engineers", description: "Design things.", jobZone: 4 },
      { code: "27-1024.00", title: "Graphic Designers", description: "Design things.", jobZone: 4 },
    ]);
    await db.insert(schema.occupationInterests).values([
      { occupationCode: "17-2051.00", interest: "R", score: 6 },
      { occupationCode: "27-1024.00", interest: "A", score: 7 },
    ]);
    await db.insert(schema.majors).values([{ cipCode: "14.0801", title: "Civil Engineering, General" }]);
    await db.insert(schema.cipSocLinks).values([{ cipCode: "14.0801", socCode: "17-2051" }]);

    expect(await courseSuggestions(db, userId, [])).toEqual([]);

    await addNorthStar(db, userId, "17-2051.00");
    await addNorthStar(db, userId, "27-1024.00");
    const suggestions = await courseSuggestions(db, userId, [{ name: "Physics", subject: "science", level: "regular" }]);
    expect(suggestions.map((s) => [s.title, s.basis])).toEqual([
      ["Civil Engineers", "majors"],
      ["Graphic Designers", "interests"],
    ]);
    expect(suggestions[0].ideas.find((i) => i.id === "physics")?.inPlan).toBe(true);
    expect(suggestions[1].ideas[0].title).toBe("Visual art");

    // Reloading reference data can drop an occupation; the student's goal stays but is skipped here.
    await db.delete(schema.occupations).where(eq(schema.occupations.code, "27-1024.00"));
    expect((await courseSuggestions(db, userId, [])).map((s) => s.title)).toEqual(["Civil Engineers"]);
  });
});
