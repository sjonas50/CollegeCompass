import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ButtonLink, Card, PageHeading } from "@/components/ui";
import { requireUser } from "@/lib/auth/dal";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata: Metadata = { title: "Delete my account" };

/**
 * A teen who owns their account deletes it. A child a parent set up under 13 is told to ask that
 * parent, who deletes it from the parent page. Never gated by access: privacy controls stay free.
 */
export default async function DeleteMyAccountPage() {
  const user = await requireUser(["student", "parent"]);
  if (user.role === "parent") redirect("/parent/delete");

  if (user.parentManaged) {
    return (
      <>
        <PageHeading
          title="Deleting your account"
          lead="Your parent or guardian set up your account, so they're the one who can delete it."
        />
        <Card>
          <p className="text-sm">
            Ask them to sign in to College Compass and choose &ldquo;Delete&rdquo; next to your name on their parent page.
          </p>
          <div className="mt-3">
            <ButtonLink href="/dashboard" variant="secondary">
              Back to dashboard
            </ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeading
        title="Delete your account?"
        lead="This permanently deletes your account and everything in it. It can't be undone."
      />
      <div className="space-y-6">
        <Card>
          <h2 className="font-medium">What gets deleted</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>Your assessment answers and results, and your career matches and goals</li>
            <li>Your class plan, roadmap, weekly steps and college list</li>
            <li>Your chats with the counselor and what it remembers about you</li>
          </ul>
          <p className="mt-3 text-sm">
            If a parent or guardian is linked to your account, they won&apos;t see your progress any more. If you&apos;re the
            only one in your family&apos;s account, its plan or free access ends too.
          </p>
          <p className="mt-3 text-sm">Want to keep a copy? Download your data first.</p>
          <div className="mt-2">
            <ButtonLink href={`/api/parent/children/${user.id}/export`} variant="secondary" prefetch={false}>
              Download my data
            </ButtonLink>
          </div>
        </Card>
        <Card>
          <h2 className="font-medium">Confirm with your password</h2>
          <p className="mt-1 mb-3 text-sm text-muted">So nobody else using this device can delete your account.</p>
          <DeleteAccountForm />
        </Card>
      </div>
    </>
  );
}
