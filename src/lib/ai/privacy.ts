import type { GradeBand } from "../auth/age";
import { gradeBand } from "../auth/age";

/**
 * What the model may know about a student. Deliberately has no name, email, username or
 * birth date: prompts are built only from this type.
 */
export type StudentAiContext = {
  grade: number;
  gradeBand: GradeBand;
};

export function toAiContext(student: { grade: number | null }): StudentAiContext {
  const grade = student.grade ?? 9;
  return { grade, gradeBand: gradeBand(grade) };
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const STREET =
  /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Way|Pl|Place)\b\.?/g;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes personal details a student might type before text is sent to the AI provider:
 * emails, phone numbers, SSNs, street addresses and any known names.
 */
export function scrubPii(text: string, knownNames: string[] = []): string {
  let out = text.replace(EMAIL, "[email]").replace(SSN, "[number]").replace(PHONE, "[phone]").replace(STREET, "[address]");
  for (const name of knownNames) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, "gi"), "[name]");
  }
  return out;
}
