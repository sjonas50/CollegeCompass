import type { Metadata } from "next";
import { hasUnder13Gate } from "@/lib/auth/cookies";
import { StudentSignup } from "./student-signup";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage() {
  return <StudentSignup startWithParentStep={await hasUnder13Gate()} />;
}
