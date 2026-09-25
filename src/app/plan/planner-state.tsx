"use client";

import { type ReactNode, createContext, useContext } from "react";
import type { PlannerState } from "@/lib/planner/common";

// The student's state when the planner covers it (UT, TN, TX), for the course forms: state names
// for kinds of classes ("Secondary Mathematics III" in Utah) and state-aware guesses ("Math 2").

const PlannerStateContext = createContext<PlannerState | null>(null);

export function PlannerStateProvider({ state, children }: { state: PlannerState | null; children?: ReactNode }) {
  return <PlannerStateContext value={state}>{children}</PlannerStateContext>;
}

export function usePlannerState(): PlannerState | null {
  return useContext(PlannerStateContext);
}
