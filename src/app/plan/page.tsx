import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { MAX_GRADE, MIN_GRADE, gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import { COURSE_GRADE_LEVELS, defaultHighSchoolCredit, defaultStatusFor, gradeName } from "@/lib/courses/catalog";
import { collegePrepChecklist } from "@/lib/courses/checklist";
import { type GpaSummary, computeGpa, formatGpa } from "@/lib/courses/gpa";
import { listCourses } from "@/lib/courses/service";
import { courseSuggestions } from "@/lib/courses/suggestions";
import { AddCourse } from "./add-course";
import { ChecklistCard, GpaCard, SuggestionsCard } from "./cards";
import { CourseRow, type PlanCourse } from "./course-row";

export const metadata: Metadata = { title: "Your course plan" };

const LEAD = {
  explore:
    "Middle school is a great time to explore. Add the classes you're taking now, and sketch out a few ideas for high school if you like — plans can change anytime.",
  build: "Keep track of your classes, see your estimated GPA, and plan classes that fit where you're headed.",
  launch: "Keep your classes and grades in one place, and make sure your last years of high school line up with your plans.",
} as const;

/** Current grade first, then the years ahead, then earlier years (most recent first). */
function gradeOrder(current: number) {
  const later = COURSE_GRADE_LEVELS.filter((g) => g > current);
  const earlier = COURSE_GRADE_LEVELS.filter((g) => g < current).reverse();
  return [current, ...later, ...earlier];
}

function whenLabel(grade: number, current: number) {
  const diff = grade - current;
  if (diff === 0) return "This year";
  if (diff === 1) return "Next year";
  if (diff === -1) return "Last year";
  return diff > 0 ? `In ${diff} years` : `${-diff} years ago`;
}

function emptyText(grade: number, current: number) {
  if (grade === current) return "What are you taking this year? Add your classes to see how they fit your goals.";
  if (grade > current) return "Thinking ahead? Add classes you might take. It's just a plan — you can change it anytime.";
  if (grade <= 8) return "Took a class for high school credit, like Algebra I or a world language? You can add it here.";
  return "Add classes you finished to include their grades in your GPA estimate.";
}

function GradeSection({
  grade,
  current,
  courses,
  gpa,
}: {
  grade: number;
  current: number;
  courses: PlanCourse[];
  gpa: GpaSummary["byGrade"][number] | undefined;
}) {
  const titleId = `grade-${grade}-title`;
  const gradeGpa = formatGpa(gpa?.unweighted ?? null);
  return (
    <section aria-labelledby={titleId}>
      <details open={grade === current} className="group rounded-xl border border-border bg-surface">
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
          {courses.length ? (
            <ul className="space-y-3">
              {courses.map((c) => (
                <CourseRow key={c.id} course={c} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">{emptyText(grade, current)}</p>
          )}
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

export default async function PlanPage() {
  const student = await requireUser(["student"]);
  const db = await getDb();
  // Grades above 12 mean the student has graduated; keep showing their senior year first.
  const current = Math.min(MAX_GRADE, Math.max(MIN_GRADE, student.grade ?? 9));
  const band = gradeBand(current);
  const middleSchool = band === "explore";

  const courses = await listCourses(db, student.id);
  const suggestions = await courseSuggestions(db, student.id, courses);
  const gpa = computeGpa(courses);
  const checklist = collegePrepChecklist(courses);
  const planCourses: PlanCourse[] = courses.map(
    ({ id, name, subject, level, gradeLevel, term, credits, status, finalGrade, highSchoolCredit }) => ({
      id, name, subject, level, gradeLevel, term, credits, status, finalGrade, highSchoolCredit,
    }),
  );

  const gpaCard = <GpaCard gpa={gpa} middleSchool={middleSchool} />;
  return (
    <div className="space-y-8">
      <PageHeading title="Your course plan" lead={LEAD[band]} />

      {courses.length === 0 && (
        <section aria-labelledby="why-track" className="rounded-xl bg-accent-soft p-5">
          <h2 id="why-track" className="font-medium">
            Why keep track of your classes?
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>See how your classes line up with what colleges and training programs look for.</li>
            <li>Get an estimate of your GPA as you finish classes.</li>
            <li>Get class ideas that connect to careers you&apos;re curious about.</li>
            <li>Pick next year&apos;s classes with a plan, not a guess.</li>
          </ul>
          <p className="mt-3 text-sm">
            {middleSchool
              ? "Start with the classes you're taking now. No pressure to plan everything — a little planning ahead just makes choosing 9th-grade classes easier."
              : "Start with the classes you're taking this year. It only takes a few minutes."}
          </p>
        </section>
      )}

      {!middleSchool && gpaCard}

      <div className="space-y-3">
        {gradeOrder(current).map((grade) => (
          <GradeSection
            key={grade}
            grade={grade}
            current={current}
            courses={planCourses.filter((c) => c.gradeLevel === grade)}
            gpa={gpa.byGrade.find((g) => g.gradeLevel === grade)}
          />
        ))}
      </div>

      <ChecklistCard checklist={checklist} middleSchool={middleSchool} />
      <SuggestionsCard suggestions={suggestions} />
      {middleSchool && gpaCard}

      <p className="text-sm">
        <Link href="/dashboard" className="underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
