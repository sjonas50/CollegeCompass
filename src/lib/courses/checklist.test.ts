import { describe, expect, it } from "vitest";
import { type ChecklistCourse, COLLEGE_PREP_AREAS, collegePrepChecklist } from "./checklist";

const course = (over: Partial<ChecklistCourse>): ChecklistCourse => ({
  name: "Course",
  subject: "english",
  credits: 1,
  status: "completed",
  finalGrade: null,
  highSchoolCredit: true,
  ...over,
});

const item = (courses: ChecklistCourse[], subject: string) => {
  const found = collegePrepChecklist(courses).items.find((i) => i.subject === subject);
  if (!found) throw new Error(subject);
  return found;
};

describe("collegePrepChecklist", () => {
  it("covers the usual college-prep areas", () => {
    expect(COLLEGE_PREP_AREAS.map((a) => [a.subject, a.years, a.recommendedYears])).toEqual([
      ["english", 4, undefined],
      ["math", 3, 4],
      ["science", 3, undefined],
      ["social_studies", 3, undefined],
      ["world_language", 2, 3],
      ["arts", 1, undefined],
    ]);
  });

  it("starts with room to add everywhere", () => {
    const list = collegePrepChecklist([]);
    expect(list.items.every((i) => i.status === "room_to_add" && i.doneOrInProgress === 0 && i.planned === 0)).toBe(true);
    expect(list.algebra2).toBe("not_yet");
    expect(list.cte).toEqual({ doneOrInProgress: 0, planned: 0 });
  });

  it("separates finished and in-progress courses from planned ones", () => {
    const english = item(
      [
        course({ name: "English 9", status: "completed", finalGrade: "B" }),
        course({ name: "English 10", status: "in_progress" }),
        course({ name: "English 11", status: "planned" }),
        course({ name: "Journalism", status: "planned", credits: 0.5 }),
      ],
      "english",
    );
    expect(english).toMatchObject({ doneOrInProgress: 2, planned: 1.5, status: "room_to_add" });
  });

  it("marks areas covered, or on track when the plan reaches them", () => {
    const arts = item([course({ subject: "arts", status: "in_progress" })], "arts");
    expect(arts.status).toBe("covered");
    const language = item(
      [course({ subject: "world_language", status: "completed", finalGrade: "A" }), course({ subject: "world_language", status: "planned" })],
      "world_language",
    );
    expect(language.status).toBe("on_track");
  });

  it("only counts high school credit, and not failed, withdrawn or incomplete courses", () => {
    const math = item(
      [
        course({ subject: "math", name: "Math 7", highSchoolCredit: false }),
        course({ subject: "math", name: "Algebra I", highSchoolCredit: true, finalGrade: "A" }),
        course({ subject: "math", name: "Geometry", finalGrade: "F" }),
        course({ subject: "math", name: "Geometry", finalGrade: "W" }),
        course({ subject: "math", name: "Geometry", finalGrade: "I" }),
        course({ subject: "math", name: "Geometry", finalGrade: "P" }),
        course({ subject: "math", name: "Stats", status: "planned", highSchoolCredit: false }),
      ],
      "math",
    );
    expect(math).toMatchObject({ doneOrInProgress: 2, planned: 0 });
  });

  it("tracks Algebra II or a class that comes after it", () => {
    const math = (name: string, status: ChecklistCourse["status"] = "in_progress") => [course({ subject: "math", name, status })];
    expect(collegePrepChecklist(math("Algebra II")).algebra2).toBe("done_or_in_progress");
    expect(collegePrepChecklist(math("Algebra 2 Honors")).algebra2).toBe("done_or_in_progress");
    expect(collegePrepChecklist(math("Integrated Math III")).algebra2).toBe("done_or_in_progress");
    expect(collegePrepChecklist(math("AP Calculus AB", "planned")).algebra2).toBe("planned");
    expect(collegePrepChecklist(math("Pre-Calculus", "planned")).algebra2).toBe("planned");
    expect(collegePrepChecklist(math("Algebra I")).algebra2).toBe("not_yet");
    expect(collegePrepChecklist(math("Geometry")).algebra2).toBe("not_yet");
  });

  it("counts CTE credits separately", () => {
    const list = collegePrepChecklist([
      course({ subject: "career_technical", name: "Welding I", status: "completed", finalGrade: "A" }),
      course({ subject: "career_technical", name: "Welding II", status: "planned", credits: 2 }),
    ]);
    expect(list.cte).toEqual({ doneOrInProgress: 1, planned: 2 });
  });
});
