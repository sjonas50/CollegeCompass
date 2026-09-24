import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";
import { gradeName } from "@/lib/courses/catalog";
import { CHECKLIST_CAVEAT, CHECKLIST_FRAMING, CTE_NOTE, type Checklist, type ChecklistStatus } from "@/lib/courses/checklist";
import { GPA_CAVEAT, type GpaSummary, formatGpa } from "@/lib/courses/gpa";
import { type CareerSuggestion, SUGGESTIONS_NOTE } from "@/lib/courses/suggestions";

function credits(n: number) {
  return `${n} ${n === 1 ? "credit" : "credits"}`;
}

function years(n: number) {
  return `${n} ${n === 1 ? "year" : "years"}`;
}

export function GpaCard({ gpa, middleSchool }: { gpa: GpaSummary; middleSchool: boolean }) {
  const hasGpa = gpa.unweighted !== null;
  return (
    <Card>
      <h2 className="text-lg font-medium">Your GPA (estimate)</h2>
      {hasGpa ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-background p-3">
              <dt className="text-sm text-muted">Unweighted</dt>
              <dd className="text-3xl font-semibold tabular-nums">{formatGpa(gpa.unweighted)}</dd>
            </div>
            <div className="rounded-lg bg-background p-3">
              <dt className="text-sm text-muted">Weighted</dt>
              <dd className="text-3xl font-semibold tabular-nums">{formatGpa(gpa.weighted)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            Based on {credits(gpa.gpaCredits)} of finished high school classes with letter grades. Weighted adds 0.5 for
            honors and 1.0 for AP, IB and dual enrollment classes you passed.
          </p>
          {gpa.byGrade.length > 1 && (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Estimated GPA by grade</caption>
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 font-normal">Grade</th>
                  <th scope="col" className="py-1 font-normal">Unweighted</th>
                  <th scope="col" className="py-1 font-normal">Weighted</th>
                </tr>
              </thead>
              <tbody>
                {gpa.byGrade.map((g) => (
                  <tr key={g.gradeLevel} className="border-t border-border">
                    <th scope="row" className="py-1.5 text-left font-normal">{gradeName(g.gradeLevel)}</th>
                    <td className="py-1.5 tabular-nums">{formatGpa(g.unweighted) ?? "—"}</td>
                    <td className="py-1.5 tabular-nums">{formatGpa(g.weighted) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {middleSchool
            ? "Your high school GPA usually starts in 9th grade. If you take a class for high school credit before then, like Algebra I, add its grade and it will show up here."
            : "When you finish a high school class, mark it finished and add its grade. You'll see an estimated GPA here."}
        </p>
      )}
      {gpa.creditsEarned > 0 && (
        <p className="mt-3 text-sm">
          High school credits earned so far: <strong className="tabular-nums">{gpa.creditsEarned}</strong>
        </p>
      )}
      <p className="mt-3 border-t border-border pt-3 text-sm text-muted">{GPA_CAVEAT}</p>
    </Card>
  );
}

const CHECKLIST_STATUS: Record<ChecklistStatus, { label: string; className: string }> = {
  covered: { label: "Covered", className: "bg-success-soft" },
  on_track: { label: "On track in your plan", className: "bg-accent-soft" },
  room_to_add: { label: "Room to add", className: "border border-border text-muted" },
};

const ALGEBRA_2_TEXT: Record<Checklist["algebra2"], string> = {
  done_or_in_progress: "Algebra II (or a class after it): done or in progress.",
  planned: "Algebra II (or a class after it) is in your plan.",
  not_yet: "Most four-year colleges look for Algebra II. Add it when it fits your plan.",
};

export function ChecklistCard({ checklist, middleSchool }: { checklist: Checklist; middleSchool: boolean }) {
  return (
    <Card>
      <h2 className="text-lg font-medium">College-prep classes</h2>
      {middleSchool && (
        <p className="mt-1 text-sm text-muted">
          A peek at what high school usually includes. You don&apos;t need to have this figured out yet — it&apos;s just
          good to know as you plan ahead.
        </p>
      )}
      <p className="mt-2 text-sm">{CHECKLIST_FRAMING}</p>
      <ul className="mt-3 space-y-4">
        {checklist.items.map((item) => {
          const status = CHECKLIST_STATUS[item.status];
          const donePct = Math.min(100, (item.doneOrInProgress / item.years) * 100);
          const plannedPct = Math.min(100 - donePct, (item.planned / item.years) * 100);
          return (
            <li key={item.subject}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="font-medium">
                  {item.label}: about {years(item.years)}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${status.className}`}>
                  {item.status === "covered" && <span aria-hidden>✓ </span>}
                  {status.label}
                </span>
              </div>
              <p className="text-sm text-muted">
                {item.note}
                {item.recommendedYears && ` Many recommend ${years(item.recommendedYears)}.`}
              </p>
              <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
                <div className="h-2 bg-accent" style={{ width: `${donePct}%` }} />
                <div className="h-2 bg-accent/40" style={{ width: `${plannedPct}%` }} />
              </div>
              <p className="mt-1 text-sm text-muted">
                {years(item.doneOrInProgress)} done or in progress · {years(item.planned)} planned
              </p>
              {item.subject === "math" && <p className="mt-1 text-sm">{ALGEBRA_2_TEXT[checklist.algebra2]}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-muted">
        Only classes for high school credit count here. A full-year class usually counts as one year. {CHECKLIST_CAVEAT}
      </p>
      <div className="mt-3 rounded-lg bg-background p-3 text-sm">
        <p>{CTE_NOTE}</p>
        {(checklist.cte.doneOrInProgress > 0 || checklist.cte.planned > 0) && (
          <p className="mt-1 text-muted">
            Your CTE classes: {credits(checklist.cte.doneOrInProgress)} done or in progress, {credits(checklist.cte.planned)} planned.
          </p>
        )}
      </div>
    </Card>
  );
}

export function SuggestionsCard({ suggestions }: { suggestions: CareerSuggestion[] }) {
  return (
    <Card>
      <h2 className="text-lg font-medium">Class ideas for your goals</h2>
      {suggestions.length === 0 ? (
        <div className="mt-2 space-y-3 text-sm text-muted">
          <p>
            Pick a north star career — a career you&apos;re aiming for, for now — and we&apos;ll suggest high school
            classes that connect to it.
          </p>
          <ButtonLink href="/careers" variant="secondary">
            Explore careers
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-3 space-y-5">
          {suggestions.map((s) => (
            <section key={s.occupationCode} aria-labelledby={`ideas-${s.occupationCode}`}>
              <h3 id={`ideas-${s.occupationCode}`} className="font-medium">
                For{" "}
                <Link href={`/careers/${s.occupationCode}`} className="underline underline-offset-2">
                  {s.title}
                </Link>
              </h3>
              <p className="text-sm text-muted">{s.because}</p>
              <ul className="mt-2 space-y-1.5">
                {s.ideas.map((idea) => (
                  <li key={idea.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{idea.title}</span>
                    {idea.inPlan && (
                      <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs">
                        <span aria-hidden>✓ </span>In your plan
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm text-muted">{SUGGESTIONS_NOTE}</p>
    </Card>
  );
}
