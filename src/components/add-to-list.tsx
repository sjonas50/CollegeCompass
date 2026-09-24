import Link from "next/link";
import { AddToListForm } from "@/app/applications/add-to-list-form";
import { getDb } from "@/db";
import { listStatusFor } from "@/lib/applications/service";
import { getCurrentUser } from "@/lib/auth/dal";

/**
 * "Add to my list" for a college page. Safe on public pages: signed-out visitors get a sign-in
 * link that comes back here, parents see nothing, and students can add the college (or see that
 * it's already on their list).
 *
 *   <AddToListButton unitId={college.unitId} name={college.name} />
 */
export async function AddToListButton({ unitId, name }: { unitId: number; name: string }) {
  if (!Number.isInteger(unitId) || unitId <= 0) return null;
  const user = await getCurrentUser();
  if (!user) {
    return (
      <Link href={`/login?next=/colleges/${unitId}`} className="inline-flex min-h-11 items-center underline underline-offset-2">
        Sign in to save colleges
      </Link>
    );
  }
  if (user.role !== "student") return null;
  const status = await listStatusFor(await getDb(), user.id, unitId);
  return <AddToListForm unitId={unitId} name={name} listed={status.listed} full={status.full} />;
}
