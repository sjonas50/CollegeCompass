import { createHash } from "node:crypto";
import type { AidGuide } from "./schema";

/** JSON with object keys sorted, so the same content always gives the same string. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A short fingerprint of the guide's sections: every title, summary, block and source, as checked
 * (so spacing around the text and the order of keys in the file don't matter). A counselor-reviewed
 * guide records the fingerprint of what the counselor read; any later change to the words gives a
 * different one.
 */
export function contentFingerprint(guide: Pick<AidGuide, "sections">): string {
  return createHash("sha256").update(stableJson(guide.sections)).digest("hex").slice(0, 16);
}
