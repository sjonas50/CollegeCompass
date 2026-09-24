export const MILESTONE_CATEGORIES = [
  "academics",
  "testing",
  "activities_summer",
  "career_exploration",
  "college_search",
  "applications",
  "financial_aid",
  "habits",
] as const;
export type MilestoneCategory = (typeof MILESTONE_CATEGORIES)[number];

export type MilestonePathway = "all" | "degree" | "training";

/**
 * One step on the grade-by-grade roadmap. The library is curated and fact-checked content in
 * `milestones.ts`; students' progress is stored by `id`, so ids must never change once shipped.
 */
export type Milestone = {
  id: string;
  grade: number; // 7–12
  /** Calendar months (1 = January) when it's most relevant. June/July = summer after `grade`. */
  months: number[];
  title: string;
  detail: string;
  why: string;
  category: MilestoneCategory;
  pathway: MilestonePathway;
  /** Official sources backing any date, deadline, program or cost claim. */
  sources: string[];
};
