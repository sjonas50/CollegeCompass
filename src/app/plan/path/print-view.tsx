import { PrintButton } from "@/app/aid/print-button";
import { DRAFT_NOTICE } from "@/lib/planner/copy";
import { levelLabel } from "@/lib/planner/course-types";
import type { PlannedPath, PlanSlot } from "@/lib/planner/engine-io";
import { getFamily } from "@/lib/planner/families";
import { REVIEW_LABELS } from "@/lib/planner/review";
import type { PathContext } from "@/lib/planner/service";
import { savedSchoolLabel } from "@/lib/schools/labels";
import { cohortLine, COURSE_STATUS_WORDS, PATH_LABELS, stateTitle, yearLabel } from "@/lib/planner/view";

// The one-page draft for the counselor meeting (design §2.8): semantic HTML that prints on one or
// two pages. The first name is off unless the student turns it on; the school shows because the
// student (or parent) is printing it for their own counselor.

function slotRow(slot: PlanSlot, state: PlannedPath["state"]): { name: string; level: string; status: string } | null {
  if (slot.kind === "your_choice") return { name: "Your choice", level: "", status: "Room for a class you pick" };
  const level = slot.level === "regular" ? "" : levelLabel(slot.level, state);
  if (slot.kind === "yours") return { name: slot.title, level, status: COURSE_STATUS_WORDS[slot.status] };
  return { name: slot.title, level, status: slot.needsPlanNow ? "Suggested (needs a plan now)" : slot.term === "summer" ? "Suggested (summer)" : "Suggested" };
}

export function PrintView({
  path,
  ctx,
  planId,
  firstName,
  today,
}: {
  path: PlannedPath;
  ctx: PathContext;
  planId: "A" | "B";
  firstName: string | null;
  today: string;
}) {
  const plan = path.plans.find((p) => p.id === planId) ?? path.plans[0];
  const school = ctx.school?.current;
  const graduation = path.audit.filter((rs) => rs.kind === "state_graduation");
  const conditions = graduation.flatMap((rs) => rs.conditions);
  const reviewed = path.builtFrom.ruleSets;
  return (
    <article data-plan-print className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <PrintButton label="Print" />
      </div>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Draft class plan, to talk over with my school counselor</h1>
        <p className="font-semibold">{DRAFT_NOTICE}</p>
        <p className="text-sm">{path.notices.standing}</p>
      </header>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {firstName && (
          <>
            <dt className="text-muted">Student</dt>
            <dd>{firstName}</dd>
          </>
        )}
        <dt className="text-muted">State</dt>
        <dd>
          {stateTitle(path.state)}
          {ctx.cohort && <> · {cohortLine(ctx.cohort)}</>}
        </dd>
        {school && school.choice !== "prefer_not_to_say" && (
          <>
            <dt className="text-muted">School</dt>
            <dd>{savedSchoolLabel(school)}</dd>
          </>
        )}
        <dt className="text-muted">Class list</dt>
        <dd>{path.builtFrom.catalogs[0]?.catalog.label ?? "—"}</dd>
        <dt className="text-muted">Planning for</dt>
        <dd>
          {PATH_LABELS[ctx.path]}
          {path.builtFrom.families.length > 0 && <> · {path.builtFrom.families.map((f) => getFamily(f.familyId).title).join("; ")}</>}
        </dd>
        {path.builtFrom.colleges.length > 0 && (
          <>
            <dt className="text-muted">Colleges</dt>
            <dd>{path.builtFrom.colleges.map((c) => c.name).join("; ")}</dd>
          </>
        )}
        <dt className="text-muted">Printed</dt>
        <dd>{today}</dd>
      </dl>

      {path.askCounselor.length > 0 && (
        <section aria-labelledby="print-questions">
          <h2 id="print-questions" className="text-lg font-semibold">
            Questions for my counselor
          </h2>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
            {path.askCounselor.map((q) => (
              <li key={q.id}>{q.text}</li>
            ))}
          </ol>
        </section>
      )}

      {plan && (
        <section aria-labelledby="print-plan">
          <h2 id="print-plan" className="text-lg font-semibold">
            Classes by year{path.plans.length > 1 ? ` (${plan.label})` : ""}
          </h2>
          <div className="print:grid print:grid-cols-2 print:gap-x-6">
          {plan.years.map((y) => {
            const rows = y.slots.flatMap((s) => {
              const r = slotRow(s, path.state);
              return r ? [r] : [];
            });
            return (
              <table key={y.grade} className="mt-3 w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-3/5" />
                  <col className="w-1/5" />
                  <col className="w-1/5" />
                </colgroup>
                <caption className="text-left font-medium">{yearLabel(y.grade, y.schoolYear)}</caption>
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="border-b border-border py-1 pr-2 font-normal">
                      Class
                    </th>
                    <th scope="col" className="border-b border-border py-1 pr-2 font-normal">
                      Level
                    </th>
                    <th scope="col" className="border-b border-border py-1 font-normal">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="border-b border-border py-1 pr-2">{r.name}</td>
                      <td className="border-b border-border py-1 pr-2">{r.level}</td>
                      <td className="border-b border-border py-1">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}
          </div>
        </section>
      )}

      {path.gaps.length > 0 && (
        <section aria-labelledby="print-left">
          <h2 id="print-left" className="text-lg font-semibold">
            What&apos;s still open
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {path.gaps.map((g) => (
              <li key={g.id}>
                {g.text} Options: {g.options.map((o) => o.text).join("; ")}.
              </li>
            ))}
          </ul>
        </section>
      )}

      {conditions.length > 0 && (
        <section aria-labelledby="print-conditions">
          <h2 id="print-conditions" className="text-lg font-semibold">
            Also needed to graduate (not classes; we don&apos;t track these)
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {conditions.map((c) => (
              <li key={c.id}>{c.label}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-border pt-3 text-xs text-muted">
        <p>
          Made with College Compass from {stateTitle(path.state)}&apos;s published rules. Planning is done by code, not AI.{" "}
          {reviewed.some((r) => r.review === "draft") ? `${REVIEW_LABELS.draft}.` : ""} Rules used:{" "}
          {reviewed.map((r) => `${r.title} (checked for ${r.verifiedForSchoolYear}-${String((r.verifiedForSchoolYear + 1) % 100).padStart(2, "0")}, version ${r.fingerprint})`).join("; ")}.
          Plan version {path.inputsFingerprint}.
        </p>
      </footer>
    </article>
  );
}
