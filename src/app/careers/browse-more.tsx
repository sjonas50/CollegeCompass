import Link from "next/link";
import type { Riasec } from "@/lib/assessments/instruments";
import { AREA_BROWSE_NAMES, browseHref } from "@/lib/career-areas";

/** Classes for a link styled as a choice among several (interest areas, preparation levels), marked when `chosen`. */
export function chipClass(chosen = false) {
  const base =
    "inline-flex min-h-11 items-center gap-1 rounded-lg border px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return `${base} ${chosen ? "border-accent bg-accent-soft font-semibold" : "border-border bg-surface hover:bg-background"}`;
}

/**
 * On a results page, below the matches: links to browse every career built around each of the
 * student's top interest areas (/careers?area=). Nothing when no area stands out: those pages
 * already link to /careers.
 */
export function BrowseMoreCareers({ areas }: { areas: Riasec[] }) {
  if (areas.length === 0) return null;
  return (
    <section aria-labelledby="browse-more-heading">
      <h2 id="browse-more-heading" className="text-lg font-medium">
        Want more ideas?
      </h2>
      <p className="mb-3 text-sm text-muted">Browse all the careers built around each of your top interests.</p>
      <ul className="flex flex-wrap gap-2 text-sm">
        {areas.map((a) => (
          <li key={a}>
            <Link href={browseHref(a)} className={chipClass()}>
              {AREA_BROWSE_NAMES[a]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
