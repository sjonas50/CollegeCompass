import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { resultRange } from "@/lib/colleges/describe";
import { formatCount } from "@/lib/colleges/format";
import {
  type CollegeSearchFilters,
  type MajorQueryResult,
  type ProgramMatch,
  collegeSearchHref,
  parseCollegeSearchParams,
  programTitle,
  resolveMajorQuery,
  searchColleges,
} from "@/lib/colleges/search";
import { CollegeCard } from "./college-card";
import { IncomeBandPicker } from "./income-band";
import { Pagination } from "./pagination";
import { SearchForm } from "./search-form";
import { NumbersExplainer, ScorecardAttribution } from "./shared";

export const metadata: Metadata = {
  title: "Find colleges",
  description: "Compare colleges and training schools by net price for your family's income, graduation rate and earnings.",
};

export default async function CollegesPage({ searchParams }: PageProps<"/colleges">) {
  const { filters, majorQuery } = parseCollegeSearchParams(await searchParams);
  const db = await getDb();

  // A major comes from ?major= (e.g. from a career page) or from words typed in the major field.
  let majorTitle: string | null = null;
  let choices: Extract<MajorQueryResult, { kind: "choices" }> | null = null;
  let majorNotFound: string | null = null;
  if (filters.major) {
    majorTitle = await programTitle(db, filters.major);
  } else if (majorQuery) {
    const resolved = await resolveMajorQuery(db, majorQuery);
    if (resolved.kind === "match") {
      filters.major = resolved.major.cip4;
      majorTitle = resolved.major.title;
    } else if (resolved.kind === "choices") {
      choices = resolved;
    } else {
      majorNotFound = majorQuery;
    }
  }

  // While typed words match several majors, ask which one before searching.
  const result = choices ? null : await searchColleges(db, filters);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Find colleges"
        lead="Compare four-year colleges, community colleges and career schools. We show the net price, what students actually paid after grants, before the sticker price."
      />

      <SearchForm filters={filters} majorTitle={majorTitle} majorQuery={filters.major ? null : majorQuery} />

      {choices && <MajorChoices query={majorQuery ?? ""} choices={choices.choices} more={choices.more} filters={filters} />}

      {majorNotFound !== null && (
        <p role="status" className="rounded-lg bg-accent-soft px-4 py-3 text-sm">
          We couldn&apos;t find a major matching &ldquo;{majorNotFound}&rdquo;, so these results include every major. Try a
          shorter or more general word, like &ldquo;nurs&rdquo;, &ldquo;business&rdquo; or &ldquo;auto&rdquo;.
        </p>
      )}

      {result && (
        <>
          {result.total > 0 && (
            <section aria-labelledby="income-heading" className="rounded-xl border border-border bg-surface p-5">
              <h2 id="income-heading" className="font-medium">
                Prices for families like yours
              </h2>
              <p className="mt-1 mb-3 text-sm text-muted">
                What a college costs depends a lot on family income. Colleges report what students in each income range paid.
              </p>
              <IncomeBandPicker />
            </section>
          )}
          <Results filters={filters} result={result} />
        </>
      )}

      <NumbersExplainer />
      <ScorecardAttribution />
    </div>
  );
}

function MajorChoices({
  query,
  choices,
  more,
  filters,
}: {
  query: string;
  choices: ProgramMatch[];
  more: boolean;
  filters: CollegeSearchFilters;
}) {
  return (
    <section aria-labelledby="major-choices-heading" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="major-choices-heading" className="font-medium">
        Which major do you mean?
      </h2>
      <p className="mt-1 text-sm text-muted">
        A few majors match &ldquo;{query}&rdquo;. Pick one to see colleges that offer it.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {choices.map((m) => (
          <li key={m.cip4}>
            <Link
              href={collegeSearchHref({ ...filters, major: m.cip4, page: undefined })}
              className="flex min-h-11 items-center py-2 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {m.title}
            </Link>
          </li>
        ))}
      </ul>
      {more && (
        <p className="mt-2 text-sm text-muted">
          There are more matches. Add another word from the major&apos;s name to narrow the list.
        </p>
      )}
    </section>
  );
}

function Results({ filters, result }: { filters: CollegeSearchFilters; result: Awaited<ReturnType<typeof searchColleges>> }) {
  const range = resultRange(result.total, result.page, result.pageSize);
  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" className="text-lg font-medium">
        {result.total === 0
          ? "No colleges found"
          : `${formatCount(result.total)} ${result.total === 1 ? "college" : "colleges"}`}
      </h2>
      {range && (
        <p className="text-sm text-muted">
          {result.total > result.pageSize && (
            <>
              Showing {formatCount(range.from)}–{formatCount(range.to)}.{" "}
            </>
          )}
          <a href="#what-numbers-mean" className="inline-flex min-h-11 items-center underline underline-offset-2">
            What do these numbers mean?
          </a>
        </p>
      )}

      {result.total === 0 ? (
        <EmptyState filters={filters} />
      ) : (
        <ul className="mt-3 space-y-4">
          {result.results.map((college) => (
            <CollegeCard key={college.unitId} college={college} major={filters.major} />
          ))}
        </ul>
      )}

      <Pagination
        page={result.page}
        total={result.total}
        pageSize={result.pageSize}
        hrefFor={(page) => collegeSearchHref({ ...filters, page })}
      />
    </section>
  );
}

function EmptyState({ filters }: { filters: CollegeSearchFilters }) {
  const tips = [
    "Remove a filter or two. Each one makes the list smaller.",
    filters.q && "Check the spelling, or type just part of the name, like “state” or “tech”.",
    filters.major && "Try a broader major. Some programs go by a different name, like “business” instead of “marketing”.",
    filters.major && filters.credential && "Try any type of program. Some majors are offered only as a certificate or only as a degree.",
    filters.state && "Try a nearby state, or pick “Any state”.",
    !filters.includeOnlineOnly && "Colleges where every class is online are hidden. Check that box under “More filters” to include them.",
  ].filter((t): t is string => Boolean(t));
  return (
    <div className="mt-3 rounded-xl border border-border bg-surface p-5">
      <p>No colleges match all of these choices. That happens! Here are some ideas:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <ButtonLink href="/colleges" variant="secondary" className="mt-4">
        Start a new search
      </ButtonLink>
    </div>
  );
}
