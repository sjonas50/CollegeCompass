import type { Metadata } from "next";
import Link from "next/link";
import { acceptParentInviteAction, signOutForInviteAction } from "@/app/actions/invites";
import { ParentSignupForm } from "@/app/signup/parent/parent-signup-form";
import { Button, ButtonLink, Card, FormMessage, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { isLinkedParent } from "@/lib/accounts";
import { getCurrentUser } from "@/lib/auth/dal";
import { type AcceptInviteError, findInvite } from "@/lib/invites";

export const metadata: Metadata = { title: "Parent invitation", robots: { index: false, follow: false } };

const ROLE_NAMES = { student: "a student", parent: "a parent", counselor: "a counselor", org_admin: "a school admin", admin: "a staff" } as const;

function errorMessage(error: string | string[] | undefined, name: string): string | null {
  switch (error as AcceptInviteError | undefined) {
    case "student_has_parent":
      return `Another parent or guardian is already linked to ${name}'s account.`;
    default:
      return null;
  }
}

/** What a linked parent can do, matching the parent page and exportStudentData's parent copy. */
function WhatLinkingMeans({ name }: { name: string }) {
  return (
    <Card>
      <h2 className="font-medium">As a linked parent or guardian, you can</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        <li>
          See {name}&apos;s progress and results: interest areas, strengths, top career matches, goals, roadmap, classes
          and college list
        </li>
        <li>Change {name}&apos;s grade and weekly reminder emails</li>
        <li>Manage your family&apos;s plan and billing</li>
        <li>Download a copy of {name}&apos;s data, or delete {name}&apos;s account</li>
      </ul>
      <h2 className="mt-4 font-medium">What stays private</h2>
      <p className="mt-1 text-sm">
        Conversations with the AI counselor stay private to {name}. You won&apos;t see them on your parent page, and
        your download of {name}&apos;s data leaves them out, along with the counselor&apos;s notes and any safety
        flags. {name} keeps their own account and sign-in, and can remove the link from their settings.
      </p>
    </Card>
  );
}

function Unavailable({ title, lead }: { title: string; lead: string }) {
  return (
    <>
      <PageHeading title={title} lead={lead} />
      <p className="text-sm text-muted">
        <Link href="/" className="underline">Learn about College Compass</Link>
      </p>
    </>
  );
}

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const [invite, user] = await Promise.all([findInvite(db, token), getCurrentUser()]);

  if (invite.status === "not_found") {
    return (
      <Unavailable
        title="We couldn't find this invitation"
        lead="The link may be incomplete, or the invitation was cancelled. Ask your teen to send a new one from their College Compass dashboard."
      />
    );
  }
  if (invite.status === "expired") {
    return (
      <Unavailable
        title="This invitation has expired"
        lead="For your family's privacy, invitations only last 14 days. Ask your teen to send a new one from their College Compass dashboard."
      />
    );
  }
  if (invite.status === "used") {
    if (user && user.id === invite.acceptedByUserId) {
      return (
        <>
          <PageHeading title="You're already linked" lead={`You can follow ${invite.studentName}'s progress on your parent page.`} />
          <ButtonLink href="/parent">Go to my parent page</ButtonLink>
        </>
      );
    }
    return (
      <Unavailable
        title="This invitation was already used"
        lead="Each invitation link works once. If you accepted it, sign in to see your teen's progress. If not, ask your teen to send a new one."
      />
    );
  }

  const name = invite.studentName;
  const here = `/invite/${token}`;
  const heading = (
    <PageHeading
      title={`${name} invited you to College Compass`}
      lead={`College Compass helps students in grades 7–12 explore careers and plan for college or training. ${name} would like you to follow along.`}
    />
  );

  if (!user) {
    return (
      <>
        {heading}
        <div className="space-y-6">
          <WhatLinkingMeans name={name} />
          <section aria-labelledby="create-parent-account">
            <h2 id="create-parent-account" className="mb-2 text-lg font-medium">Create your parent account</h2>
            <p className="mb-3 text-sm text-muted">
              Already have one? Use the sign-in link below. Either way, you&apos;ll come back here to accept.
            </p>
            <ParentSignupForm next={here} />
          </section>
        </div>
      </>
    );
  }

  if (user.role !== "parent") {
    return (
      <>
        {heading}
        <Card>
          <h2 className="font-medium">This invitation is for a parent or guardian</h2>
          <p className="mt-1 text-sm">
            You&apos;re signed in as {user.displayName}, {ROLE_NAMES[user.role]} account. If you&apos;re the parent or
            guardian, sign out. This page will open again so you can sign in or create a parent account.
          </p>
          <form action={signOutForInviteAction} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="secondary">Sign out</Button>
          </form>
        </Card>
      </>
    );
  }

  if (await isLinkedParent(db, user.id, invite.studentId)) {
    return (
      <>
        <PageHeading title="You're already linked" lead={`You can follow ${name}'s progress on your parent page.`} />
        <ButtonLink href="/parent">Go to my parent page</ButtonLink>
      </>
    );
  }

  const problem = errorMessage(error, name);
  return (
    <>
      {heading}
      <div className="space-y-6">
        <WhatLinkingMeans name={name} />
        <Card>
          <form action={acceptParentInviteAction} className="space-y-3">
            <FormMessage message={problem ?? undefined} />
            <input type="hidden" name="token" value={token} />
            <p className="text-sm">
              Signed in as {user.displayName}. Accept only if you&apos;re {name}&apos;s parent or guardian.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Accept and link</Button>
              <ButtonLink href="/parent" variant="secondary">Not now</ButtonLink>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
