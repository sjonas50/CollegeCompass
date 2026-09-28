import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading } from "@/components/ui";
import { PLANNER_STATES } from "@/lib/planner/common";
import { plannerContentFor } from "@/lib/planner/content";
import { graduationPageTitle } from "@/lib/planner/copy";

export const metadata: Metadata = {
  title: "Graduation requirements by state",
  description: "What Utah, Tennessee and Texas require to graduate from high school, with each rule's source.",
};

/** The free graduation pages, one per state the planner covers. */
export default function GraduationIndexPage() {
  return (
    <>
      <PageHeading
        title="Graduation requirements by state"
        lead="What each state requires to graduate from high school, in plain words, with the source's own words for every rule. More states are coming."
      />
      <ul className="space-y-3">
        {PLANNER_STATES.map((state) => {
          const summary = plannerContentFor(state).rules.find((f) => f.kind === "graduation")?.ruleSets[0]?.plainSummary;
          return (
            <li key={state}>
              <Link href={`/graduation/${state.toLowerCase()}`} className="block rounded-xl border border-border bg-surface p-4 hover:border-accent">
                <span className="font-medium underline-offset-2">{graduationPageTitle(state)}</span>
                {summary && <span className="mt-1 block text-sm text-muted">{summary}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
