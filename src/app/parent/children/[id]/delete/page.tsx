import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteChildAction } from "@/app/actions/parent";
import { getDb } from "@/db";
import { Button, ButtonLink, Card, FormMessage, PageHeading } from "@/components/ui";
import { listChildren } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Delete account" };

export default async function DeleteChildPage({ params, searchParams }: PageProps<"/parent/children/[id]/delete">) {
  const parent = await requireUser(["parent"]);
  const { id } = await params;
  const { confirm } = await searchParams;
  const child = (await listChildren(await getDb(), parent.id)).find((c) => c.id === id);
  if (!child) notFound();

  return (
    <>
      <PageHeading
        title={`Delete ${child.displayName}'s account?`}
        lead="This permanently deletes their account, assessments, plans and conversations. It can't be undone."
      />
      <Card>
        <form action={deleteChildAction} className="space-y-4">
          <input type="hidden" name="studentId" value={child.id} />
          {confirm && <FormMessage message="Tick the box to confirm." />}
          <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input type="checkbox" name="confirm" className="mt-0.5 size-5 shrink-0" />
            <span>I understand this deletes everything and can&apos;t be undone.</span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="danger">Delete permanently</Button>
            <ButtonLink href="/parent" variant="secondary">Cancel</ButtonLink>
          </div>
        </form>
      </Card>
    </>
  );
}
