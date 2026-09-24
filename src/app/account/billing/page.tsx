import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { openPortalAction, startCheckoutAction } from "@/app/actions/billing";
import { Button, ButtonLink, Card, FormMessage, Notice, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { env } from "@/env";
import { FREE_ACCESS_PATH, UNLOCK_PATH, describeAccess, formatAccessDate, formatStartDate } from "@/lib/access/describe";
import { getUserAccess } from "@/lib/access/service";
import { canManageBilling } from "@/lib/billing/checkout";
import { type Plan, type PlanPrice, getPlanPrices, priceIdFor } from "@/lib/billing/plans";
import { getStripe, paidPlansAvailable } from "@/lib/billing/stripe";
import { requireUser } from "@/lib/auth/dal";
import { AccessStatus, FullAccessFeatures } from "../access-ui";

export const metadata: Metadata = { title: "Plan and billing" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

const ERRORS: Record<string, string> = {
  unavailable: "That plan isn't available right now. Please try again later, or use free access.",
  stripe: "We couldn't reach our payment service. Please try again in a few minutes.",
  subscribed: "Your family already has a plan. Use Manage billing to change it.",
  not_payer: "This plan was set up from another account, so it can't be changed here. Please contact us and we'll help.",
};

const PLAN_COPY: Record<Plan, { name: string; note: string }> = {
  monthly: { name: "Monthly", note: "Pay month to month. Cancel any time." },
  annual: { name: "Yearly", note: "One payment a year." },
};

function PlanOption({ plan, price }: { plan: Plan; price: PlanPrice | null }) {
  const copy = PLAN_COPY[plan];
  return (
    <li>
      <Card className="flex h-full flex-col gap-3">
        <div>
          <h3 className="font-medium">{copy.name}</h3>
          <p className="text-2xl font-semibold">{price ? price.label : "Price shown at checkout"}</p>
          <p className="mt-1 text-sm text-muted">{copy.note}</p>
        </div>
        <form action={startCheckoutAction} className="mt-auto">
          <input type="hidden" name="plan" value={plan} />
          <Button type="submit" className="w-full">
            Choose {copy.name.toLowerCase()}
          </Button>
        </form>
      </Card>
    </li>
  );
}

function ManageBilling({ lead }: { lead: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">{lead}</p>
      <form action={openPortalAction}>
        <Button type="submit" variant="secondary">
          Manage billing
        </Button>
      </form>
    </div>
  );
}

/**
 * A parent's plan and billing: the household's access, a monthly or yearly plan through Stripe,
 * the Customer Portal for changes, and free access for families who need it.
 */
export default async function BillingPage({ searchParams }: PageProps<"/account/billing">) {
  const parent = await requireUser(["parent", "student"]);
  if (parent.role !== "parent") redirect(UNLOCK_PATH);
  const { free, error } = await searchParams;
  const db = await getDb();
  const access = await getUserAccess(db, parent.id);
  const summary = describeAccess(access, "parent");
  const sub = access.subscription;
  const subscribed = Boolean(sub?.grantsAccess);
  // Only the parent who pays can open the Customer Portal: it shows their card and receipts.
  const manages = sub ? await canManageBilling(db, parent.id) : false;
  const stripe = getStripe();
  const available = Boolean(stripe) && paidPlansAvailable();
  const prices = available && stripe && !subscribed ? await getPlanPrices(stripe) : null;
  const plans = (["monthly", "annual"] as const).filter((p) => priceIdFor(p));
  const runningFree = access.freeAccess?.active ? access.freeAccess : null;

  return (
    <div className="space-y-8">
      <PageHeading title="Plan and billing" lead="Everyone in your family's account shares the same access." />
      {free === "on" && <Notice>Free access is on. Everyone in your family&apos;s account has full access.</Notice>}
      {free === "renewed" && <Notice>Free access is renewed.</Notice>}
      {typeof error === "string" && ERRORS[error] && <FormMessage message={ERRORS[error]} />}

      <AccessStatus summary={summary} />

      <section aria-labelledby="plan-heading" className="space-y-4">
        <h2 id="plan-heading" className="text-lg font-medium">
          {subscribed ? "Your plan" : "Choose a plan"}
        </h2>
        {subscribed ? (
          !manages ? (
            <p className="text-sm">This plan was set up from another account, so it can&apos;t be changed here.</p>
          ) : stripe ? (
            <ManageBilling lead="Change your plan, update your card, see receipts or cancel on Stripe's secure page." />
          ) : (
            <p className="text-sm">Billing changes aren&apos;t available right now. Please try again later.</p>
          )
        ) : available ? (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => (
                <PlanOption key={plan} plan={plan} price={prices?.[plan] ?? null} />
              ))}
            </ul>
            <p className="text-sm text-muted">
              You&apos;ll pay on Stripe&apos;s secure page. We never see or store your card details. You can cancel any time.
            </p>
            {manages && stripe && <ManageBilling lead="See past receipts or update your card." />}
          </>
        ) : (
          <Card>
            <p>Paid plans aren&apos;t available yet. Your family can keep full access with free access, below.</p>
          </Card>
        )}
        {!subscribed && <FullAccessFeatures heading="A plan unlocks" />}
      </section>

      <section aria-labelledby="free-access-heading" className="space-y-3">
        <h2 id="free-access-heading" className="text-lg font-medium">
          Free access
        </h2>
        {runningFree ? (
          <p className="text-sm">
            Your family has free access{runningFree.endsAt ? <> until {formatAccessDate(runningFree.endsAt)}</> : null}.
            {!access.canRenewFreeAccess && access.freeAccessRenewableFrom && (
              <> You can renew it starting {formatStartDate(access.freeAccessRenewableFrom)}.</>
            )}
          </p>
        ) : (
          <p className="text-sm">
            If cost is a problem, turn on free access. No documents and no questions about why. It lasts {env().FREE_ACCESS_MONTHS} months,
            and you can renew it.
          </p>
        )}
        {access.canRenewFreeAccess && (
          <ButtonLink href={FREE_ACCESS_PATH} variant="secondary">
            {runningFree ? "Renew free access" : "Turn on free access"}
          </ButtonLink>
        )}
      </section>

      <p className="text-sm">
        <Link href="/parent" className={linkClass}>
          Back to your parent page
        </Link>
      </p>
    </div>
  );
}
