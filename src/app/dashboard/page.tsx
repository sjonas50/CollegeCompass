import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { removeNorthStarAction } from "@/app/actions/discover";
import { Button, ButtonLink, Card, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { INSTRUMENTS, type InstrumentId } from "@/lib/assessments/instruments";
import { type InstrumentStatus, instrumentStatuses } from "@/lib/assessments/service";
import { gradeBand } from "@/lib/auth/age";
import { requireUser } from "@/lib/auth/dal";
import { listNorthStars } from "@/lib/goals";

export const metadata: Metadata = { title: "Your dashboard" };

const BAND_COPY = {
  explore: "Grades 7–8 are for exploring. Let's find subjects and careers that light you up.",
  build: "Grades 9–10 are for building. Let's find a direction and choose classes that fit it.",
  launch: "Grades 11–12 are for launching. Let's make sure your plans fit who you are.",
} as const;

const ORDER: InstrumentId[] = ["interests", "personality", "values"];

function statusText(s: InstrumentStatus) {
  if (s.state === "not_started") return "Not started";
  if (s.state === "in_progress") return `${s.answered} of ${s.total} answered`;
  return "Done";
}

export default async function DashboardPage() {
  const user = await requireUser(["student"]);
  const db = await getDb();
  const [statuses, stars] = await Promise.all([instrumentStatuses(db, user.id), listNorthStars(db, user.id)]);
  const band = gradeBand(user.grade ?? 9);
  const next = ORDER.find((i) => statuses[i].state !== "done");
  const hasResults = statuses.interests.state === "done";

  return (
    <div className="space-y-8">
      <PageHeading title={`Hi, ${user.displayName}!`} lead={BAND_COPY[band]} />

      {stars.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Your north stars</h2>
          <p className="mb-3 text-sm text-muted">Careers you&apos;re aiming for, for now. You can change them anytime.</p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {stars.map((s) => (
              <li key={s.occupationCode}>
                <Card className="flex items-start justify-between gap-2">
                  <Link href={`/careers/${s.occupationCode}`} className="font-medium underline-offset-2 hover:underline">
                    {s.title}
                  </Link>
                  <form action={removeNorthStarAction}>
                    <input type="hidden" name="code" value={s.occupationCode} />
                    <input type="hidden" name="back" value="dashboard" />
                    <button type="submit" className="text-sm text-muted underline">Remove</button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Discover your direction</h2>
        <p className="mb-3 text-sm text-muted">Three short activities. Start with interests — it unlocks your career matches.</p>
        <ol className="space-y-3">
          {ORDER.map((id, i) => {
            const s = statuses[id];
            return (
              <li key={id}>
                <Link
                  href={`/discover/${id}`}
                  className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 hover:border-accent"
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      s.state === "done" ? "bg-accent text-accent-foreground" : "border border-border text-muted"
                    }`}
                    aria-hidden
                  >
                    {s.state === "done" ? "✓" : i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="block font-medium">{INSTRUMENTS[id].title}</span>
                    <span className="block text-sm text-muted">{INSTRUMENTS[id].tagline}</span>
                  </span>
                  <span className="text-sm text-muted">{statusText(s)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2">
          {hasResults && <ButtonLink href="/discover/results">See my career matches</ButtonLink>}
          {next && (
            <ButtonLink href={`/discover/${next}`} variant={hasResults ? "secondary" : "primary"}>
              {statuses[next].state === "in_progress" ? "Keep going" : `Start ${INSTRUMENTS[next].title.toLowerCase()}`}
            </ButtonLink>
          )}
          <ButtonLink href="/careers" variant="secondary">Explore careers</ButtonLink>
        </div>
      </section>

      <form action={logoutAction}>
        <Button type="submit" variant="secondary">Sign out</Button>
      </form>
    </div>
  );
}
