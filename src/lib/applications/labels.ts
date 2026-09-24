import type { AidOffer, ApplicationChecklist, CollegeListStatus, DeadlineType } from "@/db/schema";

// Plain-language names for list fields. No database code here, so client components can import it.

export type EntryKind = "college" | "program";

export const ENTRY_KINDS = ["college", "program"] as const satisfies readonly EntryKind[];

export const KIND_LABELS: Record<EntryKind, string> = {
  college: "College",
  program: "Training program or apprenticeship",
};

/** Short form for badges. */
export const KIND_BADGES: Record<EntryKind, string> = {
  college: "College",
  program: "Program",
};

export const LIST_STATUSES = [
  "considering",
  "applying",
  "applied",
  "accepted",
  "waitlisted",
  "not_accepted",
  "enrolling",
  "declined",
] as const satisfies readonly CollegeListStatus[];

export const STATUS_LABELS: Record<CollegeListStatus, string> = {
  considering: "Thinking about it",
  applying: "Getting ready to apply",
  applied: "Applied",
  accepted: "Got in",
  waitlisted: "Waitlisted",
  not_accepted: "Not accepted",
  enrolling: "Going here",
  declined: "Said no thanks",
};

/** Statuses that mean the application already went in, so its deadline is no longer a worry. */
export const SUBMITTED_STATUSES: readonly CollegeListStatus[] = [
  "applied",
  "accepted",
  "waitlisted",
  "not_accepted",
  "enrolling",
  "declined",
];

export const DEADLINE_TYPES = [
  "early_decision",
  "early_action",
  "regular",
  "rolling",
  "priority",
] as const satisfies readonly DeadlineType[];

export const DEADLINE_TYPE_LABELS: Record<DeadlineType, string> = {
  early_decision: "Early decision (binding)",
  early_action: "Early action",
  regular: "Regular",
  rolling: "Rolling",
  priority: "Priority",
};

export const CHECKLIST_KEYS = [
  "applicationSubmitted",
  "transcriptRequested",
  "recommendationsRequested",
  "testScoresSent",
  "fafsaListed",
  "cssProfileSubmitted",
  "aidOfferReceived",
  "depositPaid",
] as const satisfies readonly (keyof ApplicationChecklist)[];

export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const CHECKLIST_LABELS: Record<ChecklistKey, { label: string; hint?: string }> = {
  applicationSubmitted: { label: "Application sent" },
  transcriptRequested: { label: "Transcript requested", hint: "Ask your school counselor to send it." },
  recommendationsRequested: { label: "Recommendation letters requested", hint: "If this school asks for them." },
  testScoresSent: { label: "Test scores sent", hint: "Only if this school asks for them." },
  fafsaListed: { label: "Listed on my FAFSA", hint: "So the school gets your FAFSA and can offer you aid." },
  cssProfileSubmitted: { label: "CSS Profile sent", hint: "Only some schools ask for this extra aid form." },
  aidOfferReceived: { label: "Aid offer received" },
  depositPaid: { label: "Deposit paid", hint: "Only for the school you pick." },
};

export const AID_FIELDS = [
  "costOfAttendance",
  "grants",
  "scholarships",
  "workStudy",
  "federalLoans",
  "parentLoans",
  "otherLoans",
] as const satisfies readonly (keyof AidOffer)[];

export type AidField = (typeof AID_FIELDS)[number];

export const AID_FIELD_LABELS: Record<AidField, { label: string; hint?: string }> = {
  costOfAttendance: {
    label: "Total cost for one year",
    hint: "Also called cost of attendance: tuition, fees, housing, food, books and travel.",
  },
  grants: { label: "Grants", hint: "Like a Pell Grant or state grant. Free money." },
  scholarships: { label: "Scholarships", hint: "Free money from the school or other groups." },
  workStudy: { label: "Work-study", hint: "Money you can earn at a part-time job during the year." },
  federalLoans: { label: "Federal student loans", hint: "Like Direct Subsidized or Unsubsidized Loans." },
  parentLoans: { label: "Parent PLUS loans", hint: "A loan your parent would take out." },
  otherLoans: { label: "Other loans", hint: "Like private loans from a bank." },
};
