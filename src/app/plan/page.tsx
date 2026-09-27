import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import { stateName } from "@/lib/colleges/states";
import { collegePrepChecklist } from "@/lib/courses/checklist";
import { computeGpa } from "@/lib/courses/gpa";
import { isGraduated } from "@/lib/courses/plan-layout";
import { listCourses } from "@/lib/courses/service";
import { courseSuggestions } from "@/lib/courses/suggestions";
import { plannerPathEnabled } from "@/lib/planner/beta";
import { isPlannerState } from "@/lib/planner/common";
import { comingLaterNote } from "@/lib/planner/copy";
import { studentPath } from "@/lib/planner/service";
import { stateTitle } from "@/lib/planner/view";
import { ChecklistCard, GpaCard, SuggestionsCard } from "./cards";
import type { PlanCourse } from "./course-row";
import { GradeSections } from "./grade-section";
import { PathAnnouncer } from "./path/announcer";
import { PathView } from "./path/path-view";
import { PlannerStateProvider } from "./planner-state";

export const metadata: Metadata = { title: "Your course plan" };

const LEAD = {
  explore:
    "Middle school is a great time to explore. Add the classes you're taking now, and sketch out a few ideas for high school if you like — plans can change anytime.",
  build: "Keep track of your classes, see your estimated GPA, and plan classes that fit where you're headed.",
  launch: "Keep your classes and grades in one place, and make sure your last years of high school line up with your plans.",
  graduated:
    "Congratulations on finishing high school! Your classes and grades stay here, handy for college, scholarship or job applications.",
} as const;

/** Outside Utah, Tennessee and Texas (or no state yet): today's checklist, plus what's coming. */
function ComingLater({ homeState }: { homeState: string | null }) {
  const name = stateName(homeState);
  return (
    <Card>
      <h2 id="path-heading" tabIndex={-1} className="text-lg font-medium focus:outline-none">
        Your path
      </h2>
      {name ? (
        <p className="mt-1 text-sm">{comingLaterNote(name)}</p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            Add your state to see a year-by-year class path built from your state&apos;s graduation rules (Utah, Tennessee
            and Texas for now). Everywhere else, you&apos;ll see a general college-prep checklist.
          </p>
          <div className="mt-3">
            <ButtonLink href="/dashboard?school=edit#school-settings" variant="secondary">
              Add my state and school
            </ButtonLink>
          </div>
        </>
      )}
    </Card>
  );
}

export default async function PlanPage({ searchParams }: PageProps<"/plan">) {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const db = await getDb();
  const { plan: planParam } = await searchParams;
  // The student's grade today. Above 12 means they've graduated: senior year still shows first,
  // but it's "last year", and classes added to it default to finished.
  const current = student.grade ?? 9;
  const graduated = isGraduated(current);
  const band = gradeBand(current);
  const middleSchool = band === "explore";

  // "Your path" is in beta (lib/planner/beta.ts): everyone else keeps the checklist and course ideas.
  const pathOn = await plannerPathEnabled(db, student.id);
  const path = pathOn ? await studentPath(db, student.id) : null;
  const courses = path && path.kind !== "no_grade" ? path.ctx.courses : await listCourses(db, student.id);
  const planned = path?.kind === "planned" ? path : null;
  const gpa = computeGpa(courses);
  // Utah, Tennessee and Texas get "Your path", which covers the checklist and course ideas; other
  // states keep them (and see what's coming).
  const suggestions = planned ? [] : await courseSuggestions(db, student.id, courses);
  const checklist = collegePrepChecklist(courses);
  const planCourses: PlanCourse[] = courses.map(
    ({ id, name, subject, level, gradeLevel, term, credits, status, finalGrade, highSchoolCredit, courseTypeId }) => ({
      id, name, subject, level, gradeLevel, term, credits, status, finalGrade, highSchoolCredit, courseTypeId,
    }),
  );
  // Utah, Tennessee and Texas name some kinds of class their own way ("Secondary Mathematics III").
  const plannerState = isPlannerState(student.homeState) ? student.homeState : null;
  const planId = planParam === "B" ? "B" : "A";

  const gpaCard = <GpaCard gpa={gpa} middleSchool={middleSchool} />;
  return (
    <div className="space-y-8">
      <PageHeading title="Your course plan" lead={graduated ? LEAD.graduated : LEAD[band]} />

      {planned && (
        <nav aria-label="On this page" className="-mt-4 flex flex-wrap gap-x-4 text-sm print:hidden">
          <a href="#path" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Your path
          </a>
          <a href="#classes" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Your classes by grade
          </a>
        </nav>
      )}

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

      {planned && (
        <section id="path" aria-labelledby="path-heading" className="scroll-mt-4 space-y-2">
          <h2 id="path-heading" tabIndex={-1} className="text-2xl font-semibold tracking-tight focus:outline-none">
            Your path
          </h2>
          <p className="text-sm text-muted">
            {planned.result.stage === "middle_school"
              ? `A first look at high school in ${stateTitle(planned.result.state)}: math, classes to explore and what 9th grade often looks like.`
              : `A year-by-year draft for ${stateTitle(planned.result.state)}, built from your classes, your goals and your state's rules.`}
          </p>
          <div className="pt-2">
            <PathView
              path={planned.result}
              ctx={planned.ctx}
              mode="student"
              planId={planId}
              planHref={(id) => (id === "A" ? "/plan#path-plan" : "/plan?plan=B#path-plan")}
              printHref={`/plan/print${planId === "B" ? "?plan=B" : ""}`}
            />
          </div>
          <PathAnnouncer />
        </section>
      )}

      {pathOn && !planned && !graduated && (
        <div id="path" className="scroll-mt-4">
          <ComingLater homeState={path?.kind === "no_state" ? path.ctx.homeState : student.homeState ?? null} />
        </div>
      )}

      <section id="classes" aria-labelledby="classes-heading" className="scroll-mt-4 space-y-3">
        {planned && (
          <div>
            <h2 id="classes-heading" className="text-2xl font-semibold tracking-tight">
              Your classes by grade
            </h2>
            <p className="text-sm text-muted">Add, edit or remove classes here. Your path updates as you do.</p>
          </div>
        )}
        {!planned && (
          <h2 id="classes-heading" className="sr-only">
            Your classes by grade
          </h2>
        )}
        <PlannerStateProvider state={plannerState}>
          <GradeSections current={current} courses={planCourses} gpa={gpa} />
        </PlannerStateProvider>
      </section>

      {!planned && <ChecklistCard checklist={checklist} middleSchool={middleSchool} />}
      {!planned && <SuggestionsCard suggestions={suggestions} />}
      {middleSchool && gpaCard}

      <p className="text-sm">
        <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
