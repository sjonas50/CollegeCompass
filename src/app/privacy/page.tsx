import type { Metadata } from "next";
import { Card, PageHeading } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy" };

// DRAFT — to be replaced with counsel-reviewed text before any family uses the product.
export default function PrivacyPage() {
  return (
    <>
      <PageHeading title="Privacy, in plain language" lead="Draft — this page will be finalized with our lawyer before launch." />
      <Card className="space-y-3 text-sm leading-relaxed">
        <p><strong>What we collect:</strong> a first name or nickname, birthday, grade, and what students do in College Compass (assessment answers, class plans, the colleges and programs on their list with any deadlines, notes and aid-offer amounts they enter, and conversations with our AI counselor). Parents give us their name and email.</p>
        <p><strong>Children under 13:</strong> a parent must create the account and give consent first. Before that, we keep only the parent&apos;s email, and delete it if they don&apos;t respond within 7 days.</p>
        <p><strong>The free quiz:</strong> if you take it without an account, your answers stay in your browser. To show career matches, we send only the six interest scores, and we don&apos;t keep them. For rate limiting we use a scrambled version of your internet address that changes every day. If you create an account, you can add your saved results to it.</p>
        <p><strong>Family income:</strong> it&apos;s optional, and we never collect it. If you pick an income range to see college prices, your choice is saved only in your browser, so you don&apos;t have to pick it again. It&apos;s never sent to us.</p>
        <p><strong>What we never do:</strong> sell data, show ads, or use students&apos; data to train AI models.</p>
        <p><strong>AI:</strong> our AI provider receives what&apos;s needed to answer — never names, emails or birthdays.</p>
        <p><strong>Your control:</strong> parents can export or delete their child&apos;s data at any time from their parent page.</p>
      </Card>
    </>
  );
}
