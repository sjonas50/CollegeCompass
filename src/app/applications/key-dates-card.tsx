import Link from "next/link";
import type { KeyDateStatus, KeyDatesYear } from "@/lib/applications/key-dates";

const STATUS_BADGES: Partial<Record<KeyDateStatus, { text: string; className: string }>> = {
  open_now: { text: "Open now", className: "bg-success-soft" },
  usually_open: { text: "Usually open by now", className: "bg-accent-soft" },
  passed:{ text: "Passed", className: "border border-border text-muted" },
};

/**
 * "Key dates this year" for 11th and 12th graders. Seniors see where things stand today; juniors
 * see the same year as a preview of theirs, without "open now" nudges meant for seniors.
 */
export function KeyDatesCard({ year, senior }: { year: KeyDatesYear; senior: boolean }) {
  return (
    <section aria-labelledby="key-dates-heading" className="rounded-xl border border-border bg-surface p-5">
      <h2 id="key-dates-heading" className="text-xl font-semibold">
        Key dates this year
      </h2>
      <p className="mt-1 text-sm text-muted">
        {senior
          ? `How the ${year.schoolYear} school year usually goes for students starting college or training in fall ${year.startsCollege}. Your colleges' own dates are the ones that count, so save them to your list.`
          : `Seniors are applying this school year (${year.schoolYear}). Next fall it's your turn, and the dates are usually close to these.`}
      </p>
      <ol className="mt-4 space-y-4">
        {year.items.map((item) => {
          const badge = senior ? STATUS_BADGES[item.status] : undefined;
          return (
            <li key={item.id} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-4">
              <p className="text-sm font-medium">
                {item.start ? <time dateTime={item.start}>{item.when}</time> : item.when}
                {badge && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.text}</span>}
              </p>
              <div>
                <h3 className="font-medium">{item.title}</h3>
                <p className="mt-1 text-sm">{item.detail}</p>
                {item.link &&
                  (item.link.external ? (
                    <a href={item.link.href} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
                      {item.link.label}
                    </a>
                  ) : (
                    <Link href={item.link.href} className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">
                      {item.link.label}
                    </Link>
                  ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
