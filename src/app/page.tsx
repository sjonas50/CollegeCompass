import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { ButtonLink, Notice } from "@/components/ui";
import { getCurrentUser, homePathFor } from "@/lib/auth/dal";
import {
  ArrowIcon,
  BookIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarCheckIcon,
  ChatIcon,
  CheckIcon,
  ChevronIcon,
  CompassIcon,
  EyeIcon,
  FamilyIcon,
  FlagIcon,
  HandIcon,
  HeartIcon,
  LockIcon,
  NoAdsIcon,
  SearchIcon,
  ShieldIcon,
} from "./_home/icons";
import {
  ClassPlanScreen,
  ComparePreview,
  CounselorPreview,
  HeroPreview,
  ParentPreview,
  ResultsScreen,
  WeekScreen,
} from "./_home/previews";
import { QuizNudge } from "./_home/quiz-nudge";

export const metadata: Metadata = {
  title: { absolute: "College Compass: plan your path to college and career" },
  description:
    "An affordable AI guidance counselor for students in grades 7–12. Find careers that fit, follow a plan for every grade, and take small steps each week. Parents follow along.",
};

// Every claim on this page must match what the product does. Sample content is tagged "Example",
// and roadmap step titles are real ones from src/lib/roadmap/milestones.ts.

const wrap = "mx-auto w-full max-w-6xl px-4";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const h2Class = "mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl";
const leadClass = "mt-4 text-lg text-pretty text-muted";

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-accent">{children}</p>;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user));
  const { "account-deleted": accountDeleted } = await searchParams;

  return (
    <div data-wide className="overflow-x-clip">
      {accountDeleted && (
        <div className={`${wrap} pt-6`}>
          <Notice>Your account and everything in it were deleted.</Notice>
        </div>
      )}
      <Hero />
      <SourceStrip />
      <HowItWorks />
      <GradeBands />
      <Colleges />
      <Counselor />
      <Parents />
      <Questions />
      <GetStarted />
    </div>
  );
}

/* ───────────────────────── Hero ───────────────────────── */

const HERO_TRUST = [
  { icon: CheckIcon, text: "14 days free, no card needed" },
  { icon: HandIcon, text: "Free access if cost is a problem" },
  { icon: NoAdsIcon, text: "No ads. We never sell data." },
  { icon: HeartIcon, text: "Crisis help is never behind a paywall" },
];

function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="relative isolate border-b border-border">
      {/* Faint grid that fades out toward the edges. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-50 [mask-image:radial-gradient(ellipse_70%_60%_at_60%_30%,black,transparent)] dark:opacity-25"
      />
      <div className={`${wrap} grid items-center gap-14 pb-16 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12 lg:pb-20 lg:pt-16`}>
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-sm font-medium text-muted">
            <CompassIcon className="size-4 text-accent" />
            Grades 7–12 · For students and parents
          </p>
          <h1 id="hero-heading" className="mt-5 text-4xl font-semibold leading-[1.12] tracking-tight sm:text-5xl lg:text-[3.5rem] lg:leading-[1.1]">
            Plan your path to{" "}
            {/* On phones the phrase may wrap, so it's underlined with text decoration; wider, a drawn stroke. */}
            <span className="relative text-accent underline decoration-amber-400 decoration-[0.08em] underline-offset-[0.14em] [text-decoration-skip-ink:none] sm:whitespace-nowrap sm:no-underline dark:decoration-amber-300">
              college and career
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 300 12"
                preserveAspectRatio="none"
                className="absolute -bottom-[0.1em] left-0 hidden h-[0.16em] w-full text-amber-400 sm:block dark:text-amber-300"
              >
                <path d="M3 9C70 3 170 1.5 297 5.5" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              </svg>
            </span>
            , one week at a time.
          </h1>
          <p className="mt-6 text-lg text-pretty text-muted sm:text-xl sm:leading-relaxed">
            College Compass is an affordable AI guidance counselor. Find careers that fit you, get a plan for every grade, and
            know your next step each week.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup" className="gap-2 px-5 text-base">
              Start free as a student
              <ArrowIcon className="size-4" />
            </ButtonLink>
            <ButtonLink href="/signup/parent" variant="secondary" className="px-5 text-base">
              I&apos;m a parent
            </ButtonLink>
          </div>
          <ul className="mt-7 grid justify-start gap-x-6 gap-y-2.5 text-sm min-[400px]:grid-cols-[auto_auto]">
            {HERO_TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="mt-px size-4 text-accent" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <HeroPreview />
      </div>
    </section>
  );
}

