import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/app/colleges/pagination";
import { OnetDataAttribution } from "@/components/attribution";
import { Button, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { RIASEC, RIASEC_INFO, type Riasec } from "@/lib/assessments/instruments";
import { AREA_BROWSE_NAMES, browseHref, parseBrowseArea, parseBrowseLevel } from "@/lib/career-areas";
import { JOB_ZONE_INFO } from "@/lib/careers";
import { type CareerBrowseResult, browseCareers, careerCountsByArea } from "@/lib/careers-browse";
import { type CareerHit, type CareerSearchResult, findCareers } from "@/lib/careers-search";
import { resultRange } from "@/lib/colleges/describe";
import { formatCount } from "@/lib/colleges/format";
import { chipClass } from "./browse-more";

/** What the page shows: search results (?q=), one interest area (?area=), or the search box and the areas. */
async function readParams(searchParams: PageProps<"/careers">["searchParams"]) {
  const { q, area, level, page } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 60) : "";
  const requested = typeof page === "string" ? Number(page) : 1;
  return { query, area: query ? null : parseBrowseArea(area), level: parseBrowseLevel(level), page: Math.min(requested, 1_000) };
}

export async function generateMetadata({ searchParams }: PageProps<"/careers">): Promise<Metadata> {
  const { area } = await readParams(searchParams);
  return { title: area ? `Careers: ${AREA_BROWSE_NAMES[area]}` : "Explore careers" };
}

/** A /careers search link, with #results so phones land on the list instead of the top. */
function careersHref(query: string, page: number) {
  const params = new URLSearchParams({ q: query });
  if (page > 1) params.set("page", String(page));
  return `/careers?${params}#results`;
}

export default async function CareersPage({ searchParams }: PageProps<"/careers">) {
  const { query, area, level, page } = await readParams(searchParams);
  const db = await getDb();
  const [result, browse, counts] = await Promise.all([
    query ? findCareers(db, query, { page }) : null,
    area ? browseCareers(db, area, { level, page }) : null,
    query || area ? null : careerCountsByArea(db),
  ]);
  return (
    <>
      <PageHeading
        title="Explore careers"
        lead="Search nearly 1,000 careers from the U.S. Department of Labor, or browse them by what you like to do."
      />
      <form className="flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Search careers</label>
        <input
          id="q"
          name="q"
          defaultValue={query}
          placeholder="Try nurse, engineer, designer…"
          className="block min-h-11 w-full rounded-lg border border-border bg-surface px-3"
        />
        <Button type="submit">Search</Button>
      </form>
      {result && <Results query={query} result={result} />}
      {browse && <AreaResults result={browse} />}
      {counts && <AreaPicker counts={counts} />}
      <div className="mt-8">
        <OnetDataAttribution />
      </div>
    </>
  );
}

