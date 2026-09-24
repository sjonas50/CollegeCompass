import type { Metadata } from "next";
import Link from "next/link";
import { OnetDataAttribution } from "@/components/attribution";
import { Button, PageHeading } from "@/components/ui";
import { getDb } from "@/db";
import { JOB_ZONE_INFO, searchCareers } from "@/lib/careers";

export const metadata: Metadata = { title: "Explore careers" };

export default async function CareersPage({ searchParams }: PageProps<"/careers">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const results = query ? await searchCareers(await getDb(), query) : [];
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
      {query && (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
          {results.length === 0 && <li className="p-4 text-muted">No careers found. Try a shorter word.</li>}
          {results.map((r) => (
            <li key={r.code}>
              <Link href={`/careers/${r.code}`} className="flex justify-between gap-4 p-4 hover:bg-background">
                <span>{r.title}</span>
                {r.jobZone && <span className="shrink-0 text-sm text-muted">{JOB_ZONE_INFO[r.jobZone]?.label}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8">
        <OnetDataAttribution />
      </div>
    </>
  );
}
