import Link from "next/link";
import { pageList } from "@/lib/colleges/describe";

const linkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-surface px-3 hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Page links for search results. Renders nothing when everything fits on one page. */
export function Pagination({
  page,
  total,
  pageSize,
  hrefFor,
}: {
  page: number;
  total: number;
  pageSize: number;
  hrefFor: (page: number) => string;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const items = pageList(page, last);
  if (!items.length) return null;
  return (
    <nav aria-label="Pages of results" className="mt-6">
      <ul className="flex flex-wrap items-center gap-2 text-sm">
        {page > 1 && (
          <li>
            <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
              Previous<span className="sr-only"> page</span>
            </Link>
          </li>
        )}
        {items.map((item, i) =>
          item === "gap" ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-muted">
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item)}
                aria-current={item === page ? "page" : undefined}
                className={`${linkClass} ${item === page ? "border-accent bg-accent-soft font-semibold" : ""}`}
              >
                <span className="sr-only">Page </span>
                {item}
              </Link>
            </li>
          ),
        )}
        {page < last && (
          <li>
            <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
              Next<span className="sr-only"> page</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
