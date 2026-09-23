import type { Metadata } from "next";
import { Card, PageHeading } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy" };

// DRAFT — to be replaced with counsel-reviewed text before any family uses the product.
export default function PrivacyPage() {
  return (
    <>
      <PageHeading title="Privacy, in plain language" lead="Draft — this page will be finalized with our lawyer before launch." />
      <Card className="space-y-3 text-sm leading-relaxed">
        <p><strong>What we collect:</strong> a first name or nickname, birthday, grade, and what students do in College Compass (assessment answers, plans, and conversations with our AI counselor). Parents give us their name and email.</p>
        <p><strong>Children under 13:</strong> a parent must create the account and give consent first. Before that, we keep only the parent&apos;s email, and delete it if they don&apos;t respond within 7 days.</p>
        <p><strong>What we never do:</strong> sell data, show ads, or use students&apos; data to train AI models.</p>
        <p><strong>AI:</strong> our AI provider receives what&apos;s needed to answer — never names, emails or birthdays.</p>
        <p><strong>Your control:</strong> parents can export or delete their child&apos;s data at any time from their parent page.</p>
      </Card>
    </>
  );
}
