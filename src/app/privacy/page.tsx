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
        <p><strong>The free quiz:</strong> if you take it without an account, your answers, including any answers to the optional strengths questions, stay in your browser, and your strengths are worked out there too. To show career matches, we send only the six interest scores, and we don&apos;t keep them. We count how many people finish the quiz each day, without knowing who. For rate limiting we use a scrambled version of your internet address that changes every day. If you create an account, you can add your saved results to it.</p>
        <p><strong>Family income:</strong> it&apos;s optional, and we never collect it. If you pick an income range to see college prices, your choice is saved only in your browser, so you don&apos;t have to pick it again. It&apos;s never sent to us.</p>
        <p><strong>What we never do:</strong> sell data, show ads, or use students&apos; data to train AI models.</p>
        <p><strong>AI:</strong> our AI provider receives what&apos;s needed to answer — never names, emails or birthdays.</p>
        <p><strong>Your control:</strong> parents can download a copy of their child&apos;s data, or delete it, at any time from their parent page. The parent page shows progress and plans, never chats with our AI counselor. Students can download a complete copy of their own data, chats included, from Settings on their dashboard. Teens who own their account (they were 13 or older when it was made) can delete it there too; a parent deletes an account they set up for a child under 13.</p>
        <p><strong>What a parent&apos;s download includes:</strong> if a parent set up the account when their child was under 13, the download has everything we keep about that child, including chats with our AI counselor. Parents have the right to review what we collect from a child under 13. If a teen owns their account (they were 13 or older when it was made), the download has their profile, assessment answers and results, career matches and goals, class plans, roadmap and weekly steps, college list, and the family&apos;s plan. It leaves out the teen&apos;s chats with our AI counselor, the counselor&apos;s notes, any safety flags, and the record of when they used the counselor. Those stay private to the teen.</p>
      </Card>
    </>
  );
}
