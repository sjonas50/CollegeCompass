import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/app/colleges/pagination";
import { OnetDataAttribution } from "@/components/attribution";
import { Button, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { JOB_ZONE_INFO } from "@/lib/careers";
import { type CareerSearchResult, findCareers } from "@/lib/careers-search";
import { resultRange } from "@/lib/colleges/describe";
import { formatCount } from "@/lib/colleges/format";

export const metadata: Metadata = { title: "Explore careers" };

/** A /careers search link, with #results so phones land on the list instead of the top. */
function careersHref(query: string, page: number) {
  const params = new URLSearchParams({ q: query });
  if (page > 1) params.set("page", String(page));
  return `/careers?${params}#results`;
}

export default async function CareersPage({ searchParams }: PageProps<"/careers">) {
  const { q, page } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 60) : "";
  const requested = typeof page === "string" ? Number(page) : 1;
  const result = query ? await findCareers(await getDb(), query, { page: Math.min(requested, 1_000) }) : null;
  return (
    <>
      <PageHeading title="Explore careers" lead="Search nearly 1,000 careers from the U.S. Department of Labor." />
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
      <div className="mt-8">
        <OnetDataAttribution />
      </div>
    </>
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
          &ldquo;biology&rdquo;.
        </p>
      ) : (
        <>
          {pages && range && (
            <p className="text-sm text-muted">
              Best matches first. Showing {formatCount(range.from)}–{formatCount(range.to)}. Add another word to narrow
              the list, like &ldquo;middle school teacher&rdquo; instead of &ldquo;teacher&rdquo;.
            </p>
          )}
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
            {result.results.map((r) => (
              <li key={r.code}>
                <Link href={`/careers/${r.code}`} className="flex justify-between gap-4 p-4 hover:bg-background">
                  <span>{r.title}</span>
                  {r.jobZone && <span className="shrink-0 text-sm text-muted">{JOB_ZONE_INFO[r.jobZone]?.label}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Pagination page={result.page} total={result.total} pageSize={result.pageSize} hrefFor={(p) => careersHref(query, p)} />
    </section>
  );
}
