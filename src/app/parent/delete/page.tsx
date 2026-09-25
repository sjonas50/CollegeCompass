import type { Metadata } from "next";
import { deleteParentAccountAction } from "@/app/actions/parent";
import { Button, ButtonLink, Card, FormMessage, PageHeading } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Delete parent account" };

export default async function DeleteParentPage({ searchParams }: PageProps<"/parent/delete">) {
  await requireUser(["parent"]);
  const { confirm } = await searchParams;
  return (
    <>
      <PageHeading
        title="Delete your parent account?"
        lead="Accounts you created for children under 13 are deleted too. Teens who own their accounts keep them."
      />
      <Card>
        <form action={deleteParentAccountAction} className="space-y-4">
          {confirm && <FormMessage message="Tick the box to confirm." />}
          <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input type="checkbox" name="confirm" className="mt-0.5 size-5 shrink-0" />
            <span>I understand this can&apos;t be undone.</span>
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
