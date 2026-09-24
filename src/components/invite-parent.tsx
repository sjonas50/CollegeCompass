import "server-only";
import { InviteParentForm } from "@/app/invite/invite-parent-form";
import { Card } from "@/components/ui";
import { getDb } from "@/db";
import { formatDate, usToday } from "@/lib/applications/dates";
import { requireUser } from "@/lib/auth/dal";
import { MAX_PENDING_INVITES, inviteCardState } from "@/lib/invites";

/** "September 24, 2026", in US time like the rest of the dates students see. */
const day = (d: Date) => formatDate(usToday(d));

/**
 * Lets a teen who signed up on their own invite a parent or guardian to link to their account.
 * Loads its own data, so a page just renders `<InviteParentCard />` (for a signed-in student).
 * Renders nothing for accounts a parent set up, or once a parent is linked.
 *
 * What it promises matches the parent page and exportStudentData: a linked parent's download
 * leaves out counselor chats, memory notes and safety flags.
 */
export async function InviteParentCard() {
  const student = await requireUser(["student"]);
  const state = await inviteCardState(await getDb(), student.id);
  if (!state.eligible) return null;
  return (
    <Card>
      <h2 className="text-lg font-medium">Invite a parent or guardian</h2>
      <p className="mt-1 text-sm text-muted">
        A parent or guardian can help with things like the FAFSA and paying for College Compass. Once you link
        them, they can:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
        <li>see your progress: activities, goals, roadmap, classes and college list</li>
        <li>change your grade and your weekly reminder emails</li>
        <li>manage your family&apos;s plan and billing</li>
        <li>download a copy of your data, or delete your account</li>
      </ul>
      <p className="mt-2 text-sm text-muted">
        They can&apos;t read your chats with the AI counselor. When they download your data, it leaves out your
        chats, what the counselor remembers about you, and any safety flags.
      </p>
      <InviteParentForm
        pending={state.pending.map((i) => ({ id: i.id, sentOn: day(i.createdAt), worksUntil: day(i.expiresAt) }))}
        canSend={state.canSend}
        max={MAX_PENDING_INVITES}
      />
    </Card>
  );
}
