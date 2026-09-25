import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { setChildGradeAction, setChildRemindersAction } from "@/app/actions/settings";
import { GradeSettingSelect } from "@/components/student-settings";
import { reminderGoesToParent } from "@/lib/reminders";
import { gradeQuestion } from "@/lib/auth/age";
import { getDb } from "@/db";
import { Button, ButtonLink, Card, Notice, PageHeading } from "@/components/ui";
import { aidGuideHref } from "@/lib/aid-guide/navigation";
import { requireUser } from "@/lib/auth/dal";
import { parentDashboard } from "@/lib/parent-dashboard";
import { billingCardNote, describeAccess } from "@/lib/access/describe";
import { accessFor } from "@/lib/access/guard";
import { getStripe, paidPlansAvailable } from "@/lib/billing/stripe";
import { ChildProgressSummary } from "./child-progress";

export const metadata: Metadata = { title: "Parent" };

function gradeText(grade: number | null) {
  if (grade === null) return "Grade not set";
  return grade > 12 ? "Finished high school" : `Grade ${grade}`;
}

/**
 * What the data download holds (see exportStudentData): everything for a child the parent set up
 * under 13, and no counselor chats, notes or safety flags for a teen who owns their account.
 */
function DownloadNote({ name, parentManaged }: { name: string; parentManaged: boolean }) {
  return (
    <p className="mt-3 text-sm text-muted">
      {parentManaged
        ? `You set up this account when ${name} was under 13, so you have the right to review everything we collect from ${name}. The download includes their chats with the AI counselor, even though this page doesn't show them.`
        : `${name} owns this account, so their chats with the AI counselor stay private to them. The download leaves out those chats, the counselor's notes and any safety flags.`}
    </p>
  );
}

export default async function ParentHome({ searchParams }: PageProps<"/parent">) {
  const parent = await requireUser(["parent"]);
  const [children, access] = await Promise.all([parentDashboard(await getDb(), parent.id), accessFor(parent)]);
  const plan = describeAccess(access, "parent");
  const { added, deleted, "not-deleted": notDeleted, saved, stale, linked, imported } = await searchParams;

  return (
    <>
      <PageHeading title={`Hi, ${parent.displayName}`} lead="Follow your children's progress and manage their accounts." />
      <div className="space-y-4">
        {added && <Notice>Account created. Share the username and password with your child.{imported && " Their saved quiz results were added too."}</Notice>}
        {linked && <Notice>You&apos;re linked. You can follow your teen&apos;s progress here now.</Notice>}
        {deleted && <Notice>The account and all of its data were deleted.</Notice>}
        {/* A second click on Delete, or an account that isn't theirs: say only that nothing happened. */}
        {notDeleted && <Notice>Nothing was deleted. That account may already be gone.</Notice>}
        {saved && <Notice>Settings saved.</Notice>}
        {stale && <Notice>The school year changed since that page loaded, so we didn&apos;t save the grade. Please pick it again.</Notice>}
        {children.length > 0 && (
          <p className="rounded-lg border border-border px-3 py-2 text-sm">
            <span className="font-medium">Chats with the AI counselor aren&apos;t shown on this page.</span> You see
            progress and plans here, not what your child talks about.
          </p>
        )}
        {children.length === 0 && (
          <Card>
            <p className="font-medium">No children added yet.</p>
            <p className="mt-1 text-sm text-muted">
              Add your child below. If your teen already has an account, ask them to invite you from their dashboard.
            </p>
          </Card>
        )}
        {children.map((child) => (
          <Card key={child.id}>
            <div>
              <h2 className="text-lg font-medium">{child.displayName}</h2>
              <p className="text-sm text-muted">
                {gradeText(child.grade)}
                {child.username && <> · signs in as <span className="font-mono">{child.username}</span></>}
              </p>
            </div>
            <ChildProgressSummary name={child.displayName} progress={child.progress} />
            <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
              <ButtonLink href={`/api/parent/children/${child.id}/export`} variant="secondary" prefetch={false}>
                Download data
              </ButtonLink>
              <ButtonLink href={`/parent/children/${child.id}/delete`} variant="secondary">
                Delete
              </ButtonLink>
            </div>
            <DownloadNote name={child.displayName} parentManaged={child.parentManaged} />
            <details className="mt-3 border-t border-border pt-3">
              <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">Settings</summary>
              <div className="mt-3 space-y-4">
                <form action={setChildGradeAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="studentId" value={child.id} />
                  <div>
                    <label htmlFor={`grade-${child.id}`} className="block text-sm">{gradeQuestion().label}</label>
                    <GradeSettingSelect id={`grade-${child.id}`} grade={child.grade} />
                  </div>
                  <Button type="submit" variant="secondary">Save grade</Button>
                </form>
                <form action={setChildRemindersAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="studentId" value={child.id} />
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" name="reminders" defaultChecked={child.remindersEnabled} className="size-4" />
                    Weekly reminder email {reminderGoesToParent(child) ? "(sent to you)" : `(sent to ${child.displayName})`}
                  </label>
                  <Button type="submit" variant="secondary">Save</Button>
                </form>
              </div>
            </details>
          </Card>
        ))}
        <ButtonLink href="/parent/children/new">Add a child</ButtonLink>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-medium">Paying for college</h2>
          <p className="mt-1 text-sm text-muted">
            A plain-language guide to financial aid: the FAFSA, grants, loans, and how to compare offers.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href={aidGuideHref("en")} variant="secondary">Read the guide</ButtonLink>
            <ButtonLink href={aidGuideHref("es")} variant="secondary" hrefLang="es" lang="es">
              Guía en español
            </ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="font-medium">Plan and billing</h2>
          <p className="mt-1 text-sm">{plan.headline}</p>
          <p className="mt-1 text-sm text-muted">{billingCardNote(access, Boolean(getStripe()) && paidPlansAvailable())}</p>
          <div className="mt-3">
            <ButtonLink href="/account/billing" variant="secondary">Plan and billing</ButtonLink>
          </div>
        </Card>
      </div>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6">
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">Sign out</Button>
        </form>
        <Link href="/parent/delete" className="inline-flex min-h-11 items-center text-sm text-danger underline">
          Delete my parent account
        </Link>
      </div>
    </>
  );
}
