import { type FunctionComponent, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { collegePrepChecklist } from "@/lib/courses/checklist";
import { computeGpa } from "@/lib/courses/gpa";
import { ideasForCareer } from "@/lib/courses/suggestions";
import { AddCourse } from "./add-course";
import { ChecklistCard, GpaCard, SuggestionsCard } from "./cards";
import { type CourseDefaults, CourseFields } from "./course-fields";
import { CourseRow, type PlanCourse } from "./course-row";

// Server-rendered smoke tests for the planner UI (vitest runs in node, without a DOM).

const course: PlanCourse = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "AP Biology",
  subject: "science",
  level: "ap",
  gradeLevel: 10,
  term: "full_year",
  credits: 1,
  status: "completed",
  finalGrade: "A-",
  highSchoolCredit: true,
};

const defaults: CourseDefaults = {
  name: "",
  subject: "",
  level: "regular",
  gradeLevel: 10,
  term: "full_year",
  credits: 1,
  status: "planned",
  finalGrade: "",
  highSchoolCredit: true,
};

function render<P extends object>(component: FunctionComponent<P>, props: P) {
  return renderToStaticMarkup(createElement(component, props));
}
const fields = (over: Partial<Parameters<typeof CourseFields>[0]>) =>
  render(CourseFields, { values: {}, errors: undefined, defaults, ...over });

describe("course row", () => {
  it("shows level, subject, term, credits, status and grade, with labeled actions", () => {
    const html = render(CourseRow, { course });
    for (const text of ["AP Biology", ">AP<", "Science", "Full year", "1 credit", "Finished", "<strong>A-</strong>"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Edit<span class="sr-only"> AP Biology</span>');
    expect(html).toContain('Remove<span class="sr-only"> AP Biology</span>');
  });

  it("notes middle school classes that earn high school credit", () => {
    expect(render(CourseRow, { course: { ...course, gradeLevel: 8 } })).toContain("Counts for high school credit");
    expect(render(CourseRow, { course: { ...course, highSchoolCredit: false } })).toContain("Doesn&#x27;t count for high school credit");
  });
});

describe("course fields", () => {
  it("labels every control and asks for a final grade only on finished courses", () => {
    const planned = fields({});
    expect(planned).not.toContain('name="finalGrade"');
    const finished = fields({ defaults: { ...defaults, status: "completed" } });
    expect(finished).toContain('name="finalGrade"');
    for (const id of ["name", "subject", "level", "term", "credits", "finalGrade"]) {
      const match = finished.match(new RegExp(`<label for="([^"]+-${id})"`));
      expect(match, id).not.toBeNull();
      expect(finished).toContain(`id="${match?.[1]}"`);
    }
    expect(finished).toContain("<legend");
  });

  it("defaults the high school credit box from the grade", () => {
    expect(fields({})).toMatch(/name="highSchoolCredit" checked=""/);
    expect(fields({ defaults: { ...defaults, gradeLevel: 8, highSchoolCredit: false } })).not.toMatch(/name="highSchoolCredit" checked/);
  });

  it("restores submitted values and shows errors after a failed save", () => {
    const html = fields({
      values: { name: "Chem", subject: "science", status: "in_progress", gradeLevel: "10", credits: "0.5", finalGrade: "A" },
      errors: { finalGrade: ["Only finished courses get a final grade."] },
    });
    expect(html).toContain('value="Chem"');
    expect(html).toMatch(/<option value="science" selected="">/);
    expect(html).toMatch(/<option value="0.5" selected="">/);
    expect(html).toMatch(/checked="" value="in_progress"/);
    expect(html).not.toMatch(/name="highSchoolCredit" checked/);
    expect(html).toContain("Only finished courses get a final grade.");
  });

  it("lets the edit form move a course to another grade", () => {
    expect(fields({ editGradeLevel: true })).toContain('<select id="');
    expect(fields({ editGradeLevel: true })).toMatch(/name="gradeLevel"[^>]*>.*12th grade/);
    expect(fields({})).toContain('type="hidden" name="gradeLevel" value="10"');
  });
});

describe("add course", () => {
  it("starts as a button unless it's the student's empty current grade", () => {
    expect(render(AddCourse, { gradeLevel: 9, defaultStatus: "planned", defaultHighSchoolCredit: true })).toContain(
      "+ Add a course to 9th grade",
    );
    const open = render(AddCourse, { gradeLevel: 8, defaultStatus: "in_progress", defaultHighSchoolCredit: false, startOpen: true });
    expect(open).toContain("<form");
    expect(open).toContain('role="status"');
    expect(open).toContain("Most middle school classes don&#x27;t, but some do");
  });
});

describe("cards", () => {
  it("labels the GPA as an estimate and points to the transcript", () => {
    const html = render(GpaCard, {
      gpa: computeGpa([course, { ...course, gradeLevel: 9, level: "regular", finalGrade: "B" }]),
      middleSchool: false,
    });
    expect(html).toContain("Your GPA (estimate)");
    expect(html).toContain(">3.35<");
    expect(html).toContain(">3.85<");
    expect(html).toContain("Schools calculate GPA differently");
    expect(html).toContain("Your transcript shows your official GPA.");
    expect(html).toContain("<caption");
  });

  it("encourages middle schoolers without showing an empty GPA", () => {
    const html = render(GpaCard, { gpa: computeGpa([]), middleSchool: true });
    expect(html).toContain("Your high school GPA usually starts in 9th grade");
    expect(html).not.toContain("credits earned");
  });

  it("frames the checklist as what many colleges look for, never as requirements", () => {
    const html = render(ChecklistCard, { checklist: collegePrepChecklist([course]), middleSchool: true });
    expect(html).toContain("Many four-year colleges look for about:");
    expect(html).toContain("Requirements vary by college and by state");
    expect(html).toContain("counselor");
    expect(html).toContain("industry certifications");
    expect(html).toContain("You don&#x27;t need to have this figured out yet");
    expect(html).toContain("Room to add");
    expect(html).not.toMatch(/\b(required|missing|behind|failing)\b/i);
  });

  it("marks suggested classes already in the plan", () => {
    const suggestion = ideasForCareer(
      { code: "29-1141.00", title: "Registered Nurses", pathway: "degree", interests: [], majors: [{ cipCode: "51.3801", title: "Nursing" }] },
      [course],
    );
    const html = render(SuggestionsCard, { suggestions: [suggestion] });
    expect(html).toContain('href="/careers/29-1141.00"');
    expect(html).toMatch(/Biology<\/span><span[^>]*><span aria-hidden="true">✓ <\/span>In your plan/);
    expect(html).toContain("Ask your school counselor");
    expect(render(SuggestionsCard, { suggestions: [] })).toContain("Pick a north star career");
  });
});
