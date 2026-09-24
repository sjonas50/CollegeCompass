import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, Card } from "@/components/ui";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";

const EXPLORE = [
  { href: "/colleges", title: "Explore colleges", text: "Look up colleges and programs, and see what students really pay after grants." },
  { href: "/aid", title: "Paying for college", text: "A plain-language guide to financial aid, the FAFSA and scholarships." },
  { href: "/careers", title: "Browse careers", text: "What people do all day, and the training it takes to get there." },
];

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user));

  return (
    <div className="space-y-10">
      <section className="pt-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Find careers that fit you — free, no account needed
        </h1>
        <p className="mt-3 max-w-prose text-lg text-muted">
          Tell us which activities you&apos;d like, from building things to helping people. In about 10 minutes you&apos;ll
          see your strongest interests and careers that match them.
        </p>
        <div className="mt-6">
          <ButtonLink href="/try" className="w-full sm:w-auto">
            Take the free quiz
          </ButtonLink>
        </div>
        <p className="mt-3 text-sm text-muted">No email, no sign-up, no ads. Your answers stay on your device.</p>
      </section>

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Make a plan that fits you</h2>
          <p className="mt-1 text-sm text-muted">
            College Compass is a personal guide for students in grades 7–12: a grade-by-grade plan for classes, tests,
            college or training and paying for it, with small weekly steps and an AI counselor who remembers your goals.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/signup" variant="secondary">
            I&apos;m a student
          </ButtonLink>
          <ButtonLink href="/signup/parent" variant="secondary">
            I&apos;m a parent
          </ButtonLink>
        </div>
        <p className="text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </Card>

      <section>
        <h2 className="text-lg font-medium">Look around on your own</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {EXPLORE.map((e) => (
            <li key={e.href}>
              <Link href={e.href} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent">
                <span className="font-medium">{e.title}</span>
                <span className="mt-1 block text-sm text-muted">{e.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
