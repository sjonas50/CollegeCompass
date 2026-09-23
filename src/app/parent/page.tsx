import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getDb } from "@/db";
import { Button, ButtonLink, Card, Notice, PageHeading } from "@/components/ui";
import { listChildren } from "@/lib/accounts";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Parent" };

export default async function ParentHome({ searchParams }: PageProps<"/parent">) {
  const parent = await requireUser(["parent"]);
  const children = await listChildren(await getDb(), parent.id);
  const { added, deleted } = await searchParams;

  return (
    <>
      <PageHeading title={`Hi, ${parent.displayName}`} lead="Your children's accounts and data." />
      <div className="space-y-4">
        {added && <Notice>Account created. Share the username and password with your child.</Notice>}
        {deleted && <Notice>The account and all of its data were deleted.</Notice>}
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
                  Grade {child.grade}
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
