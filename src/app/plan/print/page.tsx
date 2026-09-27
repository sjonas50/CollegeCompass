import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getDb } from "@/db";
import { requireFullAccess } from "@/lib/access/guard";
import { usToday, formatDate } from "@/lib/applications/dates";
import { requireUser } from "@/lib/auth/dal";
import { plannerPathEnabled } from "@/lib/planner/beta";
import { studentPath } from "@/lib/planner/service";
import { PrintView } from "../path/print-view";
import "../print.css";

export const metadata: Metadata = { title: "Draft class plan" };

/** The printable one-page draft of "Your path", with questions for the counselor. */
export default async function PlanPrintPage({ searchParams }: PageProps<"/plan/print">) {
  const student = await requireUser(["student"]);
  await requireFullAccess(student);
  const { plan, name } = await searchParams;
  const db = await getDb();
  // Part of "Your path", which is in beta (lib/planner/beta.ts).
  if (!(await plannerPathEnabled(db, student.id))) redirect("/plan");
  const path = await studentPath(db, student.id);
  const planId = plan === "B" ? "B" : "A";
  if (path.kind !== "planned") {
    return (
      <Card>
        <h1 className="text-xl font-semibold">Nothing to print yet</h1>
        <p className="mt-2 text-sm text-muted">The printable draft is for students in Utah, Tennessee and Texas for now.</p>
        <p className="mt-3 text-sm">
          <Link href="/plan" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Back to your course plan
          </Link>
        </p>
      </Card>
    );
  }
  const withName = name === "1";
  const base = `/plan/print${planId === "B" ? "?plan=B&" : "?"}`;
  return (
    <div className="space-y-4">
      <nav aria-label="Print options" className="flex flex-wrap gap-x-4 text-sm print:hidden">
        <Link href="/plan#path" className="inline-flex min-h-11 items-center underline underline-offset-2">
          Back to your path
        </Link>
        <Link href={withName ? base.slice(0, -1) : `${base}name=1`} className="inline-flex min-h-11 items-center underline underline-offset-2">
          {withName ? "Leave my first name off" : "Add my first name"}
        </Link>
      </nav>
      <PrintView path={path.result} ctx={path.ctx} planId={planId} firstName={withName ? student.displayName : null} today={formatDate(usToday())} />
    </div>
  );
}
