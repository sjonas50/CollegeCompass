import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addNorthStarAction, removeNorthStarAction } from "@/app/actions/discover";
import { OnetDataAttribution } from "@/components/attribution";
import { Button, Card, FormMessage, Notice, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { RIASEC_INFO } from "@/lib/assessments/instruments";
import { getCurrentUser } from "@/lib/auth/dal";
import { JOB_ZONE_INFO, getCareer } from "@/lib/careers";
import { collegeSearchHref } from "@/lib/colleges/search";
import { MAX_NORTH_STARS, listNorthStars } from "@/lib/goals";
import { PATHWAY_INFO } from "@/lib/matching/match";

export async function generateMetadata({ params }: PageProps<"/careers/[code]">): Promise<Metadata> {
  const career = await getCareer(await getDb(), (await params).code);
  return { title: career?.title ?? "Career" };
}

export default async function CareerPage({ params, searchParams }: PageProps<"/careers/[code]">) {
  const { code } = await params;
  const { starred, limit } = await searchParams;
  const db = await getDb();
  const career = await getCareer(db, code);
  if (!career) notFound();

  const user = await getCurrentUser();
  const stars = user?.role === "student" ? await listNorthStars(db, user.id) : [];
  const isStar = stars.some((s) => s.occupationCode === code);
  const zone = career.jobZone ? JOB_ZONE_INFO[career.jobZone] : null;

  return (
    <div className="space-y-6">
      <PageHeading title={career.title} lead={career.description} />
      {starred && <Notice>Added to your north stars. You can change them anytime.</Notice>}
      {limit && <FormMessage message={`You can have ${MAX_NORTH_STARS} north stars at a time. Remove one from your dashboard first.`} />}

      {user?.role === "student" && (
        <form action={isStar ? removeNorthStarAction : addNorthStarAction}>
          <input type="hidden" name="code" value={code} />
          <Button type="submit" variant={isStar ? "secondary" : "primary"}>
            {isStar ? "Remove from my north stars" : "Make this a north star"}
          </Button>
        </form>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-medium">Getting there</h2>
          <p className="mt-1 text-sm">{PATHWAY_INFO[career.pathway].title.replace(" paths", "")}</p>
          {zone && <p className="mt-1 text-sm text-muted">{zone.detail}</p>}
        </Card>
        <Card>
          <h2 className="font-medium">Who enjoys this work</h2>
          <p className="mt-1 text-sm text-muted">
            People with {career.interests.slice(0, 2).map((i) => RIASEC_INFO[i.area].name).join(" and ")} interests.
          </p>
          <p className="mt-1 text-sm text-muted">{RIASEC_INFO[career.interests[0].area].description}</p>
        </Card>
      </div>

      <Card>
        <h2 className="font-medium">College majors that lead here</h2>
        {career.majors.length > 0 && (
          <ul className="mt-2 divide-y divide-border text-sm">
            {career.majors.map((m) => {
              // Links only where colleges offer the major, so "Find colleges" never leads to an empty search.
              const path = career.majorPaths[m.cipCode];
              return (
                <li key={m.cipCode} className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 py-1">
                  <span>{m.title}</span>
                  {path?.kind === "colleges" && (
                    <Link
                      href={collegeSearchHref({ major: path.cip4 })}
                      className="inline-flex min-h-11 shrink-0 items-center underline underline-offset-2"
                    >
                      Find colleges<span className="sr-only"> for {m.title}</span>
                    </Link>
                  )}
                  {path?.kind === "graduate" && <span className="text-muted">Studied after college</span>}
                </li>
              );
            })}
          </ul>
        )}
        {career.majors.some((m) => career.majorPaths[m.cipCode]?.kind === "graduate") && (
          <p className="mt-2 text-sm text-muted">
            &ldquo;Studied after college&rdquo; means graduate or professional school, like medical school or law school. You
            go to college first.
          </p>
        )}
        {career.majors.length === 0 && (
          <p className="mt-2 text-sm text-muted">This career is usually reached through training or experience rather than a specific major.</p>
        )}
      </Card>

      <p className="text-sm">
        <Link href={user?.role === "student" ? "/discover/results" : "/careers"} className="underline">
          {user?.role === "student" ? "Back to my results" : "Search more careers"}
        </Link>
      </p>
      <OnetDataAttribution />
    </div>
  );
}
