"use client";

import { type ReactNode, createContext, useContext } from "react";
import type { PlannerState, SchoolYear } from "@/lib/planner/common";

// The student's state when the planner covers it (UT, TN, TX), for the course forms: state names
// for kinds of classes ("Secondary Mathematics III" in Utah) and state-aware guesses ("Math 2").
// With the student's cohort (the school year they started 9th grade), the forms also know each
// class's school year, which some names depend on (Utah's "U.S. Government" from 2027-28).

type PlannerContext = { state: PlannerState | null; grade9EntryYear: SchoolYear | null };

const PlannerStateContext = createContext<PlannerContext>({ state: null, grade9EntryYear: null });

export function PlannerStateProvider({
  state,
  grade9EntryYear = null,
  children,
}: {
  state: PlannerState | null;
  grade9EntryYear?: SchoolYear | null;
  children?: ReactNode;
}) {
  return <PlannerStateContext value={{ state, grade9EntryYear }}>{children}</PlannerStateContext>;
}

export function usePlannerState(): PlannerState | null {
  return useContext(PlannerStateContext).state;
}

/** The school year a class in `grade` is (or was) taken, or null when the cohort isn't known. */
export function useSchoolYearOf(grade: number): SchoolYear | null {
  const { grade9EntryYear } = useContext(PlannerStateContext);
  return grade9EntryYear === null ? null : grade9EntryYear + (grade - 9);
}
