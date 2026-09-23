import * as z from "zod";

export type FormState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
} | undefined;

export function fieldErrors(error: z.ZodError): FormState {
  return { errors: z.flattenError(error).fieldErrors as Record<string, string[] | undefined> };
}

/** Only same-site relative paths, so `?next=` can't be used as an open redirect. */
export function safeNext(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

/** Builds an ISO date from separate month/day/year fields. */
export function birthDateFromForm(formData: FormData): string {
  const y = String(formData.get("birthYear") ?? "").padStart(4, "0");
  const m = String(formData.get("birthMonth") ?? "").padStart(2, "0");
  const d = String(formData.get("birthDay") ?? "").padStart(2, "0");
  return `${y}-${m}-${d}`;
}
