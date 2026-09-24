import type { ReactNode } from "react";
import {
  CheckIcon,
  CompassIcon,
  DownloadIcon,
  LockIcon,
  MailIcon,
  MapIcon,
  StarIcon,
} from "./icons";

/*
 * Drawn previews of College Compass screens for the home page. They follow the color mode because
 * they're HTML, not pictures. Everything in them is sample content about one example 10th grader,
 * "Maya" (first name only), and each is tagged "Example". The drawings are hidden from screen
 * readers; each has a short text description instead, and nothing inside is focusable.
 *
 * Roadmap step titles are real items from src/lib/roadmap/milestones.ts. The colleges and their
 * numbers are made up, and named so ("Example State").
 */

const shadow =
  "shadow-[0_1px_2px_rgb(20_30_60/0.05),0_24px_50px_-24px_rgb(20_30_60/0.3)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_24px_50px_-20px_rgb(0_0_0/0.8)]";
const label = "text-[11px] font-medium uppercase tracking-wide text-muted";

export function ExampleTag() {
  return (
    <span className="shrink-0 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
      Example
    </span>
  );
}

function Tick({ done, round = false }: { done: boolean; round?: boolean }) {
  const shape = round ? "rounded-full" : "rounded-md";
  return done ? (
    <span className={`flex size-5 shrink-0 items-center justify-center ${shape} bg-accent text-accent-foreground`}>
      <CheckIcon className="size-3.5" />
    </span>
  ) : (
    <span className={`size-5 shrink-0 ${shape} border-[1.5px] border-border bg-surface`} />
  );
}

