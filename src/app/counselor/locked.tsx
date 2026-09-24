import { CrisisLine } from "@/app/account/access-ui";
import { ButtonLink } from "@/components/ui";
import { UNLOCK_PATH } from "@/lib/access/describe";

/**
 * The counselor without full access: no chat box, a way to unlock it, and crisis help, which is
 * never locked. Past conversations stay listed below (in the shell) so they can still be deleted.
 */
export function CounselorLocked({ hasConversations }: { hasConversations: boolean }) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="counselor-locked-heading" className="rounded-xl border border-border bg-accent-soft p-5">
        <h2 id="counselor-locked-heading" className="text-lg font-medium">
          Your counselor is part of full access
        </h2>
        <p className="mt-1 text-sm">
          Your family&apos;s access isn&apos;t on right now, so chatting is paused.
          {hasConversations && " Your past conversations are saved, and you can still delete them."}
        </p>
        <div className="mt-3">
          <ButtonLink href={UNLOCK_PATH}>See how to unlock it</ButtonLink>
        </div>
      </section>
      <CrisisLine />
    </div>
  );
}
