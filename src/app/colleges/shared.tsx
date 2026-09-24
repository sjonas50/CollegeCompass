import Link from "next/link";
import type { ReactNode } from "react";
import { MEANINGS, SCORECARD_RELEASE } from "@/lib/colleges/describe";
import { MISSION_LABELS, type Mission } from "@/lib/colleges/labels";

/** Required source notice for College Scorecard data. */
export function ScorecardAttribution() {
  return (
    <p className="text-xs text-muted">
      Data:{" "}
      <a href="https://collegescorecard.ed.gov/data/" className="underline">
        College Scorecard
      </a>
      , U.S. Department of Education ({SCORECARD_RELEASE} data release). Numbers describe past students and can change.{" "}
      <Link href="/about/data" className="underline">
        Data sources
      </Link>
    </p>
  );
}

/** "What these numbers mean": short, plain explanations of every number the explorer shows. */
export function NumbersExplainer({ id = "what-numbers-mean" }: { id?: string }) {
  const items: [string, string][] = [
    ["Net price", MEANINGS.netPrice],
    ["Sticker price", MEANINGS.stickerPrice],
    ["Graduation rate", MEANINGS.completion],
    ["Earnings after college", MEANINGS.earnings],
    ["Student loan debt", MEANINGS.debt],
  ];
  return (
    <section aria-labelledby={id} className="rounded-xl bg-accent-soft p-5">
      <h2 id={id} className="font-medium">
        What these numbers mean
      </h2>
      <dl className="mt-3 space-y-3 text-sm">
        {items.map(([term, meaning]) => (
          <div key={term}>
            <dt className="font-medium">{term}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm">
        Four-year colleges, community colleges and career training programs can all lead to good jobs. The best fit is the
        one that matches your goals and that your family can afford.
      </p>
    </section>
  );
}

const externalButtonClass =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const externalVariants = {
  primary: `${externalButtonClass} bg-accent text-accent-foreground hover:opacity-90`,
  secondary: `${externalButtonClass} border border-border bg-surface hover:bg-background`,
  link: "inline-flex min-h-11 items-center underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
} as const;

/** A link to another website. Opens in a new tab without giving that site access to this one. */
export function ExternalLink({
  href,
  children,
  variant = "link",
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof externalVariants;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={externalVariants[variant]}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
      <span aria-hidden="true" className="ml-1">
        ↗
      </span>
    </a>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs">{children}</span>;
}

export function MissionBadges({ missions, onlineOnly }: { missions: Mission[]; onlineOnly: boolean }) {
  if (!missions.length && !onlineOnly) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Special mission and format">
      {missions.map((m) => (
        <li key={m}>
          <Badge>
            {m === "hbcu" ? (
              <abbr title={MISSION_LABELS[m].label} className="no-underline">
                {MISSION_LABELS[m].short}
              </abbr>
            ) : (
              MISSION_LABELS[m].short
            )}
          </Badge>
        </li>
      ))}
      {onlineOnly && (
        <li>
          <Badge>Online only</Badge>
        </li>
      )}
    </ul>
  );
}
