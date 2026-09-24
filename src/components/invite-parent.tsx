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
 */
export async function InviteParentCard() {
  const student = await requireUser(["student"]);
  const state = await inviteCardState(await getDb(), student.id);
  if (!state.eligible) return null;
  return (
    <Card>
      <h2 className="text-lg font-medium">Invite a parent or guardian</h2>
      <p className="mt-1 text-sm text-muted">
        A parent or guardian can follow your progress, help with things like the FAFSA, and take care of paying for
        College Compass. They can&apos;t read your chats with the AI counselor.
      </p>
      <InviteParentForm
        pending={state.pending.map((i) => ({ id: i.id, sentOn: day(i.createdAt), worksUntil: day(i.expiresAt) }))}
        canSend={state.canSend}
        max={MAX_PENDING_INVITES}
      />
    </Card>
  );
}
