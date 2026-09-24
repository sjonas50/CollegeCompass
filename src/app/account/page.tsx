import { redirect } from "next/navigation";
import { BILLING_PATH, UNLOCK_PATH } from "@/lib/access/describe";
import { requireUser } from "@/lib/auth/dal";

/** /account: parents manage their plan; students see their access. */
export default async function AccountPage() {
  const user = await requireUser(["student", "parent"]);
  redirect(user.role === "parent" ? BILLING_PATH : UNLOCK_PATH);
}
