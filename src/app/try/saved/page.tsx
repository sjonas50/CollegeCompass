import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { listChildren } from "@/lib/accounts";
import { latestResult } from "@/lib/assessments/service";
import { getCurrentUser } from "@/lib/auth/dal";
import { ForgetAndContinue } from "./forget-and-continue";

export const metadata: Metadata = { title: "Results saved", robots: { index: false } };

/**
 * Where account creation lands after bringing in the free quiz: a student's own signup, or a
 * parent creating a child's account. The browser's copy is cleared only once the account (or one
 * of the parent's children) holds interest results.
 */
export default async function SavedPage() {
  const user = await getCurrentUser();
  const db = await getDb();

  if (user?.role === "parent") {
    const children = await listChildren(db, user.id);
    const results = await Promise.all(children.map((c) => latestResult(db, c.id, "interests")));
    if (!results.some(Boolean)) redirect("/parent?added=1");
    return (
      <>
        <PageHeading title="You're all set" />
        <ForgetAndContinue href="/parent?added=1" message="The quiz results are saved to your child's account." />
      </>
    );
  }

  if (user?.role !== "student") redirect("/try/results");
  if (!(await latestResult(db, user.id, "interests"))) redirect("/dashboard");
  return (
    <>
      <PageHeading title="You're all set" />
      <ForgetAndContinue href="/discover/results" message="Your quiz results are saved to your account." />
    </>
  );
}