/* ───────────────────────── Data strip ───────────────────────── */

const SOURCES = [
  { icon: BriefcaseIcon, strong: "About 1,000 careers", rest: "from the U.S. Department of Labor" },
  { icon: BuildingIcon, strong: "About 5,800 colleges", rest: "from the U.S. Department of Education" },
  { icon: CheckIcon, strong: "Research-based activities", rest: "scored by code, not by AI" },
  { icon: BookIcon, strong: "A guide to paying for college", rest: "in English and Spanish" },
];

function SourceStrip() {
  return (
    <section aria-labelledby="sources-heading" className="border-b border-border bg-surface">
      <div className={`${wrap} py-8`}>
        <div className="flex flex-wrap items-center justify-between gap-x-6">
          <h2 id="sources-heading" className="text-sm font-semibold">
            Built on real data and research
          </h2>
          <Link href="/about/data" className={`inline-flex min-h-11 items-center gap-1 text-sm text-muted underline underline-offset-2 hover:text-foreground ${focusRing}`}>
            Where our data comes from
          </Link>
        </div>
        <ul className="mt-3 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          {SOURCES.map(({ icon: Icon, strong, rest }) => (
            <li key={strong} className="flex items-start gap-3 text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-[18px]" />
              </span>
              <span>
                <span className="block font-medium">{strong}</span> <span className="block text-muted">{rest}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────────────────────── How it works ───────────────────────── */

const HOW = [
  {
    n: 1,
    title: "Find your direction",
    text: "Three short activities show what you like, how you work and what matters to you. Then see careers that fit, with pay, schooling and job outlook. Pick one or two as your north star, for now.",
    facts: [
      "Interests: 60 quick activities, about 10 min",
      "Personality: 20 statements, about 5 min",
      "What matters to you: rank 6 values, about 2 min",
    ],
    screen: <ResultsScreen />,
  },
  {
    n: 2,
    title: "Make a plan",
    text: "Get a roadmap for every grade: classes, activities, tests, applications and paying for college. It spells out the unwritten rules that families with private counselors already know.",
    facts: [
      "Roadmap steps picked with care, not made up by AI",
      "A class plan that fits the majors you like",
      "A college list with deadlines, when you're ready",
    ],
    screen: <ClassPlanScreen />,
  },
  {
    n: 3,
    title: "Keep moving",
    text: "Each week, pick one to three small steps. Your AI counselor remembers your goals, asks how last week went and cheers you on.",
    facts: [
      "One to three small steps a week",
      "Check-ins from your AI counselor",
      "A weekly reminder email (for kids under 13, it goes to a parent)",
    ],
    screen: <WeekScreen />,
  },
];

function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="py-16 sm:py-20">
      <div className={wrap}>
        <div className="max-w-2xl">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-heading" className={h2Class}>
            From &ldquo;I don&apos;t know&rdquo; to &ldquo;here&apos;s my plan&rdquo;
          </h2>
          <p className={leadClass}>
            School counselors work hard, but many have too many students to guide each one closely. College Compass walks you
            through it in three parts.
          </p>
        </div>
        {/* On wide screens each card spans four shared rows, so screens, titles, text and facts line up. */}
        <ol className="mt-12 grid gap-6 lg:grid-cols-3 lg:gap-y-0">
          {HOW.map((h) => (
            <li key={h.n} className="flex flex-col rounded-2xl border border-border bg-surface p-5 sm:p-6 lg:row-span-4 lg:grid lg:grid-rows-subgrid">
              {h.screen}
              <div className="mt-6 flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">
                  {h.n}
                </span>
                <h3 className="text-xl font-semibold tracking-tight">{h.title}</h3>
              </div>
              <p className="mt-3 text-pretty text-muted">{h.text}</p>
              <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
                {h.facts.map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <CheckIcon className="mt-0.5 size-4 text-accent" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ───────────────────────── Grade bands ───────────────────────── */

const BANDS = [
  {
    id: "explore",
    name: "Explore",
    grades: "Grades 7–8",
    span: [7, 8],
    title: "Find out what you're into.",
    focus: "Discover your interests, get help planning 8th-grade math, and choose your 9th-grade classes.",
    steps: ["Ask 3 adults about their jobs", "Plan your 8th-grade classes, starting with math", "Pick 9th-grade classes and sketch a 4-year plan"],
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-300",
    bar: "bg-emerald-500 dark:bg-emerald-400",
    check: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "build",
    name: "Build",
    grades: "Grades 9–10",
    span: [9, 10],
    title: "Build a plan that fits your goals.",
    focus: "Line up classes that fit the majors you like, find activities you care about, make summers count, and take the PSAT.",
    steps: ["Sketch your four-year class plan", "Line up a free summer plan", "Take the PSAT 10 or PreACT this spring"],
    chip: "bg-accent-soft text-accent",
    bar: "bg-accent",
    check: "text-accent",
  },
  {
    id: "launch",
    name: "Launch",
    grades: "Grades 11–12",
    span: [11, 12],
    title: "Choose where to go and how to pay.",
    focus: "SAT, ACT or test-optional, a college list by fit and net price, essays, the FAFSA and CSS Profile, fee waivers, scholarships and comparing aid offers.",
    steps: ["Go to a free college fair and start a list", "Use fee waivers so applying costs less", "File your FAFSA as soon as you can"],
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-300",
    bar: "bg-amber-500 dark:bg-amber-400",
    check: "text-amber-600 dark:text-amber-400",
  },
];

const ordinal = (g: number) => `${g}th`;

function GradeBands() {
  return (
    <section aria-labelledby="grades-heading" className="border-y border-border bg-surface py-16 sm:py-20">
      <div className={wrap}>
        <div className="max-w-2xl">
          <Eyebrow>Every grade, 7 through 12</Eyebrow>
          <h2 id="grades-heading" className={h2Class}>
            Know what matters now, and what comes next
          </h2>
          <p className={leadClass}>
            Your roadmap grows with you. Its steps come from a list we put together with care, never made up on the spot by AI.
          </p>
        </div>

        {/* Six grades, in their three stages. Each jumps to its stage below. */}
        <nav aria-labelledby="jump-heading" className="mt-10">
          <p id="jump-heading" className="text-sm font-medium">
            Jump to your grade
          </p>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:gap-4 lg:gap-6">
            {BANDS.map((b) => (
              <li key={b.id} className="grid grid-cols-2 gap-1.5">
                {b.span.map((g) => (
                  <a
                    key={g}
                    href={`#${b.id}`}
                    className={`group flex min-h-11 flex-col justify-center gap-1.5 rounded-lg border border-border bg-background px-2 py-2 text-sm font-medium transition-colors hover:border-accent sm:px-3 ${focusRing}`}
                  >
                    <span aria-hidden="true" className={`block h-1.5 rounded-full ${b.bar}`} />
                    <span>
                      {ordinal(g)}
                      <span className="sr-only sm:not-sr-only"> grade</span>
                    </span>
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </nav>

        <ol className="mt-6 grid gap-6 lg:grid-cols-3 lg:gap-y-0">
          {BANDS.map((b) => (
            <li
              key={b.id}
              id={b.id}
              className="flex scroll-mt-4 flex-col rounded-2xl border border-border bg-background p-6 lg:row-span-4 lg:grid lg:grid-rows-subgrid"
            >
              <h3>
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${b.chip}`}>{b.name}</span>{" "}
                <span className="mt-4 block text-3xl font-semibold tracking-tight">{b.grades}</span>
              </h3>
              <p className="mt-2 text-lg font-medium text-balance">{b.title}</p>
              <p className="mt-2 text-pretty text-muted">{b.focus}</p>
              <div className="mt-6 border-t border-border pt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Steps from the roadmap</p>
                <ul className="mt-3 space-y-2.5">
                  {b.steps.map((s) => (
                    <li key={s} className="flex items-start gap-2.5">
                      <CheckIcon className={`mt-0.5 size-5 ${b.check}`} />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex items-start gap-4 rounded-2xl border border-dashed border-border p-5 sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
            <FlagIcon className="size-5" />
          </span>
          <p className="text-pretty">
            <span className="font-semibold">After 12th grade:</span>{" "}
            <span className="text-muted">college, career training or an apprenticeship. The choice is yours.</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Colleges and cost ───────────────────────── */

const COLLEGE_POINTS = [
  { icon: BuildingIcon, text: "About 5,800 colleges from the U.S. Department of Education's College Scorecard" },
  { icon: CheckIcon, text: "Graduation rates and what graduates earn" },
  { icon: CalendarCheckIcon, text: "A college list with application deadlines, and side-by-side comparisons" },
  { icon: LockIcon, text: "The income range you pick stays in your browser. We never collect family income." },
];

function Colleges() {
  return (
    <section aria-labelledby="colleges-heading" className="py-16 sm:py-20">
      <div className={`${wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16`}>
        <div>
          <Eyebrow>Colleges and cost</Eyebrow>
          <h2 id="colleges-heading" className={h2Class}>
            See what college could really cost
          </h2>
          <p className={leadClass}>
            The sticker price is only the start. Net price is what a college costs after grants and scholarships, and it depends
            on your family&apos;s income. College Compass shows it first.
          </p>
          <ul className="mt-8 space-y-4">
            {COLLEGE_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="size-[18px]" />
                </span>
                <span className="pt-1.5 text-pretty">{text}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/colleges"
            className={`mt-6 inline-flex min-h-11 items-center gap-1.5 font-medium text-accent underline-offset-4 hover:underline ${focusRing}`}
          >
            Search colleges free, no account needed
            <ArrowIcon className="size-4" />
          </Link>
        </div>
        <ComparePreview />
      </div>
    </section>
  );
}

/* ───────────────────────── Counselor ───────────────────────── */

const COUNSELOR_POINTS = [
  { icon: ChatIcon, text: "Always says it's an AI. It's not a person or a therapist." },
  { icon: SearchIcon, text: "Looks up colleges and careers in our data instead of guessing." },
  { icon: CalendarCheckIcon, text: "Asks how last week's steps went and cheers you on." },
  { icon: EyeIcon, text: "Your parent's page shows your progress, not your chats with the counselor." },
];

function Counselor() {
  return (
    <section aria-labelledby="counselor-heading" className="border-y border-border bg-surface py-16 sm:py-20">
      <div className={`${wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16`}>
        <div className="lg:order-2">
          <Eyebrow>Your AI counselor</Eyebrow>
          <h2 id="counselor-heading" className={h2Class}>
            A counselor that remembers you
          </h2>
          <p className={leadClass}>
            Ask about classes, careers, college or money. Your counselor knows your results, your goals and your plan, so you
            never have to start over.
          </p>
          <ul className="mt-8 space-y-4">
            {COUNSELOR_POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="size-[18px]" />
                </span>
                <span className="pt-1.5 text-pretty">{text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 rounded-2xl border border-border bg-background p-5">
            <p className="flex items-center gap-2 font-semibold">
              <HeartIcon className="size-5 text-danger" />
              Safety comes first
            </p>
            <p className="mt-2 text-pretty text-muted">
              Every message is checked for safety. If you&apos;re going through something hard, you get caring words and the 988
              Suicide &amp; Crisis Lifeline and Crisis Text Line right away. That help is never behind a paywall.
            </p>
          </div>
        </div>
        <div className="lg:order-1">
          <CounselorPreview />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Parents ───────────────────────── */

const PARENT_POINTS = [
  {
    icon: ShieldIcon,
    title: "Privacy comes first",
    text: "No ads, and we never sell data. Student data is never used to train AI models, and our AI provider never gets names, emails or birthdays.",
  },
  {
    icon: LockIcon,
    title: "You stay in control",
    text: "Children under 13 need a parent's consent to have an account. You can download or delete your child's data, and teens can delete their own account.",
  },
  {
    icon: FamilyIcon,
    title: "One plan for the family",
    text: "A 14-day free trial of everything, with no card needed to sign up. After that, one family plan covers every child in your household.",
  },
];

function Parents() {
  return (
    <section aria-labelledby="parents-heading" className="py-16 sm:py-20">
      <div className={`${wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16`}>
        <div>
          <Eyebrow>For parents</Eyebrow>
          <h2 id="parents-heading" className={h2Class}>
            You see their progress. Their chats aren&apos;t on your page.
          </h2>
          <p className={leadClass}>
            Your child does the exploring and planning. You give consent for children under 13, choose the plan, and follow
            along.
          </p>
          <ul className="mt-8 space-y-6">
            {PARENT_POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-pretty text-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup/parent">Create a parent account</ButtonLink>
            <ButtonLink href="/privacy" variant="secondary">
              Read our privacy details
            </ButtonLink>
          </div>
        </div>
        <div className="space-y-6">
          <ParentPreview />
          <div className="flex items-start gap-4 rounded-2xl border border-accent/40 bg-accent-soft p-5">
            <HandIcon className="mt-0.5 size-6 text-accent" />
            <p className="text-pretty">
              <span className="font-semibold">Cost should never be the reason a student goes without help.</span>{" "}
              <span className="text-muted">
                If paying is a problem, turn on free access from your account. No documents, and no questions about why.
              </span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Questions ───────────────────────── */

const FAQ = [
  {
    q: "Is the counselor a real person?",
    a: "No. It's an AI, and it always says so. It never claims to be a person or a therapist. It knows your child's results, goals and plan, and it looks up facts in our data instead of guessing.",
  },
  {
    q: "Does it replace my child's school counselor?",
    a: "No, it works alongside them. Many roadmap steps send students to their school counselor, like introducing themselves early and planning classes together.",
  },
  {
    q: "What does it cost?",
    a: "Every family starts with a 14-day free trial of everything, with no card needed. After that, one family plan covers every child in your household. If cost is a problem, you can turn on free access from your account. No documents, and no questions about why.",
  },
  {
    q: "My child is under 13. Can they use it?",
    a: "Yes, with your consent. A parent sets up the account for a child under 13, and their weekly reminder emails come to you.",
  },
  {
    q: "Can my teen sign up without me?",
    a: "Yes. Teens 13 and older can make their own account, then invite you from it to follow along. They can also delete their own account.",
  },
  {
    q: "What will I see as a parent?",
    a: "Progress: activities, goals, the roadmap, classes and the college list. Your parent page doesn't show your child's chats with the AI counselor. You can also download or delete your child's data.",
  },
];

function Questions() {
  return (
    <section aria-labelledby="questions-heading" className="border-y border-border bg-surface py-16 sm:py-20">
      <div className={`${wrap} grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)] lg:gap-16`}>
        <div>
          <Eyebrow>Questions</Eyebrow>
          <h2 id="questions-heading" className={h2Class}>
            Questions you might have
          </h2>
          <p className={leadClass}>Straight answers for students and parents.</p>
        </div>
        <div className="border-t border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group border-b border-border">
              <summary
                className={`flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-medium [&::-webkit-details-marker]:hidden ${focusRing}`}
              >
                {f.q}
                <ChevronIcon className="size-5 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <p className="max-w-2xl pb-6 text-pretty text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Get started ───────────────────────── */

const FREE_TOOLS = [
  { href: "/careers", icon: BriefcaseIcon, title: "Explore careers", text: "About 1,000 careers, with pay, schooling and outlook." },
  { href: "/colleges", icon: BuildingIcon, title: "Search colleges", text: "About 5,800 colleges, with net prices for your income range." },
  { href: "/aid", icon: BookIcon, title: "Paying for college", text: "FAFSA, CSS Profile, fee waivers and scholarships, in English and Spanish." },
];

function CompassRose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" aria-hidden="true" focusable="false" className={className}>
      <circle cx="100" cy="100" r="96" strokeWidth="1.5" />
      <circle cx="100" cy="100" r="68" strokeWidth="1.5" />
      <path d="M100 6 114 100 100 194 86 100z" strokeWidth="1.5" />
      <path d="M6 100 100 86 194 100 100 114z" strokeWidth="1.5" />
    </svg>
  );
}

function GetStarted() {
  return (
    <section id="get-started" aria-labelledby="get-started-heading" className="scroll-mt-4 py-16 sm:py-20">
      <div className={wrap}>
        <div className="relative isolate overflow-hidden rounded-3xl bg-accent px-5 py-14 text-accent-foreground sm:px-10 sm:py-16 dark:border dark:border-border dark:bg-accent-soft dark:text-foreground">
          <CompassRose className="absolute -right-24 -top-24 -z-10 hidden size-96 opacity-15 sm:block dark:text-accent" />
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold dark:text-accent">Get started</p>
            <h2 id="get-started-heading" className={h2Class}>
              Start wherever you are
            </h2>
            <p className="mt-4 text-lg text-pretty opacity-90">
              In 7th grade or 12th, there&apos;s a good next step waiting. Try everything free for 14 days, with no card needed to
              sign up.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-4xl gap-5 text-foreground md:grid-cols-2">
            <div className="flex flex-col rounded-2xl bg-surface p-6 shadow-lg sm:p-7 dark:shadow-none">
              <p className="text-sm font-medium text-accent">Grades 7–12</p>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight">I&apos;m a student</h3>
              <p className="mt-3 text-pretty text-muted">
                Take three short activities, see careers that fit you, and build your plan. If you&apos;re under 13, a parent sets
                up your account.
              </p>
              <p className="mt-3 flex-1 text-sm text-pretty text-muted">
                After 14 days, a parent can choose the family plan. If cost is a problem, your family can get free access, with
                no documents and no questions about why.
              </p>
              <ButtonLink href="/signup" className="mt-6 gap-2">
                Create my account
                <ArrowIcon className="size-4" />
              </ButtonLink>
            </div>
            <div className="flex flex-col rounded-2xl bg-surface p-6 shadow-lg sm:p-7 dark:shadow-none">
              <p className="text-sm font-medium text-muted">Parents and guardians</p>
              <h3 className="mt-1 text-2xl font-semibold tracking-tight">I&apos;m a parent</h3>
              <p className="mt-3 text-pretty text-muted">
                Set up your child&apos;s account and follow their progress. One family plan covers every child in your household.
              </p>
              <p className="mt-3 flex-1 text-sm text-pretty text-muted">
                If your teen already has an account, they can invite you from theirs.
              </p>
              <ButtonLink href="/signup/parent" variant="secondary" className="mt-6">
                Create a parent account
              </ButtonLink>
            </div>
          </div>
          <p className="mt-6 text-center text-sm">
            Already have an account?{" "}
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-foreground dark:focus-visible:outline-accent"
            >
              Sign in
            </Link>
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-4xl">
          <h3 className="text-lg font-semibold">Just looking? These are free, with no account.</h3>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            {FREE_TOOLS.map(({ href, icon: Icon, title, text }) => (
              <li key={href}>
                <Link
                  href={href}
                  className={`group flex h-full gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent sm:flex-col sm:gap-0 ${focusRing}`}
                >
                  <Icon className="mt-0.5 size-5 text-accent sm:mt-0" />
                  <span>
                    <span className="flex items-center gap-1 font-medium sm:mt-3">
                      {title}
                      <ArrowIcon className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
                    </span>{" "}
                    <span className="mt-1 block text-sm text-muted">{text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <QuizNudge />
        </div>
      </div>
    </section>
  );
}
