import { defaultHighSchoolCredit, defaultStatusFor, gradeName } from "@/lib/courses/catalog";
import { type GpaSummary, formatGpa } from "@/lib/courses/gpa";
import { emptyText, focusGrade, gradeOrder, whenLabel } from "@/lib/courses/plan-layout";
import { AddCourse } from "./add-course";
import type { PlanCourse } from "./course-row";
import { GradeCourses } from "./grade-courses";

function GradeSection({
  grade,
  current,
  courses,
  gpa,
}: {
  grade: number;
  /** The student's grade today; above 12 once they've graduated. */
  current: number;
  courses: PlanCourse[];
  gpa: GpaSummary["byGrade"][number] | undefined;
}) {
  const titleId = `grade-${grade}-title`;
  const gradeGpa = formatGpa(gpa?.unweighted ?? null);
  return (
    <section aria-labelledby={titleId}>
      <details open={grade === focusGrade(current)} className="group rounded-xl border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <h2 className="text-lg font-medium">
            <span id={titleId}>{gradeName(grade)}</span>
            <span className="block text-sm font-normal text-muted">
              {whenLabel(grade, current)} · {courses.length} {courses.length === 1 ? "course" : "courses"}
              {gradeGpa && <> · est. GPA {gradeGpa}</>}
            </span>
          </h2>
          <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          {grade <= 8 && (
            <p className="text-sm text-muted">
              Most middle school classes don&apos;t count toward your high school GPA. If one earns high school credit
              (like Algebra I), check that box when you add it.
            </p>
          )}
          <GradeCourses courses={courses} emptyText={emptyText(grade, current)} />
          <AddCourse
            gradeLevel={grade}
            defaultStatus={defaultStatusFor(grade, current)}
            defaultHighSchoolCredit={defaultHighSchoolCredit(grade)}
            startOpen={grade === current && courses.length === 0}
          />
        </div>
      </details>
    </section>
  );
}

/**
 * One section per grade, 7–12. The student's current grade comes first and open (senior year
 * for a graduate), then the years ahead, then earlier years.
 */
export function GradeSections({ current, courses, gpa }: { current: number; courses: PlanCourse[]; gpa: GpaSummary }) {
  return (
    <div className="space-y-3">
      {gradeOrder(current).map((grade) => (
        <GradeSection
          key={grade}
          grade={grade}
          current={current}
          courses={courses.filter((c) => c.gradeLevel === grade)}
          gpa={gpa.byGrade.find((g) => g.gradeLevel === grade)}
        />
      ))}
    </div>
  );
}
