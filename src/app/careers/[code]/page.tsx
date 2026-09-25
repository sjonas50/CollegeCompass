import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { addNorthStarAction, removeNorthStarAction } from "@/app/actions/discover";
import { OnetDataAttribution } from "@/components/attribution";
import { Button, Card, FormMessage, Notice, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { type BigFive, RIASEC_INFO } from "@/lib/assessments/instruments";
import { latestResult } from "@/lib/assessments/service";
import { getCurrentUser } from "@/lib/auth/dal";
import { JOB_ZONE_INFO, getCareer } from "@/lib/careers";
import { collegeSearchHref } from "@/lib/colleges/search";
import { MAX_NORTH_STARS, listNorthStars } from "@/lib/goals";
import { PATHWAY_INFO } from "@/lib/matching/match";
import { WORK_STYLE_INFO, type WorkStyle, distinctiveStyles, strengthsForCareer } from "@/lib/reference/work-styles";
import { getOccupationWorkStyles } from "@/lib/reference/work-styles-db";

function StyleItem({ style, children }: { style: WorkStyle; children?: ReactNode }) {
  const info = WORK_STYLE_INFO[style];
  return (
    <li>
      <span className="font-medium">{info.name}.</span> <span className="text-muted">{info.description}</span>
      {children}
    </li>
  );
}

function StyleList({ styles }: { styles: readonly WorkStyle[] }) {
  return (
    <ul className="mt-2 space-y-2 text-sm">
      {styles.map((style) => (
        <StyleItem key={style} style={style} />
      ))}
    </ul>
  );
}

/**
 * The work styles that most set this career apart (O*NET Distinctiveness Rank). For a student who
 * took the personality activity: the ones that fit their strengths, skills they can build (styles
 * linked to a trait where they're low), and the rest with nothing personal, since no trait is linked
 * to them (see strengthsForCareer). Everyone else sees only the career's styles.
 */
function CareerStrengths({ styles, traits, askToTake }: { styles: WorkStyle[]; traits?: Record<BigFive, number>; askToTake: boolean }) {
  const mine = traits ? strengthsForCareer(styles, traits) : null;
  const personal = mine !== null && mine.helps.length + mine.building.length > 0;
  return (
    <Card>
      <h2 className="font-medium">{mine && mine.helps.length > 0 ? "Where your strengths help" : "Strengths that help in this work"}</h2>
      <p className="mt-1 text-sm text-muted">The work styles that most set this career apart from others.</p>
      {mine && personal ? (
        <>
          {mine.helps.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium">Your strengths that fit</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {mine.helps.map(({ style, strength }) => (
                  <StyleItem key={style} style={style}>
                    {" "}
                    <Link href="/discover/personality" className="underline underline-offset-2">
                      Fits your strength: {strength.label}
                    </Link>
                  </StyleItem>
                ))}
              </ul>
            </>
          )}
          {mine.building.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium">Skills you can build</h3>
              <p className="mt-1 text-sm text-muted">Anyone can grow these with practice, in class, on a team, in a club or at a job.</p>
              <StyleList styles={mine.building} />
            </>
          )}
          {mine.other.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-medium">Also important in this work</h3>
              <StyleList styles={mine.other} />
            </>
          )}
        </>
      ) : (
        <div className="mt-1">
          <StyleList styles={styles} />
        </div>
      )}
      {askToTake && (
        <p className="mt-3 text-sm">
          <Link href="/discover/personality" className="inline-flex min-h-11 items-center underline underline-offset-2">
            Find your strengths to see which of these fit you (5 min)
          </Link>
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        O*NET made these ratings with a mix of AI and expert judgment, so treat them as a starting point.
      </p>
    </Card>
  );
}

export async function generateMetadata({ params }: PageProps<"/careers/[code]">): Promise<Metadata> {
  const career = await getCareer(await getDb(), (await params).code);
  return { title: career?.title ?? "Career" };
}

export default async function CareerPage({ params, searchParams }: PageProps<"/careers/[code]">) {
  const { code } = await params;
  const { starred, limit, from } = await searchParams;
  const db = await getDb();
  const career = await getCareer(db, code);
  if (!career) notFound();

  const user = await getCurrentUser();
  const [stars, styles, personality] = await Promise.all([
    user?.role === "student" ? listNorthStars(db, user.id) : [],
    getOccupationWorkStyles(db, code).then((s) => distinctiveStyles(s)),
    user?.role === "student" ? latestResult(db, user.id, "personality") : null,
  ]);
  const isStar = stars.some((s) => s.occupationCode === code);
  const zone = career.jobZone ? JOB_ZONE_INFO[career.jobZone] : null;
  // Opened from the free quiz's results (?from=quiz), or a student's own results page.
  const results = from === "quiz" ? "/try/results" : user?.role === "student" ? "/discover/results" : null;

  return (
    <div className="space-y-6">
      <PageHeading title={career.title} lead={career.description} />
      {starred && <Notice>Added to your north stars. You can change them anytime.</Notice>}
      {limit && <FormMessage message={`You can have ${MAX_NORTH_STARS} north stars at a time. Remove one from your dashboard first.`} />}

      {user?.role === "student" && (
        <form action={isStar ? removeNorthStarAction : addNorthStarAction}>
          <input type="hidden" name="code" value={code} />
          {/* Kept through the redirect back here, for the way back to the free results. */}
          {from === "quiz" && <input type="hidden" name="from" value="quiz" />}
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

      {styles.length > 0 && (
        <CareerStrengths styles={styles} traits={personality?.scores.traits} askToTake={user?.role === "student" && !personality} />
      )}

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

      <p className="flex flex-wrap gap-x-6 text-sm">
        {results && (
          <Link href={results} className="inline-flex min-h-11 items-center underline">
            Back to my results
          </Link>
        )}
        <Link href="/careers" className="inline-flex min-h-11 items-center underline">
          Search more careers
        </Link>
      </p>
      <OnetDataAttribution />
    </div>
  );
}
