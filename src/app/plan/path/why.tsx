import type { ResolvedCitation } from "@/lib/planner/engine-io";

// "Why?": the source's own words behind a line, with where they're from and when we checked.
// Links open in a new tab; printed copies show the address.

function formatChecked(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function CitationList({ ids, citations }: { ids: readonly string[]; citations: Record<string, ResolvedCitation> }) {
  const found = [...new Set(ids)].flatMap((id) => (citations[id] ? [citations[id]] : []));
  if (!found.length) return null;
  return (
    <ul className="space-y-3">
      {found.map((c) => (
        <li key={c.id} className="text-sm">
          <blockquote className="border-l-2 border-border pl-3 italic">“{c.quote}”</blockquote>
          <p className="mt-1 pl-3 text-muted">
            <a href={c.source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {c.source.title}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <span className="hidden break-all print:inline"> ({c.source.url})</span>
            {c.pinpoint && <>, {c.pinpoint}</>}. {c.source.publisher}. Checked {formatChecked(c.source.checkedOn)}.
          </p>
        </li>
      ))}
    </ul>
  );
}

/** A collapsed "Why?" with the reasons' source quotes. Renders nothing when there's no source. */
export function Why({
  ids,
  citations,
  label = "Why?",
  srContext,
  className = "mt-1",
}: {
  ids: readonly string[];
  citations: Record<string, ResolvedCitation>;
  label?: string;
  srContext?: string;
  /** Placement; in a flex row, "open:basis-full" lets the opened quotes take the whole width. */
  className?: string;
}) {
  if (!ids.some((id) => citations[id])) return null;
  return (
    <details className={`text-sm ${className}`}>
      <summary className="min-h-11 cursor-pointer content-center font-medium underline-offset-2 hover:underline print:hidden">
        {label}
        {srContext && <span className="sr-only"> {srContext}</span>}
      </summary>
      <div className="mt-1 pb-2">
        <CitationList ids={ids} citations={citations} />
      </div>
    </details>
  );
}
