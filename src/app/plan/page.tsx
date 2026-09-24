import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import { collegePrepChecklist } from "@/lib/courses/checklist";
import { computeGpa } from "@/lib/courses/gpa";
import { isGraduated } from "@/lib/courses/plan-layout";
import { listCourses } from "@/lib/courses/service";
import { courseSuggestions } from "@/lib/courses/suggestions";
import { ChecklistCard, GpaCard, SuggestionsCard } from "./cards";
import type { PlanCourse } from "./course-row";
import { GradeSections } from "./grade-section";

export const metadata: Metadata = { title: "Your course plan" };

const LEAD = {
  explore:
    "Middle school is a great time to explore. Add the classes you're taking now, and sketch out a few ideas for high school if you like — plans can change anytime.",
  build: "Keep track of your classes, see your estimated GPA, and plan classes that fit where you're headed.",
  launch: "Keep your classes and grades in one place, and make sure your last years of high school line up with your plans.",
  graduated:
    "Congratulations on finishing high school! Your classes and grades stay here, handy for college, scholarship or job applications.",
} as const;

export default async function PlanPage() {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const db = await getDb();
  // The student's grade today. Above 12 means they've graduated: senior year still shows first,
  // but it's "last year", and classes added to it default to finished.
  const current = student.grade ?? 9;
  const graduated = isGraduated(current);
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
      <PageHeading title="Your course plan" lead={graduated ? LEAD.graduated : LEAD[band]} />

      {courses.length === 0 && (
        <section aria-labelledby="why-track" className="rounded-xl bg-accent-soft p-5">
          <h2 id="why-track" className="font-medium">
            Why keep track of your classes?
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>See how your classes line up with what colleges and training programs look for.</li>
            <li>Get an estimate of your GPA as you finish classes.</li>
            <li>Get class ideas that connect to careers you&apos;re curious about.</li>
            {!graduated && <li>Pick next year&apos;s classes with a plan, not a guess.</li>}
          </ul>
          <p className="mt-3 text-sm">
            {graduated
              ? "Start with your senior year. Add the classes you finished to see your GPA estimate."
              : middleSchool
                ? "Start with the classes you're taking now. No pressure to plan everything — a little planning ahead just makes choosing 9th-grade classes easier."
                : "Start with the classes you're taking this year. It only takes a few minutes."}
          </p>
        </section>
      )}

      {!middleSchool && gpaCard}

      <GradeSections current={current} courses={planCourses} gpa={gpa} />

      <ChecklistCard checklist={checklist} middleSchool={middleSchool} />
      <SuggestionsCard suggestions={suggestions} />
      {middleSchool && gpaCard}

      <p className="text-sm">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
