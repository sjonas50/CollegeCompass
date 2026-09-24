import type { AidComparison } from "@/lib/applications/aid";
import { type ScorecardPrice, aidOfferLines } from "@/lib/applications/display";

export const LOWEST_BADGE = "rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium";

/** Plain loan warnings (parent PLUS, private/other loans). */
export function AidWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-2">
      {warnings.map((w) => (
        <li key={w} className="rounded-lg bg-danger-soft px-3 py-2 text-sm">
          {w}
        </li>
      ))}
    </ul>
  );
}

/** One aid offer as a stacked list of amounts: the phone view of the comparison. */
export function AidOfferLinesList({
  comparison,
  scorecard,
}: {
  comparison: AidComparison;
  /** Scorecard context, or undefined to leave that line out. */
  scorecard?: ScorecardPrice;
}) {
  return (
    <dl className="divide-y divide-border text-sm">
      {aidOfferLines(comparison).map((line) => (
        <div key={line.key} className={`flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 ${line.strong ? "font-semibold" : ""}`}>
          <dt>{line.label}</dt>
          <dd className="text-right">
            {line.value}
            {line.note && <span className="block text-left font-normal text-muted sm:text-right">{line.note}</span>}
          </dd>
        </div>
      ))}
      {scorecard && (
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-muted">
          <dt>College Scorecard average net price</dt>
          <dd className="text-right">
            {scorecard.amount ?? ""}
            {scorecard.note && <span className="block text-left sm:text-right">{scorecard.note}</span>}
          </dd>
        </div>
      )}
    </dl>
  );
}
