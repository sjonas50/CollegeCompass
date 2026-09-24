import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { setChildGradeAction, setChildRemindersAction } from "@/app/actions/settings";
import { GradeSettingSelect } from "@/components/student-settings";
import { reminderGoesToParent } from "@/lib/reminders";
import { gradeQuestion } from "@/lib/auth/age";
import { getDb } from "@/db";
import { Button, ButtonLink, Card, Notice, PageHeading } from "@/components/ui";
import { listChildren } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Parent" };

export default async function ParentHome({ searchParams }: PageProps<"/parent">) {
  const parent = await requireUser(["parent"]);
  const children = await listChildren(await getDb(), parent.id);
  const { added, deleted, saved } = await searchParams;

  return (
    <>
      <PageHeading title={`Hi, ${parent.displayName}`} lead="Your children's accounts and data." />
      <div className="space-y-4">
        {added && <Notice>Account created. Share the username and password with your child.</Notice>}
        {deleted && <Notice>The account and all of its data were deleted.</Notice>}
        {saved && <Notice>Settings saved.</Notice>}
        {children.length === 0 && (
          <Card>
            <p className="text-muted">No children added yet.</p>
          </Card>
        )}
        {children.map((child) => (
          <Card key={child.id}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-medium">{child.displayName}</h2>
                <p className="text-sm text-muted">
                  {child.grade === null ? "Grade not set" : child.grade > 12 ? "Finished high school" : `Grade ${child.grade}`}
                  {child.username && <> · signs in as <span className="font-mono">{child.username}</span></>}
                </p>
              </div>
              <div className="flex gap-2">
                <ButtonLink href={`/api/parent/children/${child.id}/export`} variant="secondary" prefetch={false}>
                  Export data
                </ButtonLink>
                <ButtonLink href={`/parent/children/${child.id}/delete`} variant="secondary">
                  Delete
                </ButtonLink>
              </div>
            </div>
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
      <div className="mt-10 flex flex-wrap gap-3 border-t border-border pt-6">
        <form action={logoutAction}>
          <Button type="submit" variant="secondary">Sign out</Button>
        </form>
        <Link href="/parent/delete" className="self-center text-sm text-danger underline">
          Delete my parent account
        </Link>
      </div>
    </>
  );
}
