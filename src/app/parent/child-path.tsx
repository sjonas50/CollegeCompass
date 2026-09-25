import Link from "next/link";
import { stateName } from "@/lib/colleges/states";
import { comingLaterNote } from "@/lib/planner/copy";
import type { PathOverview } from "@/lib/planner/service";
import { stateTitle } from "@/lib/planner/view";

// A child's class path on the parent dashboard (design §2.10): "Texas, class of 2030. 4 done,
// 3 planned, 2 room to add, 1 to ask about. Next: …", with a link to the read-only path. The
// school isn't part of it; the parent sees that in the child's settings.

export type ChildPathState = PathOverview | { kind: "locked" };

const link = "inline-flex min-h-11 items-center font-medium underline underline-offset-2";

export function ChildPathBlock({ childId, name, state }: { childId: string; name: string; state: ChildPathState }) {
  if (state.kind === "graduated") return null;
  const href = `/parent/children/${childId}/plan`;
  return (
    <div className="mt-4 rounded-lg border border-border p-4 text-sm">
      <h3 className="font-medium">Class path</h3>
      {state.kind === "planned" && (
        <>
          {state.summary.stage === "middle_school" ? (
            <p className="mt-1">
              {stateTitle(state.summary.state)}, class of {state.summary.classYear}. In middle school, the path shows math placement, classes to
              explore and what 9th grade often looks like.
            </p>
          ) : (
            <p className="mt-1">
              {stateTitle(state.summary.state)}, class of {state.summary.classYear}. Graduation requirements: {state.summary.counts.done} done,{" "}
              {state.summary.counts.planned} planned, {state.summary.counts.roomToAdd} with room to add, {state.summary.counts.ask} to ask the counselor
              about.
            </p>
          )}
          {state.summary.next && <p className="mt-1">Next: {state.summary.next}</p>}
          <p className="mt-1 text-muted">A draft to take to {name}&apos;s school counselor.</p>
          <Link href={href} className={link}>
            See {name}&apos;s class path
          </Link>
        </>
      )}
      {state.kind === "coming_later" && (
        <>
          <p className="mt-1">{comingLaterNote(stateName(state.homeState) ?? state.homeState)}</p>
          <Link href={href} className={link}>
            See {name}&apos;s college-prep checklist
          </Link>
        </>
      )}
      {state.kind === "no_state" && (
        <p className="mt-1 text-muted">Set {name}&apos;s state in Settings below to see a year-by-year class path (Utah, Tennessee and Texas for now).</p>
      )}
      {state.kind === "locked" && (
        <p className="mt-1 text-muted">
          {name}&apos;s class path comes with your family&apos;s plan or free access.{" "}
          <Link href="/account/billing" className="underline underline-offset-2">
            See how to unlock it
          </Link>
          .
        </p>
      )}
    </div>
  );
}
