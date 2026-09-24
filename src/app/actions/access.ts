"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { BILLING_PATH, UNLOCK_PATH, formatStartDate } from "@/lib/access/describe";
import { grantFreeAccess } from "@/lib/access/service";
import { requireUser } from "@/lib/auth/dal";
import type { FormState } from "@/lib/forms";

/**
 * The free-access form: one checkbox, no documents, no reasons stored. Parents and students 13 or
 * older can turn it on for their household (the rules live in grantFreeAccess).
 */
export async function requestFreeAccessAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["parent", "student"]);
  if (formData.get("statement") !== "on") {
    return { errors: { statement: ["Check the box to turn on free access."] } };
  }
  const result = await grantFreeAccess(await getDb(), user.id);
  if (!result.ok) {
    switch (result.error) {
      case "under_13":
        return { message: "Please ask your parent or guardian to turn on free access from their account." };
      case "not_yet_renewable":
        return {
          message: result.renewableFrom
            ? `Your family already has free access. You can renew it starting ${formatStartDate(result.renewableFrom)}.`
            : "Your family already has free access.",
        };
      default:
        return { message: "We couldn't turn on free access for this account. Please contact us and we'll help." };
    }
  }
  redirect(`${user.role === "parent" ? BILLING_PATH : UNLOCK_PATH}?free=${result.renewal ? "renewed" : "on"}`);
}
