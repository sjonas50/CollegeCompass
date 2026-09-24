import { usToday } from "./dates";

// "Key dates this year" for 11th and 12th graders. Built only from facts checked against official
// sources (checked September 24, 2026). Anything that varies by college is described as a
// pattern ("often", "check each college"), never as a promise.
//
// Sources:
// [FSA-SPECS] 2027–28 FAFSA Specifications Guide (September 2026 update), Federal Student Aid,
//   https://fsapartners.ed.gov/knowledge-center/library/handbooks-manuals-or-guides/2026-05-05/2027-28-fafsa-specifications-guide-september-2026-update
//   (Volume 1: https://fsapartners.ed.gov/sites/default/files/2026-07/2728FSGVol1.pdf, Volume 2:
//   https://fsapartners.ed.gov/sites/default/files/2026-07/2728FSGVol2FPSScheduleGettingHelp.pdf)
//   Volume 1: "The application will be available to all applicants no later than October 1, 2026."
//   Volume 2 (FPS Schedule): "October 1, 2026 (on or before) Federal Student Aid will launch full
//   functionality of the online 2027–28 FAFSA form, including submission, processing, and
//   corrections, at the same time to all applicants."
// [FSA-DEADLINES] https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines
//   "states and colleges use FAFSA information to award their own grants, scholarships, and loans.
//   But, since some aid is limited, you have to meet the deadlines!" / State deadlines: "Each state
//   has its own deadline." / Colleges: "Each college and career/trade school may have its own
//   deadline." (2027–28 federal deadline: June 30, 2028.)
// [CB-TIMELINE] College Board BigFuture, "12th Grade College Application Timeline",
//   https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/college-application-timeline-12th-grade
//   "October 1 - FAFSA and CSS Profile Opens." "October 1 is the first day you can file the FAFSA."
//   "CSS PROFILE is an online application used by certain colleges and scholarship programs."
//   "January 1- March 1 - Regular applications deadlines are typically around this time."
//   "Prepare early decision/early action or rolling admission applications as soon as possible."
// [CB-EARLY] College Board BigFuture, "Early Decision and Early Action Calendar FAQs",
//   https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/early-decision-and-early-action-calendar
//   "For most schools, November 1 is the deadline for an early decision application. Other schools
//   have their early decision application deadline set in mid-November or even later on
//   December 1." "Generally, early action applications are due in the month of November."
//   "early action is nonbinding ... you can submit an early action application to multiple schools."
// [CB-MAY1] College Board BigFuture, "What is the last day to accept college offers?",
//   https://bigfuture.collegeboard.org/help-center/what-last-day-accept-college-offers
//   "Most colleges give you until May 1 to make your acceptance decision if you applied under
//   regular decision or early action, although it is extremely important to double-check with
//   your college to make sure it doesn't have a different date."
// [CSS] https://cssprofile.collegeboard.org/ — "CSS Profile is free for families who make up to
//   $100,000 a year." Getting started: "submit your CSS Profile by midnight Eastern Time of your
//   earliest priority filing date." Participating colleges:
//   https://profile.collegeboard.org/PPI/participatingInstitutions.aspx

export type KeyDateId = "fafsa" | "css-profile" | "state-aid" | "early-decision" | "early-action" | "regular" | "decision-day";

export type KeyDate = {
  id: KeyDateId;
  /** How the date reads on the page: "By October 1, 2026", "Often November 1". */
  when: string;
  /** First day it applies (YYYY-MM-DD), or null when it's different everywhere. */
  start: string | null;
  /** Last day of a range ("January 1 to March 1"); null for a single day. */
  end: string | null;
  /** Something that opens (and stays open), rather than a deadline. */
  opens: boolean;
  title: string;
  detail: string;
  link?: { href: string; label: string; external: boolean };
};

export type KeyDateStatus = "upcoming" | "open_now" | "passed" | "varies";

/** FAFSA opening dates confirmed by Federal Student Aid, by application cycle. [FSA-SPECS] */
const VERIFIED_FAFSA: Record<number, { awardYear: string; opensBy: string }> = {
  2026: { awardYear: "2027–28", opensBy: "2026-10-01" },
};

const LONG = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const longDate = (iso: string) => LONG.format(new Date(`${iso}T00:00:00Z`));

/**
 * The application cycle a date falls in, named by the year it starts. A cycle runs from June
 * through May: FAFSA and applications in the fall, decisions by spring. Juniors see this year's
 * cycle as a preview of theirs.
 */
export function applicationCycle(now: Date = new Date()): number {
  const [year, month] = usToday(now).split("-").map(Number);
  return month >= 6 ? year : year - 1;
}

