import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Card, Notice, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { BILLING_PATH, FREE_ACCESS_PATH, describeAccess, formatAccessDate } from "@/lib/access/describe";
import { freeAccessEligibility, getUserAccess } from "@/lib/access/service";
import { requireUser } from "@/lib/auth/dal";
import { AccessStatus, CrisisLine, FreeFeatures, FullAccessFeatures } from "../access-ui";

export const metadata: Metadata = { title: "Your access" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/**
 * Where a locked student lands: what's still free, and the two ways to unlock the rest (a parent
 * subscribes, or free access). Parents manage all of this on /account/billing.
 */
export default async function AccessPage({ searchParams }: PageProps<"/account/access">) {
  const user = await requireUser(["student", "parent"]);
  if (user.role === "parent") redirect(BILLING_PATH);
  const { free } = await searchParams;
  const db = await getDb();
  const eligibility = await freeAccessEligibility(db, user.id);
  const access = eligibility.access ?? (await getUserAccess(db, user.id));
  const summary = describeAccess(access, "student");
  const runningFree = access.freeAccess?.active ? access.freeAccess : null;
  const trialOnly = access.sources.length === 1 && access.sources[0] === "trial";
  // Ways to unlock (or keep) full access, unless something other than a trial already covers it.
  const showOptions = !access.full || trialOnly || Boolean(runningFree && access.canRenewFreeAccess);
  const optionsHeading = !access.full ? "How to unlock it" : trialOnly ? "Keep full access after your trial" : "Keep your access going";

  return (
    <div className="space-y-8">
      <PageHeading
        title={access.full ? "Your College Compass access" : "Unlock the rest of College Compass"}
        lead={
          access.full
            ? "Everyone in your family's account shares the same access."
            : "Your counselor, class plan, roadmap and college list need full access. Everything else stays free."
        }
      />
      {free === "on" && <Notice>Free access is on for your family. Everything is unlocked.</Notice>}
      {free === "renewed" && <Notice>Free access is renewed for your family.</Notice>}

      <AccessStatus summary={summary} />

      {!access.full && <FullAccessFeatures heading="What full access unlocks" />}

      {showOptions && (
        <section aria-labelledby="unlock-heading" className="space-y-4">
          <h2 id="unlock-heading" className="text-lg font-medium">
            {optionsHeading}
          </h2>
          {(!access.full || trialOnly) && (
            <Card>
              <h3 className="font-medium">Ask a parent or guardian</h3>
              <p className="mt-1 text-sm">
                A parent or guardian can choose a plan from their own College Compass account. Only a parent can pay, so students
                can&apos;t subscribe themselves.
              </p>
            </Card>
          )}
          <Card>
            <h3 className="font-medium">{runningFree ? "Renew free access" : "Use free access"}</h3>
            {eligibility.ok ? (
              <>
                <p className="mt-1 text-sm">
                  If cost is a problem, your family can use College Compass for free. No documents and no questions about why.
                </p>
                <div className="mt-3">
                  <ButtonLink href={FREE_ACCESS_PATH}>{runningFree ? "Renew free access" : "Turn on free access"}</ButtonLink>
                </div>
              </>
            ) : eligibility.error === "under_13" ? (
              <p className="mt-1 text-sm">
                If cost is a problem, ask your parent or guardian to turn on free access from their account. It&apos;s free and they
                won&apos;t need any documents.
              </p>
            ) : eligibility.error === "not_yet_renewable" && access.freeAccessRenewableFrom ? (
              <p className="mt-1 text-sm">You can renew it starting {formatAccessDate(access.freeAccessRenewableFrom)}.</p>
            ) : (
              <p className="mt-1 text-sm">Free access isn&apos;t available for this account. Please ask a parent or guardian for help.</p>
            )}
          </Card>
        </section>
      )}

      <FreeFeatures />
      <CrisisLine />

      <p className="text-sm">
        <Link href="/dashboard" className={linkClass}>
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
