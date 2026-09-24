import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { PageHeading } from "@/components/ui";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";
import { findConsentRequest } from "@/lib/consent/requests";
import { ChildAccountForm } from "../../child-account-form";
import { ParentSignupForm } from "../../../signup/parent/parent-signup-form";

export const metadata: Metadata = { title: "Set up your child's account" };

export default async function ConsentPage({ params }: PageProps<"/parent/consent/[token]">) {
  const { token } = await params;
  const request = await findConsentRequest(await getDb(), token);
  if (!request) {
    return (
      <PageHeading
        title="This link has expired"
        lead="For your family's privacy, these links only last a few days. Ask your child to send a new one, or create a parent account and add them yourself."
      />
    );
  }

  const user = await getCurrentUser();
  const here = `/parent/consent/${token}`;
  if (!user) {
    return (
      <>
        <PageHeading
          title="Your child asked to join College Compass"
          lead="College Compass helps students in grades 7–12 explore careers and plan for college. First, create your parent account."
        />
        <ParentSignupForm next={here} />
      </>
    );
  }
  if (user.role !== "parent") {
    return (
      <PageHeading
        title="This link is for a parent"
        lead={<>You&apos;re signed in with an account that isn&apos;t a parent account. <Link href={homePathFor(user)} className="underline">Go to your home page</Link>, or sign out and open this link again.</>}
      />
    );
  }
  return (
    <>
      <PageHeading title="Set up your child's account" lead="Choose a username and password your child will use to sign in." />
      <ChildAccountForm consentToken={token} />
    </>
  );
}
