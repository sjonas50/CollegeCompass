import { logoutAction } from "@/app/actions/auth";
import { Button, ButtonLink, Card, PageHeading } from "@/components/ui";
import { homePathFor } from "@/lib/auth/dal";
import type { SessionUser } from "@/lib/auth/sessions";

const HOME_LABEL: Partial<Record<SessionUser["role"], string>> = {
  parent: "Go to my parent page",
  student: "Go to my dashboard",
};

/**
 * Signup while someone is already signed in on this device. A new account would quietly replace
 * their session, and a parent filling in the student form would create a separate account that
 * isn't linked to theirs. So this explains the choices instead of showing the form.
 */
export function AlreadySignedIn({ user, creating }: { user: SessionUser; creating: "student" | "parent" }) {
  const parentAddingChild = user.role === "parent" && creating === "student";
  return (
    <>
      <PageHeading title="You're already signed in" lead={`${user.displayName} is signed in on this device.`} />
      <div className="space-y-4">
        <Card className="space-y-4">
          {parentAddingChild && (
            <p>
              To make an account for your child, add them from your parent page. You choose their username and password,
              and you can follow their progress. If they took the free quiz on this device, you can add those results too.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {parentAddingChild && <ButtonLink href="/parent/children/new">Add a child</ButtonLink>}
            <ButtonLink href={homePathFor(user)} variant={parentAddingChild ? "secondary" : "primary"}>
              {HOME_LABEL[user.role] ?? "Continue"}
            </ButtonLink>
          </div>
        </Card>
        <Card className="space-y-3">
          <h2 className="font-medium">Someone else?</h2>
          <p className="text-sm text-muted">To create a new account on this device, sign out first.</p>
          <form action={logoutAction}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
