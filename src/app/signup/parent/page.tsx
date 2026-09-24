import type { Metadata } from "next";
import { PageHeading } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/dal";
import { AlreadySignedIn } from "../already-signed-in";
import { ParentSignupForm } from "./parent-signup-form";

export const metadata: Metadata = { title: "Parent account" };

export default async function ParentSignupPage() {
  const user = await getCurrentUser();
  if (user) return <AlreadySignedIn user={user} creating="parent" />;
  return (
    <>
      <PageHeading
        title="Create a parent account"
        lead="Set up accounts for your children, follow their progress, and control their data."
      />
      <ParentSignupForm />
    </>
  );
}
