import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { env } from "@/env";
import { BILLING_PATH, UNLOCK_PATH, formatAccessDate, formatStartDate } from "@/lib/access/describe";
import { freeAccessEligibility } from "@/lib/access/service";
import { requireUser } from "@/lib/auth/dal";
import { CrisisLine } from "../access-ui";
import { FreeAccessForm } from "./free-access-form";

export const metadata: Metadata = { title: "Free access" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/** Free access for families who need it: parents and students 13 or older can turn it on. */
export default async function FreeAccessPage() {
  const user = await requireUser(["student", "parent"]);
  const eligibility = await freeAccessEligibility(await getDb(), user.id);
  const running = eligibility.access?.freeAccess?.active ? eligibility.access.freeAccess : null;
  const months = env().FREE_ACCESS_MONTHS;
  const back = user.role === "parent" ? { href: BILLING_PATH, label: "Back to plan and billing" } : { href: UNLOCK_PATH, label: "Back to your access" };

  return (
    <div className="space-y-6">
      <PageHeading
        // "Renew" only once renewing is open (see freeAccessRenewalOpens); before that, the page says when.
        title={running && eligibility.ok ? "Renew free access" : "Free access"}
        lead={`Cost should never keep a student from planning their future. Free access gives everyone in your family's account full access for ${months} months.`}
      />
      <Card>
        {eligibility.ok ? (
          <FreeAccessForm renewal={Boolean(running)} months={months} />
        ) : eligibility.error === "under_13" ? (
          <p>
            Please ask your parent or guardian to turn on free access from their College Compass account. It&apos;s free, and they
            won&apos;t need any documents.
          </p>
        ) : eligibility.error === "not_yet_renewable" && running ? (
          <p>
            Your family already has free access
            {running.endsAt ? <> until {formatAccessDate(running.endsAt)}</> : null}.
            {eligibility.access?.freeAccessRenewableFrom && (
              <> You can renew it starting {formatStartDate(eligibility.access.freeAccessRenewableFrom)}.</>
            )}
          </p>
        ) : (
          <p>Free access isn&apos;t available for this account. Please contact us and we&apos;ll help.</p>
        )}
      </Card>
      {user.role === "student" && <CrisisLine />}
      <p className="text-sm">
        <Link href={back.href} className={linkClass}>
          {back.label}
        </Link>
      </p>
    </div>
  );
}
