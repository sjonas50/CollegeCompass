import type { Metadata } from "next";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { BILLING_PATH } from "@/lib/access/describe";
import { getUserAccess } from "@/lib/access/service";
import { syncCheckoutSession } from "@/lib/billing/checkout";
import { errorName, getStripe } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Thank you" };

/**
 * Where Stripe Checkout sends a parent after paying. Reads the session from Stripe so the family's
 * access updates right away instead of waiting for the webhook.
 */
export default async function CheckoutSuccessPage({ searchParams }: PageProps<"/account/billing/success">) {
  const parent = await requireUser(["parent"]);
  const { session_id: sessionId } = await searchParams;
  const db = await getDb();
  const stripe = getStripe();
  if (stripe && typeof sessionId === "string") {
    try {
      await syncCheckoutSession(db, stripe, parent.id, sessionId);
    } catch (error) {
      // The webhook will catch up; the page still says what we know.
      console.error("[billing] couldn't confirm a checkout session", errorName(error));
    }
  }
  const access = await getUserAccess(db, parent.id);
  const confirmed = access.sources.includes("subscription");

  return (
    <div className="space-y-6">
      <PageHeading
        title={confirmed ? "Thank you! Your plan is active." : "Thank you! We're confirming your payment."}
        lead={
          confirmed
            ? "Everyone in your family's account now has full access."
            : "This usually takes less than a minute. Refresh this page, or check Plan and billing in a moment."
        }
      />
      <Card>
        <p className="text-sm">Stripe emails your receipt. You can change or cancel your plan any time from Plan and billing.</p>
      </Card>
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={BILLING_PATH}>Plan and billing</ButtonLink>
        <ButtonLink href="/parent" variant="secondary">
          Back to your parent page
        </ButtonLink>
      </div>
    </div>
  );
}
