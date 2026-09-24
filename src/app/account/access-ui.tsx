import Link from "next/link";
import { CRISIS_LINE, FREE_FEATURES, FULL_ACCESS_FEATURES, type AccessSummary } from "@/lib/access/describe";

const linkClass = "inline-flex min-h-11 items-center underline underline-offset-2";

/** The crisis line, with call and text links. Shown on every locked screen. */
export function CrisisLine() {
  return (
    <aside aria-label="Help any time" className="rounded-xl border border-border bg-surface p-4">
      <p className="font-medium">{CRISIS_LINE}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
        <a href="tel:988" className={linkClass}>
          Call 988
        </a>
        <a href="sms:988" className={linkClass}>
          Text 988
        </a>
      </p>
    </aside>
  );
}

const TONE = {
  ok: "border-border bg-surface",
  attention: "border-accent bg-accent-soft",
  locked: "border-border bg-accent-soft",
} as const;

/** "Your free trial has 5 days left." and so on (see describeAccess). */
export function AccessStatus({ summary }: { summary: AccessSummary }) {
  return (
    <section aria-labelledby="access-status-heading" className={`rounded-xl border p-5 ${TONE[summary.tone]}`}>
      <h2 id="access-status-heading" className="sr-only">
        Access right now
      </h2>
      <p className="text-lg font-medium">{summary.headline}</p>
      {summary.detail && <p className="mt-1 text-sm">{summary.detail}</p>}
    </section>
  );
}

/** What never needs full access. */
export function FreeFeatures() {
  return (
    <section aria-labelledby="free-heading" className="space-y-2">
      <h2 id="free-heading" className="text-lg font-medium">
        Always free
      </h2>
      <ul className="space-y-1">
        {FREE_FEATURES.map((f) => (
          <li key={f.href}>
            <Link href={f.href} className={linkClass}>
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What full access adds. */
export function FullAccessFeatures({ heading = "Full access adds" }: { heading?: string }) {
  return (
    <section aria-labelledby="full-heading" className="space-y-2">
      <h2 id="full-heading" className="text-lg font-medium">
        {heading}
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        {FULL_ACCESS_FEATURES.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </section>
  );
}
