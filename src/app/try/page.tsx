import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnetToolsAttribution } from "@/components/attribution";
import { PageHeading } from "@/components/ui";
import { INTEREST_ITEMS, LIKE_SCALE } from "@/lib/assessments/instruments";
import { getCurrentUser } from "@/lib/auth/dal";
import { FreeQuiz } from "./free-quiz";

export const metadata: Metadata = {
  title: "Free career interest quiz",
  description: "60 quick activities, about 10 minutes. See which careers fit your interests — free, no account needed.",
};

/**
 * The free interest quiz: no account, no email, no tracking. Answers stay in the visitor's browser.
 * Only essential cookies exist on this site, and this page sets none.
 */
export default async function TryPage() {
  // Students take the same quiz in their account, where it's saved with the rest of their plan.
  const user = await getCurrentUser();
  if (user?.role === "student") redirect("/discover/interests");

  return (
    <>
      <PageHeading
        title="Find careers that fit you"
        lead="Would you like doing each of these activities? Don't worry about how much school or training it would take, or how much money you'd make. Just go with your gut."
      />
      <p className="mb-6 text-sm text-muted">
        60 quick activities, about 10 minutes. Free, with no account and no email. Your answers stay in this browser.
      </p>
      <FreeQuiz items={INTEREST_ITEMS.map(({ id, text }) => ({ id, text }))} options={LIKE_SCALE} />
      <div className="mt-8">
        <OnetToolsAttribution />
      </div>
    </>
  );
}
