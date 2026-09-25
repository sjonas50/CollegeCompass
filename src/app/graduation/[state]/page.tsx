import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Why } from "@/app/plan/path/why";
import { ButtonLink, PageHeading } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/dal";
import { SUBJECT_LABELS } from "@/lib/courses/catalog";
import { isPlannerState, PLANNER_STATES, type PlannerState, schoolYearLabel } from "@/lib/planner/common";
import { plannerContentFor, resolveContentCitations } from "@/lib/planner/content";
import { DRAFT_NOTICE, graduationPageTitle, STANDING_PLAN_NOTE } from "@/lib/planner/copy";
import { REVIEW_LABELS } from "@/lib/planner/review";
import type { Check, ContentHeader, RuleSet, Variant } from "@/lib/planner/rules";
import { cohortLabel, ordinal, stateTitle } from "@/lib/planner/view";
import { ReqTree } from "../req-tree";

// "What <State> requires to graduate" (owner decision): a free page for anyone, built from the same
// reviewed content the planner uses. Every requirement shows the source's own words. The content
// is a draft until a school counselor reviews it, and says so.

export const dynamicParams = false;

export function generateStaticParams() {
  return PLANNER_STATES.map((s) => ({ state: s.toLowerCase() }));
}

function stateParam(param: string): PlannerState | null {
  const code = param.toUpperCase();
  return param === param.toLowerCase() && isPlannerState(code) ? code : null;
}

function graduationFiles(state: PlannerState) {
  const rules = plannerContentFor(state).rules;
  const graduation = rules.find((f) => f.kind === "graduation")!;
  const options = rules.find((f) => f.kind === "options") ?? null;
  return { graduation, options, facts: plannerContentFor(state).facts };
}

export async function generateMetadata({ params }: PageProps<"/graduation/[state]">): Promise<Metadata> {
  const state = stateParam((await params).state);
  if (!state) return {};
  const { graduation } = graduationFiles(state);
  return { title: graduationPageTitle(state), description: graduation.ruleSets[0]?.plainSummary };
}

function projectedNote(rs: RuleSet): string | null {
  if (rs.projectedBeyond === undefined) return null;
  const who = rs.cohortKey === "class_year" ? `the class of ${rs.projectedBeyond}` : `students who start ${rs.cohortKey === "grade9_entry_year" ? "9th" : "7th"} grade in ${schoolYearLabel(rs.projectedBeyond)}`;
  return `The state has published these rules through ${who}. For later classes they're our best guess (projected) until the state publishes more.`;
}

function checkText(check: Check): string | null {
  switch (check.kind) {
    case "enrolled_years":
      return `Take ${SUBJECT_LABELS[check.subject].toLowerCase()} in at least ${check.years} school years of high school.`;
    case "senior_year_math":
      return "College-bound students take a full year of math in 12th grade, unless they show college-ready math another way.";
    case "no_endorsement_after":
      return `Graduating without an endorsement is possible only after ${ordinal(check.grade)} grade, after talking with the counselor and with a parent's written permission.`;
    default:
      return null;
  }
}

function citeIds(file: ContentHeader): string[] {
  return file.citations.map((c) => c.id);
}

