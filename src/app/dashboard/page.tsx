import type { Metadata } from "next";
import { logoutAction } from "@/app/actions/auth";
import { Button, Card, PageHeading } from "@/components/ui";
import { gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Your dashboard" };

const BAND_COPY = {
  explore: "Grades 7–8 are for exploring. We'll help you find subjects and careers that light you up.",
  build: "Grades 9–10 are for building. We'll help you pick classes and activities that fit your goals.",
  launch: "Grades 11–12 are for launching. We'll help with tests, applications and paying for college.",
} as const;

export default async function DashboardPage() {
  const user = await requireUser(["student"]);
  const band = gradeBand(user.grade ?? 9);
  return (
    <>
      <PageHeading title={`Hi, ${user.displayName}!`} lead={BAND_COPY[band]} />
      <Card>
        <h2 className="font-medium">Coming soon: discover your direction</h2>
        <p className="mt-1 text-sm text-muted">
          Short interest and personality assessments will match you with careers and majors to explore.
        </p>
      </Card>
      <form action={logoutAction} className="mt-6">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </>
  );
}
