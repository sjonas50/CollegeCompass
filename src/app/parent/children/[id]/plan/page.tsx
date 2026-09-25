import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChecklistCard } from "@/app/plan/cards";
import { PathView } from "@/app/plan/path/path-view";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { listChildren } from "@/lib/accounts";
import { requireFullAccess } from "@/lib/access/guard";
import { requireUser } from "@/lib/auth/dal";
import { stateName } from "@/lib/colleges/states";
import { collegePrepChecklist } from "@/lib/courses/checklist";
import { comingLaterNote } from "@/lib/planner/copy";
import { studentPath } from "@/lib/planner/service";

export const metadata: Metadata = { title: "Class path" };

/**
 * A parent's read-only view of one child's path (design §2.10): the same draft the child sees,
 * with no buttons or forms. Only for the parent's own linked children; full access, like the
 * child's Plan page. Nothing here is audited: it's the family's own planning data, not a chat.
 */
export default async function ChildPlanPage({ params, searchParams }: PageProps<"/parent/children/[id]/plan">) {
  const parent = await requireUser(["parent"]);
  await requireFullAccess(parent);
  const { id } = await params;
  const { plan } = await searchParams;
  const db = await getDb();
  const child = (await listChildren(db, parent.id)).find((c) => c.id === id);
  if (!child) notFound();
  const path = await studentPath(db, child.id);
  const planId = plan === "B" ? "B" : "A";
  const base = `/parent/children/${child.id}/plan`;

  return (
    <div className="space-y-6">
      <PageHeading
        title={`${child.displayName}'s class path`}
        lead={`A read-only view. ${child.displayName} adds classes and makes choices on their own Plan page; talk it over together and with their school counselor.`}
      />
      {path.kind === "planned" ? (
        <section id="path" aria-labelledby="path-heading" className="space-y-2">
          <h2 id="path-heading" tabIndex={-1} className="sr-only">
            Class path
          </h2>
          <PathView
            path={path.result}
            ctx={path.ctx}
            mode="parent"
            planId={planId}
            planHref={(p) => (p === "A" ? `${base}#path-plan` : `${base}?plan=B#path-plan`)}
            printHref={`${base}/print${planId === "B" ? "?plan=B" : ""}`}
          />
        </section>
      ) : path.kind === "graduated" ? (
        <Card>
          <p>{child.displayName} has finished high school.</p>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="font-medium">Class planning</h2>
            <p className="mt-1 text-sm">
              {path.kind === "no_state" && path.ctx.homeState
                ? comingLaterNote(stateName(path.ctx.homeState) ?? path.ctx.homeState)
                : `Set ${child.displayName}'s state in their settings on your dashboard to see a year-by-year path (Utah, Tennessee and Texas for now).`}
            </p>
          </Card>
          {path.kind === "no_state" && <ChecklistCard checklist={collegePrepChecklist(path.ctx.courses)} middleSchool={path.ctx.grade <= 8} />}
        </>
      )}
      <p className="text-sm">
        <Link href="/parent" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to your dashboard
        </Link>
      </p>
    </div>
  );
}
