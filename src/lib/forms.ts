import * as z from "zod";

export type FormState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
} | undefined;

export function fieldErrors(error: z.ZodError): FormState {
  return { errors: z.flattenError(error).fieldErrors as Record<string, string[] | undefined> };
}

// Browsers drop tabs and newlines from addresses and read "\" as "/", so "/\t/evil.com" and
// "/\evil.com" both mean //evil.com, another site. Spaces never appear in a real `next` (it is
// always percent-encoded), so any whitespace or control character is refused too.
const UNSAFE_CHARACTERS = /[\s\u0000-\u001f\u007f\\]/;
const BASE = "https://next.invalid";

/**
 * Only same-site paths, so `?next=` can't be used as an open redirect. Returns the path in its
 * normalized form (dot segments resolved), or null.
 */
export function safeNext(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (UNSAFE_CHARACTERS.test(value)) return null;
  // The same tricks percent-encoded ("/%09/evil.com", "/%5Cevil.com", "/%2Fevil.com"), in case
  // anything on the way decodes the address once more.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (UNSAFE_CHARACTERS.test(decoded.replaceAll(" ", "")) || decoded.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  // Resolving "/..//evil.com" gives "//evil.com", so check again after normalizing.
  if (url.origin !== BASE || url.pathname.startsWith("//")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Builds an ISO date from separate month/day/year fields. */
export function birthDateFromForm(formData: FormData): string {
  const y = String(formData.get("birthYear") ?? "").padStart(4, "0");
  const m = String(formData.get("birthMonth") ?? "").padStart(2, "0");
  const d = String(formData.get("birthDay") ?? "").padStart(2, "0");
  return `${y}-${m}-${d}`;
}
