import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { BILLING_PATH } from "@/lib/access/describe";
import { getUserAccess } from "@/lib/access/service";
import { finishedRecently, syncCheckoutSession } from "@/lib/billing/checkout";
import { errorName, getStripe } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Your plan" };

/**
 * Where Stripe Checkout sends a parent after paying. Reads the session from Stripe so the family's
 * access updates right away instead of waiting for the webhook. Thanks the parent only for a
 * checkout their household just finished; any other link, including an old one from the browser's
 * history, gets words that promise nothing.
 */
export default async function CheckoutSuccessPage({ searchParams }: PageProps<"/account/billing/success">) {
  const parent = await requireUser(["parent"]);
  const { session_id: sessionId } = await searchParams;
  const stripe = getStripe();
  // Without Stripe there's no checkout to come back from. Plan and billing says what's available.
  if (!stripe) redirect(BILLING_PATH);
  const db = await getDb();
  let finished = false;
  if (typeof sessionId === "string") {
    try {
      const res = await syncCheckoutSession(db, stripe, parent.id, sessionId);
      finished = res.ok && finishedRecently(res);
    } catch (error) {
      // The webhook will catch up; the page still says only what we know.
      console.error("[billing] couldn't confirm a checkout session", errorName(error));
    }
  }
  const confirmed = finished && (await getUserAccess(db, parent.id)).sources.includes("subscription");

  return (
    <div className="space-y-6">
      {finished ? (
        <>
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
        </>
      ) : (
        <PageHeading
          title="Your plan"
          lead="Plan and billing shows your family's plan and access. If you just paid, it can take a few minutes to show up there."
        />
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={BILLING_PATH}>Plan and billing</ButtonLink>
        <ButtonLink href="/parent" variant="secondary">
          Back to your parent page
        </ButtonLink>
      </div>
    </div>
  );
}