/** The key dates for the cycle starting in `cycle` (students starting college the next fall). */
export function keyDates(cycle: number): KeyDate[] {
  const next = cycle + 1;
  const fafsa = VERIFIED_FAFSA[cycle];
  return [
    fafsa
      ? {
          id: "fafsa",
          when: `By ${longDate(fafsa.opensBy)}`,
          start: fafsa.opensBy,
          end: null,
          opens: true,
          title: `The ${fafsa.awardYear} FAFSA opens`,
          detail:
            "The FAFSA is the free form for federal grants, work-study and student loans. Many states and colleges use it for their own aid, too. Some aid runs out, so it pays to file early.",
          link: { href: "https://studentaid.gov/h/apply-for-aid/fafsa", label: "The FAFSA on studentaid.gov", external: true },
        }
      : {
          id: "fafsa",
          when: "Usually October 1",
          start: `${cycle}-10-01`,
          end: null,
          opens: true,
          title: "The FAFSA opens for the next school year",
          detail:
            "The FAFSA is the free form for federal grants, work-study and student loans. Many states and colleges use it for their own aid, too. Some aid runs out, so it pays to file early. Check studentaid.gov for this year's date.",
          link: { href: "https://studentaid.gov/h/apply-for-aid/fafsa", label: "The FAFSA on studentaid.gov", external: true },
        },
    {
      id: "css-profile",
      when: "Usually October 1",
      start: `${cycle}-10-01`,
      end: null,
      opens: true,
      title: "The CSS Profile opens",
      detail:
        "Only some colleges and scholarship programs ask for this extra aid form. See if any on your list do, and send it by the earliest priority date. It's free for families who make up to $100,000 a year.",
      link: {
        href: "https://profile.collegeboard.org/PPI/participatingInstitutions.aspx",
        label: "Colleges that use the CSS Profile",
        external: true,
      },
    },
    {
      id: "state-aid",
      when: "Different in each state",
      start: null,
      end: null,
      opens: false,
      title: "State aid deadlines",
      detail: "Each state sets its own FAFSA deadline for state grants, and some come early. Look up your state's date.",
      link: { href: "https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines", label: "State deadlines on studentaid.gov", external: true },
    },
    {
      id: "early-decision",
      when: "Often November 1",
      start: `${cycle}-11-01`,
      end: null,
      opens: false,
      title: "Early decision deadlines",
      detail:
        "At most colleges with early decision, it's due November 1. Some use mid-November or December 1. Early decision is binding: if you get in, you agree to go. Check each college's date.",
      link: {
        href: "https://bigfuture.collegeboard.org/plan-for-college/apply-to-college/early-decision-and-early-action-calendar",
        label: "Early deadlines calendar (College Board)",
        external: true,
      },
    },
    {
      id: "early-action",
      when: "Often in November",
      start: `${cycle}-11-01`,
      end: `${cycle}-11-30`,
      opens: false,
      title: "Early action deadlines",
      detail:
        "Early action is usually due in November. It usually isn't binding, and you can often apply early action to more than one college. Check each college's rules.",
    },
    {
      id: "regular",
      when: "Often January 1 to March 1",
      start: `${next}-01-01`,
      end: `${next}-03-01`,
      opens: false,
      title: "Regular deadlines",
      detail:
        "Many regular deadlines fall between January and March, but they vary. Some colleges use rolling admission: they decide as applications come in, until they're full. Check each college's date.",
    },
    {
      id: "decision-day",
      when: `Often ${longDate(`${next}-05-01`)}`,
      start: `${next}-05-01`,
      end: null,
      opens: false,
      title: "Decision day at many colleges",
      detail:
        "Most colleges give you until May 1 to say yes or no if you applied regular decision or early action. Compare your aid offers before you decide. Some colleges use a different date, so double-check.",
      link: { href: "/applications/compare", label: "Compare aid offers", external: false },
    },
  ];
}

export function keyDateStatus(item: Pick<KeyDate, "start" | "end" | "opens">, today: string): KeyDateStatus {
  if (!item.start) return "varies";
  if (item.opens) return today >= item.start ? "open_now" : "upcoming";
  return today > (item.end ?? item.start) ? "passed" : "upcoming";
}

export type KeyDatesYear = {
  cycle: number;
  /** "2026–27". */
  schoolYear: string;
  /** Students in this cycle start college in the fall of this year. */
  startsCollege: number;
  items: (KeyDate & { status: KeyDateStatus })[];
};

export function keyDatesFor(now: Date = new Date()): KeyDatesYear {
  const cycle = applicationCycle(now);
  const today = usToday(now);
  return {
    cycle,
    schoolYear: `${cycle}–${String(cycle + 1).slice(-2)}`,
    startsCollege: cycle + 1,
    items: keyDates(cycle).map((item) => ({ ...item, status: keyDateStatus(item, today) })),
  };
}
