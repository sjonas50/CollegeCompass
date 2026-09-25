import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { ButtonLink, PageHeading } from "@/components/ui";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";
import type { SessionUser } from "@/lib/auth/sessions";
import { consentLinkStatus } from "@/lib/consent/requests";
import { ChildAccountForm } from "../../child-account-form";
import { ParentSignupForm } from "../../../signup/parent/parent-signup-form";

export const metadata: Metadata = { title: "Set up your child's account" };

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/** Where a parent goes next from a link that can't be used: their page, or sign in to get there. */
function NextStep({ user }: { user: SessionUser | null }) {
  if (user) {
    return <ButtonLink href={homePathFor(user)}>{user.role === "parent" ? "Go to your parent page" : "Go to your home page"}</ButtonLink>;
  }
  return <ButtonLink href="/login?next=/parent">Sign in</ButtonLink>;
}

export default async function ConsentPage({ params }: PageProps<"/parent/consent/[token]">) {
  const { token } = await params;
  const link = await consentLinkStatus(await getDb(), token);
  const user = await getCurrentUser();

  if (link === "used") {
    // A parent clicking the email again: setup is done, so don't invite a second account.
    return (
      <>
        <PageHeading
          title="This link was already used"
          lead="Your child's account was set up with this link, so there's nothing more to do here. You'll find it on your parent page."
        />
        <NextStep user={user} />
      </>
    );
  }
  if (link === "unavailable") {
    return (
      <>
        <PageHeading
          title="This link has expired"
          lead="For your family's privacy, these links only last a few days. If you already set up your child's account, you'll find it on your parent page."
        />
        <NextStep user={user} />
        {!user && (
          <p className="mt-4 text-sm text-muted">
            Not set up yet? Ask your child to send a new link, or{" "}
            <Link href="/signup/parent" className={linkClass}>
              create a parent account
            </Link>{" "}
            and add them yourself.
          </p>
        )}
      </>
    );
  }

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
