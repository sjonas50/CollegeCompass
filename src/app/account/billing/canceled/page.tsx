import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { BILLING_PATH, FREE_ACCESS_PATH } from "@/lib/access/describe";
import { getStripe, paidPlansAvailable } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Checkout canceled" };

/** Where Stripe Checkout sends a parent who backs out. Nothing was charged. */
export default async function CheckoutCanceledPage() {
  await requireUser(["parent"]);
  // Without paid plans there's no checkout to back out of, and no plan to choose later. Plan and
  // billing says what's available (the success page does the same).
  if (!getStripe() || !paidPlansAvailable()) redirect(BILLING_PATH);
  return (
    <div className="space-y-6">
      <PageHeading title="No problem. You weren't charged." lead="You can choose a plan any time from Plan and billing." />
      <Card>
        <p className="text-sm">If cost is a problem, free access is always an option. No documents and no questions about why.</p>
        <div className="mt-3">
          <ButtonLink href={FREE_ACCESS_PATH} variant="secondary">
            About free access
          </ButtonLink>
        </div>
      </Card>
      <ButtonLink href={BILLING_PATH}>Back to plan and billing</ButtonLink>
    </div>
  );
}
