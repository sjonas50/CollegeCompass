import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintView } from "@/app/plan/path/print-view";
import { Card } from "@/components/ui";
import { getDb } from "@/db";
import { listChildren } from "@/lib/accounts";
import { requireFullAccess } from "@/lib/access/guard";
import { formatDate, usToday } from "@/lib/applications/dates";
import { requireUser } from "@/lib/auth/dal";
import { studentPath } from "@/lib/planner/service";
import "@/app/plan/print.css";

export const metadata: Metadata = { title: "Draft class plan" };

/** A parent's printable copy of a child's draft, for the counselor meeting. */
export default async function ChildPlanPrintPage({ params, searchParams }: PageProps<"/parent/children/[id]/plan/print">) {
  const parent = await requireUser(["parent"]);
  await requireFullAccess(parent);
  const { id } = await params;
  const { plan, name } = await searchParams;
  const db = await getDb();
  const child = (await listChildren(db, parent.id)).find((c) => c.id === id);
  if (!child) notFound();
  const path = await studentPath(db, child.id);
  const back = `/parent/children/${child.id}/plan`;
  if (path.kind !== "planned") {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Nothing to print yet</h1>
        <p className="mt-3 text-sm">
          <Link href={back} className="inline-flex min-h-11 items-center underline underline-offset-2">
            Back
          </Link>
        </p>
      </Card>
    );
  }
  const planId = plan === "B" ? "B" : "A";
  const withName = name === "1";
  const base = `${back}/print${planId === "B" ? "?plan=B&" : "?"}`;
  return (
    <div className="space-y-4">
      <nav aria-label="Print options" className="flex flex-wrap gap-x-4 text-sm print:hidden">
        <Link href={back} className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to {child.displayName}&apos;s path
        </Link>
        <Link href={withName ? base.slice(0, -1) : `${base}name=1`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          {withName ? "Leave the first name off" : `Add ${child.displayName}'s first name`}
        </Link>
      </nav>
      <PrintView path={path.result} ctx={path.ctx} planId={planId} firstName={withName ? child.displayName : null} today={formatDate(usToday())} />
    </div>
  );
}
