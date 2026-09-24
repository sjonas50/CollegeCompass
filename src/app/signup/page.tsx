import type { Metadata } from "next";
import { hasUnder13Gate } from "@/lib/auth/cookies";
import { getCurrentUser } from "@/lib/auth/dal";
import { AlreadySignedIn } from "./already-signed-in";
import { StudentSignup } from "./student-signup";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const user = await getCurrentUser();
  if (user) return <AlreadySignedIn user={user} creating="student" />;
  // "Save my results" on /try/results links here with ?from=quiz.
  const { from } = await searchParams;
  return <StudentSignup startWithParentStep={await hasUnder13Gate()} savingQuiz={from === "quiz"} />;
}
