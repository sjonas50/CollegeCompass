import type { Metadata } from "next";
import { PageHeading } from "@/components/ui";
import { ParentSignupForm } from "./parent-signup-form";

export const metadata: Metadata = { title: "Parent account" };

export default function ParentSignupPage() {
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
