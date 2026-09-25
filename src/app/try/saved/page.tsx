import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, Card, FormMessage, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { listChildren } from "@/lib/accounts";
import { strongAreasText } from "@/lib/assessments/interest-pattern";
import { undoableImport } from "@/lib/assessments/import";
import { latestResult } from "@/lib/assessments/service";
import { getCurrentUser } from "@/lib/auth/dal";
import { ForgetAndContinue, ForgetSavedQuiz } from "./forget-and-continue";
import { RemoveImportButton } from "./remove-import";

export const metadata: Metadata = { title: "Results saved", robots: { index: false } };

/**
 * Where account creation lands after bringing in the free quiz: a student's own signup, or a
 * parent creating a child's account. The browser's copy is cleared only once the account (or one
 * of the parent's children) holds interest results, so the same answers can't be added to a
 * second account. On a shared computer the quiz may have been someone else's, so a student can
 * take the results back out here and take the quiz themselves.
 */
export default async function SavedPage({ searchParams }: PageProps<"/try/saved">) {
  const user = await getCurrentUser();
  const db = await getDb();

  if (user?.role === "parent") {
    const children = await listChildren(db, user.id);
    const results = await Promise.all(children.map((c) => latestResult(db, c.id, "interests")));
    if (!results.some(Boolean)) redirect("/parent?added=1");
    return (
      <>
        <PageHeading title="You're all set" />
        <ForgetAndContinue href="/parent?added=1&imported=1" message="The quiz results are saved to your child's account." />
      </>
    );
  }

  if (user?.role !== "student") redirect("/try/results");
  if (!(await latestResult(db, user.id, "interests"))) redirect("/dashboard");
  const [imported, { undo }] = await Promise.all([undoableImport(db, user.id), searchParams]);
  const top = imported && strongAreasText(imported.areas);
  return (
    <>
      <PageHeading title="You're all set" />
      <ForgetSavedQuiz />
      <div className="space-y-4">
        {undo === "failed" && (
          <FormMessage message="We couldn't remove those results. They may already be gone, or it's been too long to take them back." />
        )}
        <Card className="space-y-4">
          <p>
            Your quiz results are saved to your account.
            {imported && (top ? <> Your top interests are {top}.</> : <> You rated all six interest areas about the same.</>)}
          </p>
          <ButtonLink href="/discover/results">See my career matches</ButtonLink>
        </Card>
        {imported && (
          <Card className="space-y-3">
            <h2 className="font-medium">Not your answers?</h2>
            <p className="text-sm text-muted">
              If someone else took the quiz on this device, you can remove these results. Then you can take the quiz
              yourself right away.
            </p>
            <RemoveImportButton attemptId={imported.attemptId} />
          </Card>
        )}
      </div>
    </>
  );
}
