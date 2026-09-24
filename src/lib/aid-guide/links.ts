import { type TextSegment, linkify } from "./linkify";
import type { AidGuideSource } from "./schema";

// Which addresses in guide text become links. The pages render with `guideTextSegments` and the
// content checks use the same function, so what the checks accept is exactly what readers can click.

/** "https://www.StudentAid.gov/x" → "studentaid.gov". */
function siteOf(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The sites guide text may link to: any .gov or .edu site (only U.S. governments and accredited
 * colleges can get those names), and the sites of the section's own sources. Anything else, like a
 * scam look-alike given as a warning, stays plain text.
 */
export function isLinkableSite(href: string, sources: readonly Pick<AidGuideSource, "url">[]): boolean {
  if (!href.startsWith("https://")) return false;
  const site = siteOf(href);
  if (!site) return false;
  return /\.(gov|edu)$/.test(site) || sources.some((source) => siteOf(source.url) === site);
}

/**
 * Guide text split into plain text and links, as the page shows it: `linkify`'s links, keeping only
 * https links to sites in `isLinkableSite`. Joining every segment's `text` gives back the input.
 */
export function guideTextSegments(text: string, sources: readonly Pick<AidGuideSource, "url">[]): TextSegment[] {
  const out: TextSegment[] = [];
  for (const segment of linkify(text)) {
    const last = out.at(-1);
    if (segment.type === "link" && isLinkableSite(segment.href, sources)) out.push(segment);
    else if (last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + segment.text };
    else out.push({ type: "text", text: segment.text });
  }
  return out;
}
