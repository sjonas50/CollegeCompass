import { PROGRAM_NOT_REPORTED, formatDollars } from "@/lib/colleges/format";
import type { CollegeProgram, ProgramGroup } from "@/lib/colleges/detail";
import { CREDENTIAL_LABELS } from "@/lib/colleges/labels";

/** Lists longer than this start collapsed so phones aren't one endless scroll. */
const OPEN_LIMIT = 10;

function ProgramOutcomes({ program }: { program: CollegeProgram }) {
  const earnings = formatDollars(program.medianEarnings4yr);
  const debt = formatDollars(program.medianDebt);
  if (!earnings && !debt) return <p className="text-sm text-muted">{PROGRAM_NOT_REPORTED}.</p>;
  return (
    <dl className="mt-1 grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted">Earnings 4 years after finishing</dt>
        <dd className="tabular-nums">{earnings ? `${earnings} a year` : PROGRAM_NOT_REPORTED}</dd>
      </div>
      <div>
        <dt className="text-muted">Typical federal loan debt</dt>
        <dd className="tabular-nums">{debt ?? PROGRAM_NOT_REPORTED}</dd>
      </div>
    </dl>
  );
}

function ProgramList({ programs }: { programs: CollegeProgram[] }) {
  return (
    <ul className="divide-y divide-border">
      {programs.map((p) => (
        <li key={p.cip4} className="py-3">
          <p className="font-medium">{p.title}</p>
          <ProgramOutcomes program={p} />
        </li>
      ))}
    </ul>
  );
}

/** When the student came from a search by major, show that major's outcomes here first. */
export function YourMajor({ groups, cip4 }: { groups: ProgramGroup[]; cip4: string }) {
  const matches = groups.flatMap((g) =>
    g.programs.filter((p) => p.cip4 === cip4).map((p) => ({ ...p, level: g.credentialLevel })),
  );
  if (!matches.length) return null;
  return (
    <div className="rounded-lg bg-accent-soft p-4">
      <h3 className="font-medium">The major you searched for: {matches[0].title}</h3>
      <ul className="mt-2 space-y-3">
        {matches.map((p) => (
          <li key={p.level}>
            <p className="text-sm font-medium">{CREDENTIAL_LABELS[p.level].one}</p>
            <ProgramOutcomes program={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgramGroups({ groups }: { groups: ProgramGroup[] }) {
  if (!groups.length) {
    return (
      <p className="text-sm text-muted">
        This college&apos;s programs aren&apos;t in the College Scorecard data yet. Its website lists what you can study.
      </p>
    );
  }
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Earnings are the typical (median) yearly pay of graduates who got federal aid, 4 years after finishing. Debt is the
        typical federal loan debt of graduates who took out federal loans. Students who didn&apos;t borrow aren&apos;t
        counted. Numbers appear only when enough students graduated to report them.
      </p>
      {groups.map((group) => {
        const headingId = `programs-${group.credentialLevel}`;
        const count = `${group.programs.length} ${group.programs.length === 1 ? "program" : "programs"}`;
        return (
          <section key={group.credentialLevel} aria-labelledby={headingId}>
            <h3 id={headingId} className="font-medium">
              {group.label} <span className="font-normal text-muted">({count})</span>
            </h3>
            {group.programs.length > OPEN_LIMIT ? (
              <details className="group mt-1">
                {/* Left as a list item (not flex) so browsers keep the open/closed triangle. */}
                <summary className="min-h-11 cursor-pointer content-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent">
                  <span className="group-open:hidden">Show all {count}</span>
                  <span className="hidden group-open:inline">Hide the list</span>
                </summary>
                <ProgramList programs={group.programs} />
              </details>
            ) : (
              <ProgramList programs={group.programs} />
            )}
          </section>
        );
      })}
    </div>
  );
}