/** Before a search: the six interest areas to browse, with how many careers each has. */
function AreaPicker({ counts }: { counts: Record<Riasec, number> }) {
  return (
    <section id="browse" aria-labelledby="browse-heading" className="mt-8 scroll-mt-4">
      <h2 id="browse-heading" className="text-lg font-medium">
        Browse by interest area
      </h2>
      <p className="text-sm text-muted">Not sure what to search for? Pick something you like to do.</p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {RIASEC.map((a) => (
          <li key={a}>
            <Link
              href={browseHref(a)}
              className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="font-medium">{AREA_BROWSE_NAMES[a]}</span>
              <span className="block text-sm text-muted">
                {RIASEC_INFO[a].name} · {formatCount(counts[a])} {counts[a] === 1 ? "career" : "careers"}
              </span>
              <span className="mt-1 block text-sm text-muted">{RIASEC_INFO[a].description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CareerList({ careers }: { careers: CareerHit[] }) {
  return (
    <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
      {careers.map((r) => (
        <li key={r.code}>
          <Link href={`/careers/${r.code}`} className="flex justify-between gap-4 p-4 hover:bg-background">
            <span>{r.title}</span>
            {r.jobZone && <span className="shrink-0 text-sm text-muted">{JOB_ZONE_INFO[r.jobZone]?.label}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BrowseLink() {
  return (
    <p className="mt-4 text-sm">
      <Link href="/careers#browse" className="inline-flex min-h-11 items-center underline underline-offset-2">
        Browse careers by interest area
      </Link>
    </p>
  );
}

function Results({ query, result }: { query: string; result: CareerSearchResult }) {
  const range = resultRange(result.total, result.page, result.pageSize);
  const pages = result.total > result.pageSize;
  return (
    <section id="results" aria-labelledby="results-heading" className="mt-6 scroll-mt-4">
      <h2 id="results-heading" className="text-lg font-medium">
        {result.total === 0
          ? "No careers found"
          : `${formatCount(result.total)} ${result.total === 1 ? "career matches" : "careers match"} “${query}”`}
      </h2>
      {result.total === 0 ? (
        <p className="mt-2 text-muted">
          Check the spelling, or try a word for the person who does the job, like &ldquo;biologist&rdquo; instead of
          &ldquo;biology&rdquo;. Or browse careers by what you like to do.
        </p>
      ) : (
        <>
          {pages && range && (
            <p className="text-sm text-muted">
              Titles that match your words most closely come first.{" "}
              Showing {formatCount(range.from)}–{formatCount(range.to)}. Add another word to narrow the list, like
              &ldquo;middle school teacher&rdquo; instead of &ldquo;teacher&rdquo;.
            </p>
          )}
          <CareerList careers={result.results} />
        </>
      )}
      <Pagination page={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(p) => careersHref(query, p)} />
      <BrowseLink />
    </section>
  );
}

/** One interest area's careers, with the other areas and the preparation levels to switch to. */
function AreaResults({ result }: { result: CareerBrowseResult }) {
  const { area, level } = result;
  const range = resultRange(result.total, result.page, result.pageSize);
  const levelLabel = level === null ? null : JOB_ZONE_INFO[level].label.toLowerCase();
  return (
    <section id="results" aria-labelledby="results-heading" className="mt-6 scroll-mt-4">
      {/* Two columns on phones, so the areas don't push the list below the first screen. */}
      <nav aria-label="Interest areas">
        <ul className="grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap">
          {RIASEC.map((a) => (
            <li key={a}>
              <Link
                href={browseHref(a)}
                aria-current={a === area ? "page" : undefined}
                className={`${chipClass(a === area)} h-full w-full sm:w-auto`}
              >
                {AREA_BROWSE_NAMES[a]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <h2 id="results-heading" className="mt-6 text-lg font-medium">
        {AREA_BROWSE_NAMES[area]} <span className="font-normal text-muted">({RIASEC_INFO[area].name})</span>
      </h2>
      <p className="text-sm text-muted">{RIASEC_INFO[area].description}</p>

      {result.all === 0 ? (
        <p className="mt-3">We couldn&apos;t find careers for this area right now. Try searching for one instead.</p>
      ) : (
        <>
          <p className="mt-3">
            {formatCount(result.all)} {result.all === 1 ? "career has" : "careers have"} this as their top interest area, based on
            U.S. Department of Labor data. Most careers mix a few interests.
          </p>

          <nav id="levels" aria-label="How much preparation" className="mt-4 scroll-mt-4">
            <p className="mb-2 text-sm font-medium">How much preparation?</p>
            <ul className="grid grid-cols-2 gap-2 text-sm sm:flex sm:flex-wrap">
              {[{ level: null, count: result.all }, ...result.levels].map((l) => (
                <li key={l.level ?? "all"}>
                  <Link
                    href={browseHref(area, { level: l.level, to: "levels" })}
                    aria-current={l.level === level ? "page" : undefined}
                    className={`${chipClass(l.level === level)} h-full w-full sm:w-auto`}
                  >
                    {l.level === null ? "Any amount" : JOB_ZONE_INFO[l.level].label}{" "}
                    <span className="font-normal text-muted">
                      ({formatCount(l.count)}
                      <span className="sr-only"> {l.count === 1 ? "career" : "careers"}</span>)
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {level !== null && (
              <p className="mt-2 text-sm text-muted">
                {JOB_ZONE_INFO[level].label}: {JOB_ZONE_INFO[level].detail}
              </p>
            )}
          </nav>

          {result.total === 0 ? (
            <p className="mt-4">
              No careers in this area usually need {levelLabel}.{" "}
              <Link href={browseHref(area, { to: "levels" })} className="inline-flex min-h-11 items-center underline underline-offset-2">
                See every level
              </Link>
            </p>
          ) : (
            <>
              {range && (
                <p id="list" className="mt-4 scroll-mt-4 text-sm text-muted">
                  {result.total > result.pageSize && (
                    <>
                      Showing {formatCount(range.from)}–{formatCount(range.to)} of {formatCount(result.total)}.{" "}
                    </>
                  )}
                  {result.collegeTeachingLast ? "Listed A to Z, with college teaching jobs last." : "Listed A to Z."}
                </p>
              )}
              <CareerList careers={result.results} />
            </>
          )}
        </>
      )}
      <Pagination page={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(p) => browseHref(area, { level, page: p, to: "list" })} />
    </section>
  );
}