function CounselorBadge({ className = "size-9" }: { className?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground ${className}`}>
      <CompassIcon className="size-[58%]" />
    </span>
  );
}

const bubbleAi = "w-fit max-w-[88%] rounded-2xl rounded-bl-sm bg-background px-3.5 py-2";
const bubbleMe = "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-accent-foreground";

/* ───────────────────────── Hero ───────────────────────── */

const GRADES = [7, 8, 9, 10, 11, 12];
const CURRENT_GRADE = 10;

const HERO_STEPS = [
  { text: "Join one club, team, or career group", done: true, from: "Roadmap" },
  { text: "Ask if you can take the PSAT in October", done: false, from: "Roadmap" },
  { text: "Look up 2 nursing programs near me", done: false, from: "My own" },
];

/** Grades 7 to 12, with the three stages under them. Stays visible on phones. */
function GradeRail() {
  return (
    <div>
      <div className="grid grid-cols-6 gap-1.5">
        {GRADES.map((g) => (
          <div key={g}>
            <span
              className={`block h-1.5 rounded-full ${
                g < CURRENT_GRADE
                  ? "bg-accent"
                  : g === CURRENT_GRADE
                    ? "bg-linear-to-r from-accent from-50% to-border to-50%"
                    : "bg-border"
              }`}
            />
            <span className={`mt-1.5 block text-center text-[11px] tabular-nums ${g === CURRENT_GRADE ? "font-semibold" : "text-muted"}`}>
              {g}
            </span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 text-center text-[11px] text-muted">
        <span>Explore</span>
        <span className="font-semibold text-foreground">Build</span>
        <span>Launch</span>
      </div>
    </div>
  );
}

export function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-xl lg:max-w-none">
      {/* Soft glow behind the preview. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-8 -inset-y-12 -z-10 bg-[radial-gradient(closest-side,var(--accent-soft),transparent)]"
      />
      <div aria-hidden="true">
        {/* The dashboard window */}
        <div className={`rounded-2xl border border-border bg-surface pb-8 sm:ml-10 ${shadow}`}>
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
            </span>
            <span className="mx-auto rounded-md bg-background px-3 py-1 text-xs text-muted">Maya&apos;s dashboard</span>
            <ExampleTag />
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div>
                <p className="text-lg font-semibold tracking-tight">Hi, Maya</p>
                <p className="text-sm text-muted">10th grade · Build</p>
              </div>
            </div>

            <GradeRail />

            <div className="flex items-start gap-3 rounded-xl bg-accent-soft px-4 py-3">
              <StarIcon className="mt-0.5 size-4 text-amber-500 dark:text-amber-300" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted">North star, for now</p>
                <p className="font-semibold">Registered Nurse</p>
                <p className="text-sm text-muted">Fits your Helpers and Thinkers interests</p>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">This week&apos;s steps</p>
                <p className="text-xs text-muted">1 of 3 done</p>
              </div>
              <ul className="mt-3 space-y-2.5">
                {HERO_STEPS.map((s) => (
                  <li key={s.text} className="flex items-start gap-3 text-sm">
                    <Tick done={s.done} />
                    <span className={`min-w-0 flex-1 ${s.done ? "text-muted line-through" : ""}`}>{s.text}</span>
                    <span className="hidden shrink-0 rounded-full bg-background px-2 py-0.5 text-[11px] text-muted min-[400px]:inline">
                      {s.from}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* The counselor check-in, overlapping the window */}
        <div
          className={`relative -mt-6 mr-3 rounded-2xl border border-border bg-surface p-4 sm:mr-auto sm:w-[80%] lg:w-[74%] ${shadow}`}
        >
          <div className="flex items-center gap-3">
            <CounselorBadge />
            <div className="leading-tight">
              <p className="text-sm font-semibold">Your counselor</p>
              <p className="text-xs text-muted">An AI, not a person</p>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <p className={`${bubbleAi} mr-6`}>Hi Maya. Last week you wanted to find a club. Did you pick one?</p>
            <p className={bubbleMe}>I joined the health careers club!</p>
            <p className={`${bubbleAi} mr-6`}>That fits your nursing goal. Nice work. Want to ask about the PSAT next?</p>
          </div>
        </div>
      </div>

      <figcaption className="mt-4 text-center text-xs text-muted sm:ml-10">
        Example: what a 10th grader might see. Maya is a sample student.
        <span className="sr-only">
          {" "}
          Her dashboard shows that she is in 10th grade, the Build stage. Her north star for now is Registered Nurse. This
          week she has three small steps, two from her roadmap and one of her own, and has done one. Her AI counselor asks
          about the club she wanted to join.
        </span>
      </figcaption>
    </figure>
  );
}

/* ───────────────────────── How it works ───────────────────────── */

/** A small drawn screen above each step. Hidden from screen readers: the text under it says the same. */
function MiniScreen({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div aria-hidden="true" className="flex flex-col rounded-xl border border-border bg-background p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted">{title}</p>
        <span className="flex items-center gap-2">
          {aside}
          <ExampleTag />
        </span>
      </div>
      <div className="mt-3 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

const TOP_AREAS = [
  { name: "Social", short: "Helpers", pct: 92 },
  { name: "Investigative", short: "Thinkers", pct: 81 },
  { name: "Artistic", short: "Creators", pct: 64 },
];

export function ResultsScreen() {
  return (
    <MiniScreen title="Your results">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-medium">Top interests</p>
        <p className="text-xs text-muted">
          Your code: <span className="font-semibold text-foreground">SIA</span>
        </p>
      </div>
      <ul className="mt-2 space-y-2">
        {TOP_AREAS.map((a) => (
          <li key={a.name}>
            <span className="text-xs">
              {a.name} <span className="text-muted">· {a.short}</span>
            </span>
            <span className="mt-1 block h-1.5 rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${a.pct}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-3 text-xs font-medium text-muted">Careers that fit you</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium">
          <StarIcon className="size-3 text-amber-500 dark:text-amber-300" />
          Registered Nurses
        </span>
        {["Physical Therapists", "Dietitians"].map((c) => (
          <span key={c} className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium">
            {c}
          </span>
        ))}
      </div>
    </MiniScreen>
  );
}

const CLASS_ROWS = [
  { subject: "Math", classes: ["Algebra I", "Geometry", "Algebra II"] },
  { subject: "Science", classes: ["Physics", "Biology", "Chemistry"] },
  { subject: "Language", classes: ["Spanish I", "Spanish II", "Spanish III"] },
];

export function ClassPlanScreen() {
  return (
    <MiniScreen title="Your class plan">
      <div className="grid grid-cols-3 gap-1.5 text-center text-[11px] text-muted">
        <span>9th</span>
        <span className="font-semibold text-foreground">10th · now</span>
        <span>11th</span>
      </div>
      <div className="mt-1 space-y-1.5">
        {CLASS_ROWS.map((r) => (
          <div key={r.subject}>
            <p className="text-[11px] text-muted">{r.subject}</p>
            <div className="mt-0.5 grid grid-cols-3 gap-1.5">
              {r.classes.map((c, i) => (
                <span
                  key={c}
                  className={`truncate rounded-md px-1.5 py-1 text-center text-xs font-medium ${
                    i === 1 ? "bg-accent text-accent-foreground" : i === 0 ? "bg-surface text-muted" : "border border-border"
                  }`}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-start gap-2 rounded-lg border border-dashed border-border bg-surface px-3 py-2">
        <MapIcon className="mt-0.5 size-3.5 text-accent" />
        <span className="text-xs">
          <span className="text-muted">Next on your roadmap:</span> Pick your 11th-grade classes
        </span>
      </div>
    </MiniScreen>
  );
}

const WEEK_STEPS = [
  { text: "Ask about the PSAT in October", done: true },
  { text: "Talk to the chemistry teacher", done: true },
  { text: "Update my class plan", done: false },
];

export function WeekScreen() {
  return (
    <MiniScreen title="My steps this week" aside={<span className="text-xs text-muted">2 of 3</span>}>
      <ul className="space-y-2">
        {WEEK_STEPS.map((s) => (
          <li key={s.text} className="flex items-start gap-2.5">
            <Tick done={s.done} />
            <span className={s.done ? "text-muted line-through" : ""}>{s.text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto space-y-1.5 pt-3">
        <div className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2">
          <CounselorBadge className="size-5" />
          <span>Two done already. Nice work. One more and your week is complete.</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
          <MailIcon className="size-4 text-accent" />
          <span>Weekly reminder email</span>
        </div>
      </div>
    </MiniScreen>
  );
}

/* ───────────────────────── Colleges ───────────────────────── */

/** A window with a name and an "Example" tag. */
function Frame({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-surface ${shadow} ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">{title}</span>
        <ExampleTag />
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

const COMPARE: { label: string; values: [string, string]; big?: boolean; perYear?: boolean }[] = [
  { label: "Net price for your income range", values: ["$9,800", "$12,400"], big: true, perYear: true },
  { label: "Sticker price before aid", values: ["$26,400", "$58,900"], perYear: true },
  { label: "Graduation rate", values: ["64%", "78%"] },
  { label: "Earnings 10 years after starting", values: ["$48,000", "$61,000"], perYear: true },
];

export function ComparePreview() {
  return (
    <figure>
      <div aria-hidden="true">
        <Frame title="Compare colleges">
          <div className="grid grid-cols-2 gap-4 border-b border-border pb-3">
            <span className="font-semibold">Example State</span>
            <span className="font-semibold">Example College</span>
          </div>
          <div className="divide-y divide-border">
            {COMPARE.map((r) => (
              <div key={r.label} className={r.big ? "py-3" : "py-2.5"}>
                <p className={`text-xs ${r.big ? "font-medium text-accent" : "text-muted"}`}>{r.label}</p>
                <div className="mt-0.5 grid grid-cols-2 gap-4 tabular-nums">
                  {r.values.map((v, i) =>
                    r.big ? (
                      <span key={i}>
                        <span className="text-2xl font-semibold tracking-tight">{v}</span>{" "}
                        <span className="text-xs text-muted">a year</span>
                      </span>
                    ) : (
                      <span key={i} className="text-sm">
                        {v}
                        {r.perYear && <span className="text-xs text-muted"> a year</span>}
                      </span>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-dashed border-border p-3">
            <MapIcon className="mt-0.5 size-4 text-accent" />
            <div className="min-w-0">
              <p className={label}>On the roadmap · 10th grade</p>
              <p className="mt-0.5 text-sm font-medium">Compare a few schools on College Scorecard</p>
            </div>
          </div>
        </Frame>
      </div>
      <figcaption className="sr-only">
        Example comparison of two made-up colleges, with the net price shown first. Example State: net price $9,800 a year,
        sticker price $26,400, graduation rate 64 percent. Example College: net price $12,400 a year, sticker price $58,900,
        graduation rate 78 percent.
      </figcaption>
    </figure>
  );
}

/* ───────────────────────── Counselor ───────────────────────── */

const MEMORY = [
  ["Interests", "Helpers, Thinkers"],
  ["North star", "Registered Nurse, for now"],
  ["Class plan", "Biology now, Chemistry next year"],
  ["Last week", "Joined the health careers club"],
];

export function CounselorPreview() {
  return (
    <figure>
      <div aria-hidden="true">
        <Frame
          title={
            <>
              <CounselorBadge className="size-7" />
              <span>
                Your counselor <span className="font-normal text-muted">· An AI, not a person</span>
              </span>
            </>
          }
        >
          <p className={label}>What your counselor knows</p>
          <dl className="mt-2 divide-y divide-border rounded-xl border border-border text-sm">
            {MEMORY.map(([k, v]) => (
              <div key={k} className="grid gap-0.5 px-3.5 py-2.5 min-[400px]:grid-cols-[6.5rem_1fr] min-[400px]:gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 space-y-2 text-sm">
            <p className={bubbleMe}>I&apos;m worried chemistry next year will be too hard.</p>
            <div className={bubbleAi}>
              <p>
                Lots of students feel that way. Chemistry matters for nursing, so it&apos;s worth a try. Want to start small?
              </p>
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-accent-soft px-2.5 py-2 text-xs font-medium">
                <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
                  <CheckIcon className="size-3" />
                </span>
                Added to this week: ask the chemistry teacher what the class is like
              </p>
            </div>
          </div>
        </Frame>
      </div>
      <figcaption className="sr-only">
        Example: the AI counselor knows Maya&apos;s interests, her north star, her class plan and what she did last week. She
        says she&apos;s worried chemistry will be too hard. The counselor says many students feel that way, and adds one small
        step to her week: ask the chemistry teacher what the class is like.
      </figcaption>
    </figure>
  );
}

/* ───────────────────────── Parents ───────────────────────── */

const PARENT_ROWS = [
  { label: "Activities", value: "3 of 3 done" },
  { label: "North star", value: "Registered Nurse" },
  { label: "10th-grade roadmap", value: "2 of 14 steps done" },
  { label: "Classes", value: "Planned through 11th grade" },
  { label: "College list", value: "2 colleges" },
];

export function ParentPreview() {
  return (
    <figure>
      <div aria-hidden="true">
        <Frame title="Parent page">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold">M</span>
            <div>
              <p className="font-medium leading-tight">Maya</p>
              <p className="text-sm text-muted">10th grade · Build</p>
            </div>
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <LockIcon className="mt-0.5 size-4 text-accent" />
            <span>
              <span className="font-medium">Chats with the AI counselor aren&apos;t shown on this page.</span>{" "}
              <span className="text-muted">You see progress and plans.</span>
            </span>
          </p>
          <dl className="mt-3 divide-y divide-border text-sm">
            {PARENT_ROWS.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-muted">{r.label}</dt>
                <dd className="text-right font-medium">{r.value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-4">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium">
              <DownloadIcon className="size-3.5" />
              Download data
            </span>
            <span className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium">
              Delete account
            </span>
          </div>
        </Frame>
      </div>
      <figcaption className="sr-only">
        Example parent page: it shows the child&apos;s activities, north star, roadmap, classes and college list. It says that
        chats with the AI counselor aren&apos;t shown on the page, and has buttons to download the child&apos;s data or delete
        the account.
      </figcaption>
    </figure>
  );
}
