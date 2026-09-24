import { linkify } from "@/lib/aid-guide/linkify";

// Turns web addresses and paths to our own pages in a counselor reply into link segments. Pure and
// HTML-free: the chat renders each segment as text or an <a>.

export type ChatSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string; external: boolean };

// Paths the counselor's tools hand out, e.g. /colleges/166683 or /aid/es/fafsa-step-by-step. Must
// start a word (not "and/or" or a URL's path) and use only path characters.
const APP_PATH = /(?<![\w/.:~-])\/(?:colleges|aid|applications|roadmap|plan|careers|discover|dashboard|privacy)(?:\/[a-z0-9._~-]+)*\/?(?:\?[a-z0-9=&._%-]+)?/gi;

export function chatLinks(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  for (const segment of linkify(text)) {
    if (segment.type === "link") {
      out.push({ ...segment, external: true });
      continue;
    }
    let last = 0;
    for (const match of segment.text.matchAll(APP_PATH)) {
      // Sentence punctuation after a path isn't part of it.
      const path = match[0].replace(/[.,;:!?]+$/, "");
      const start = match.index;
      if (start > last) out.push({ type: "text", text: segment.text.slice(last, start) });
      out.push({ type: "link", text: path, href: path, external: false });
      last = start + path.length;
    }
    if (last < segment.text.length) out.push({ type: "text", text: segment.text.slice(last) });
  }
  return out;
}