function VariantSection({ rs, variant, citations, id }: { rs: RuleSet; variant: Variant; citations: ReturnType<typeof resolveContentCitations>; id: string }) {
  const checks = (variant.checks ?? []).flatMap((c) => {
    const text = checkText(c);
    return text ? [{ id: c.id, text, cite: c.cite }] : [];
  });
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <h2 id={id} className="text-xl font-semibold">
        {cohortLabel(rs.cohortKey, variant.cohort)}
      </h2>
      <ReqTree reqs={variant.requirements} citations={citations} />
      {checks.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {checks.map((c) => (
            <li key={c.id}>
              {c.text}
              <Why ids={c.cite} citations={citations} srContext="for this rule" />
            </li>
          ))}
        </ul>
      )}
      {(variant.conditions ?? []).length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">Also required (not classes)</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {variant.conditions!.map((c) => (
              <li key={c.id}>
                {c.label}
                <Why ids={c.cite} citations={citations} srContext={`for ${c.label}`} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {(variant.warnings ?? []).length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">Good to know</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {variant.warnings!.map((w) => (
              <li key={w.id}>
                {w.text}
                <Why ids={w.cite} citations={citations} srContext="for this note" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {(variant.unverified ?? []).length > 0 && (
        <div className="text-sm">
          <h3 className="font-medium">Ask your counselor</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {variant.unverified!.map((u) => (
              <li key={u.id}>{u.text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function GraduationStatePage({ params }: PageProps<"/graduation/[state]">) {
  const state = stateParam((await params).state);
  if (!state) notFound();
  const { graduation, options, facts } = graduationFiles(state);
  const main = graduation.ruleSets.find((rs) => rs.kind === "state_graduation")!;
  const citations = resolveContentCitations([...citeIds(graduation), ...(options ? citeIds(options) : []), ...citeIds(facts)]);
  const variants = [...main.variants].reverse();
  const optionSets = options?.ruleSets ?? [];
  const draft = [graduation, options].some((f) => f && f.review.status === "draft");
  const sources = Object.entries({ ...graduation.sources, ...(options?.sources ?? {}) });
  const user = await getCurrentUser();
  const cta = user?.role === "student" ? "/plan#path" : user?.role === "parent" ? "/parent" : "/#get-started";
  const projected = projectedNote(main);

  return (
    <article className="space-y-8">
      <p className="text-sm">
        <Link href="/graduation" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Graduation requirements by state
        </Link>
      </p>
      <PageHeading title={graduationPageTitle(state)} lead={main.plainSummary} />

      <div className="space-y-2 rounded-xl border border-border bg-accent-soft p-4 text-sm">
        <p className="font-semibold">{DRAFT_NOTICE}</p>
        <p>
          {draft ? `${REVIEW_LABELS.draft}. ` : ""}Checked for the {schoolYearLabel(graduation.verifiedForSchoolYear)} school year from{" "}
          {stateTitle(state)}&apos;s published rules. Your district may require more.
        </p>
        <p>{STANDING_PLAN_NOTE}</p>
        {projected && <p>{projected}</p>}
      </div>

      {variants.map((v, i) => (
        <VariantSection key={v.id} rs={main} variant={v} citations={citations} id={`cohort-${i}`} />
      ))}

      {optionSets.length > 0 && (
        <section aria-labelledby="options" className="space-y-3">
          <h2 id="options" className="text-xl font-semibold">
            {state === "TX" ? "Endorsements and the Distinguished Level of Achievement" : "Choices on top of the basics"}
          </h2>
          <ul className="space-y-2">
            {optionSets.map((rs) => {
              const latest = rs.variants[rs.variants.length - 1];
              return (
                <li key={rs.id} className="rounded-xl border border-border bg-surface p-4 text-sm">
                  <p className="font-medium">{rs.title}</p>
                  <p className="mt-1">{rs.plainSummary}</p>
                  {latest && (
                    <details className="mt-2">
                      <summary className="min-h-11 cursor-pointer content-center font-medium">
                        What it asks for<span className="sr-only">: {rs.title}</span> ({cohortLabel(rs.cohortKey, latest.cohort).toLowerCase()})
                      </summary>
                      <ReqTree reqs={latest.requirements} citations={citations} />
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(facts.terms ?? []).length > 0 && (
        <section aria-labelledby="words" className="space-y-2">
          <h2 id="words" className="text-xl font-semibold">
            Words to know in {stateTitle(state)}
          </h2>
          <dl className="space-y-2 text-sm">
            {facts.terms!.map((t) => (
              <div key={t.id}>
                <dt className="font-medium">{t.term}</dt>
                <dd>
                  {t.meaning}
                  <Why ids={t.cite} citations={citations} srContext={`for ${t.term}`} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="your-path" className="rounded-xl border border-border bg-surface p-5">
        <h2 id="your-path" className="text-lg font-medium">
          See it for your own classes
        </h2>
        <p className="mt-1 text-sm text-muted">
          College Compass turns these rules into a year-by-year draft for each student, with what colleges and your goals ask for too.
        </p>
        <div className="mt-3">
          <ButtonLink href={cta} variant="secondary">
            {user?.role === "student" ? "Open your path" : user ? "Go to your dashboard" : "Get started"}
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="sources" className="space-y-2">
        <h2 id="sources" className="text-xl font-semibold">
          Where this comes from
        </h2>
        <ul className="space-y-1 text-sm">
          {sources.map(([key, s]) => (
            <li key={key}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                {s.title}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <span className="text-muted">
                {" "}
                · {s.publisher} · checked {s.checkedOn}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
