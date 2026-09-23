import type { Metadata } from "next";
import { PageHeading } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { ChildAccountForm } from "../../child-account-form";

export const metadata: Metadata = { title: "Add a child" };

export default async function NewChildPage() {
  await requireUser(["parent"]);
  return (
    <>
      <PageHeading title="Add a child" lead="Create a student account your child will sign in with." />
      <ChildAccountForm />
    </>
  );
}
