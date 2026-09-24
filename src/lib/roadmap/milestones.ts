import type { Milestone } from "./types";

/**
 * PLACEHOLDER — replaced by the fact-checked grade 7–12 library. Code must not depend on
 * specific ids or counts here.
 */
export const MILESTONES: Milestone[] = [
  {
    id: "g7-join-a-club",
    grade: 7,
    months: [9, 10],
    title: "Try a new club or activity",
    detail: "Pick one club, team, or activity that sounds interesting and go to a meeting.",
    why: "Trying new things is how you find out what you enjoy.",
    category: "activities_summer",
    pathway: "all",
    sources: [],
  },
  {
    id: "g8-choose-9th-grade-classes",
    grade: 8,
    months: [1, 2, 3],
    title: "Pick your 9th-grade classes",
    detail: "Ask your school counselor which math and science classes you can take in 9th grade.",
    why: "Your 9th-grade classes set up which classes you can take later.",
    category: "academics",
    pathway: "all",
    sources: [],
  },
  {
    id: "g9-meet-your-counselor",
    grade: 9,
    months: [9, 10],
    title: "Meet your school counselor",
    detail: "Introduce yourself and share one career or subject you're curious about.",
    why: "Your counselor can point you to classes and programs you might not know about.",
    category: "habits",
    pathway: "all",
    sources: [],
  },
  {
    id: "g10-summer-program",
    grade: 10,
    months: [3, 4],
    title: "Look for a free summer program",
    detail: "Search for free summer programs, camps, or jobs near you that match your interests.",
    why: "Summer is a great time to try a field before choosing a path.",
    category: "activities_summer",
    pathway: "all",
    sources: [],
  },
  {
    id: "g11-research-apprenticeships",
    grade: 11,
    months: [10, 11],
    title: "Research apprenticeships near you",
    detail: "Look up registered apprenticeship programs in careers you're interested in.",
    why: "Apprenticeships let you earn money while you train.",
    category: "career_exploration",
    pathway: "training",
    sources: [],
  },
  {
    id: "g12-submit-fafsa",
    grade: 12,
    months: [10, 11, 12],
    title: "Fill out the FAFSA",
    detail: "Complete the FAFSA with a parent or guardian to apply for financial aid.",
    why: "The FAFSA is how you get grants, work-study, and many scholarships.",
    category: "financial_aid",
    pathway: "all",
    sources: ["https://studentaid.gov/h/apply-for-aid/fafsa"],
  },
];
