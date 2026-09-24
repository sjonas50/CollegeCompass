/**
 * Codes used by the College Scorecard, with plain-language labels. Search filters and results use
 * the Scorecard's own numeric codes, so these maps are the one place to turn them into words.
 */

/** Who runs the college: 1 public, 2 private nonprofit, 3 private for-profit. */
export type Control = 1 | 2 | 3;
export const CONTROLS: readonly Control[] = [1, 2, 3];
export const CONTROL_LABELS: Record<Control, string> = {
  1: "Public",
  2: "Private nonprofit",
  3: "Private for-profit",
};

/** Undergraduate credential levels in the field-of-study data: 1 certificate, 2 associate, 3 bachelor's. */
export type Credential = 1 | 2 | 3;
export const CREDENTIALS: readonly Credential[] = [1, 2, 3];
export const CREDENTIAL_LABELS: Record<Credential, { one: string; many: string; option: string }> = {
  1: { one: "Certificate", many: "Certificates", option: "Certificate (often 1 year or less)" },
  2: { one: "Associate degree", many: "Associate degrees", option: "Associate degree (usually 2 years)" },
  3: { one: "Bachelor's degree", many: "Bachelor's degrees", option: "Bachelor's degree (usually 4 years)" },
};

/** Predominant or highest degree: 1 certificate, 2 associate, 3 bachelor's, 4 graduate. */
export const DEGREE_LABELS: Record<number, { many: string; typical: string }> = {
  1: { many: "Certificates", typical: "Mostly certificates" },
  2: { many: "Associate degrees", typical: "Mostly associate degrees" },
  3: { many: "Bachelor's degrees", typical: "Mostly bachelor's degrees" },
  4: { many: "Graduate degrees", typical: "Mostly graduate degrees" },
};

export type CollegeSize = "small" | "medium" | "large";
export const SIZES: readonly CollegeSize[] = ["small", "medium", "large"];
export const SIZE_LABELS: Record<CollegeSize, { label: string; detail: string }> = {
  small: { label: "Small", detail: "under 5,000 undergraduates" },
  medium: { label: "Medium", detail: "5,000 to 15,000 undergraduates" },
  large: { label: "Large", detail: "over 15,000 undergraduates" },
};

/** Size bands by undergraduate enrollment: small < 5,000, medium 5,000–15,000, large > 15,000. */
export const SIZE_LIMITS = { mediumMin: 5_000, mediumMax: 15_000 } as const;

export function sizeOf(enrollment: number | null | undefined): CollegeSize | null {
  if (typeof enrollment !== "number" || !Number.isFinite(enrollment) || enrollment < 0) return null;
  if (enrollment < SIZE_LIMITS.mediumMin) return "small";
  if (enrollment <= SIZE_LIMITS.mediumMax) return "medium";
  return "large";
}

/** Colleges with a federally recognized special mission. */
export type Mission = "hbcu" | "hispanicServing" | "tribal";
export const MISSIONS: readonly Mission[] = ["hbcu", "hispanicServing", "tribal"];
export const MISSION_LABELS: Record<Mission, { label: string; short: string }> = {
  hbcu: { label: "Historically Black college or university (HBCU)", short: "HBCU" },
  hispanicServing: { label: "Hispanic-serving institution", short: "Hispanic-serving" },
  tribal: { label: "Tribal college or university", short: "Tribal college" },
};

export function asControl(value: number | null | undefined): Control | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

export function asCredential(value: number | null | undefined): Credential | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

/** 1–4, or null for "not classified" and anything unexpected. */
export function asDegree(value: number | null | undefined): number | null {
  return typeof value === "number" && DEGREE_LABELS[value] ? value : null;
}
