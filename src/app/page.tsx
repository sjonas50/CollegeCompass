import { redirect } from "next/navigation";
import { ButtonLink, Card } from "@/components/ui";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user));

  return (
    <div className="space-y-8">
      <section className="pt-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Find what you love. Plan how to get there.
        </h1>
        <p className="mt-3 max-w-prose text-lg text-muted">
          College Compass is a personal guide for students in grades 7–12. Discover careers that fit
          you, then build a step-by-step plan for high school, college, and paying for it.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signup">I&apos;m a student</ButtonLink>
          <ButtonLink href="/signup/parent" variant="secondary">
            I&apos;m a parent
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            Sign in
          </ButtonLink>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <h2 className="font-medium">Discover</h2>
          <p className="mt-1 text-sm text-muted">Interest and personality assessments point to careers and majors worth aiming for.</p>
        </Card>
        <Card>
          <h2 className="font-medium">Plan</h2>
          <p className="mt-1 text-sm text-muted">A grade-by-grade roadmap: classes, activities, tests, applications and financial aid.</p>
        </Card>
        <Card>
          <h2 className="font-medium">Keep going</h2>
          <p className="mt-1 text-sm text-muted">Small weekly steps and an encouraging AI counselor who remembers your goals.</p>
        </Card>
      </div>
    </div>
  );
}
