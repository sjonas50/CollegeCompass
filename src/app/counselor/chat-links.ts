import { linkify } from "@/lib/aid-guide/linkify";
import type { AidGuideSectionId } from "@/lib/aid-guide/schema";

// Turns https addresses and paths to our own pages in a counselor reply into link segments. Pure
// and HTML-free: the chat renders each segment as text or an <a>. Links to our pages show the
// page's name instead of the path, so they read well and make sense to screen readers.

export type ChatSegment =
  | { type: "text"; text: string }
  | {
      type: "link";
      /** What the student sees: the page's name for our pages, the address for other websites. */
      text: string;
      href: string;
      /** Exactly what the counselor wrote. */
      source: string;
      external: boolean;
      /** Set when the link text isn't English (it names a page of the Spanish guide). */
      lang?: "es";
    };

type AppPage = { text: string; href: string; lang?: "es" };

// A path starts at the start of the text, after a space or after opening punctuation, never inside
// a word, an address or "and/or". It runs to the next space, quote, bracket or typographic mark.
// The whole of it (less sentence punctuation at the end) must be a path to one of our pages, or
// none of it is linked.
const CANDIDATE = /(?<=^|[\s([{"'`“‘«¿¡—–])\/[^\s<>"'`“”‘’«»—–…()[\]{}]*/gu;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
// Lowercase letters, digits and . _ ~ -, with at least one letter or digit: no "." or ".." segments.
// No "%" either, so ".." and "/" can't be slipped in percent-encoded ("%2e%2e", "%2f").
const SEGMENT = /^[a-z0-9._~-]*[a-z0-9][a-z0-9._~-]*$/;
// A query as collegeSearchHref writes it: URLSearchParams turns spaces into "+" and encodes the rest.
const QUERY = /^(?:[A-Za-z0-9=&._~*+-]|%[0-9A-Fa-f]{2})+$/;

const PAGES: Record<string, string> = {
  dashboard: "Dashboard",
  roadmap: "Roadmap",
  plan: "Course plan",
  careers: "Explore careers",
  colleges: "Find colleges",
  applications: "My college list",
  "applications/compare": "Compare aid offers",
  "discover/results": "Assessment results",
  privacy: "Privacy",
  aid: "Financial aid guide",
};

// Names for the guide's sections. Typed by section id, so a new section needs a name here.
const AID_SECTIONS: Record<AidGuideSectionId, { en: string; es: string }> = {
  "how-aid-works": { en: "How financial aid works", es: "Cómo funciona la ayuda financiera" },
  "fafsa-step-by-step": { en: "The FAFSA, step by step", es: "La FAFSA, paso a paso" },
  "special-situations": { en: "Special situations", es: "Situaciones especiales" },
  "pell-and-workforce-pell": { en: "Pell Grants and Workforce Pell", es: "Becas Pell y Workforce Pell" },
  "state-aid-and-promise-programs": { en: "State aid and Promise programs", es: "Ayuda estatal y programas Promise" },
  "css-profile-and-fee-waivers": { en: "The CSS Profile and fee waivers", es: "El CSS Profile y las exenciones de cuotas" },
  "scholarships-and-scams": { en: "Scholarships and scams", es: "Becas y estafas" },
  "loans-wisely": { en: "Using loans wisely", es: "Cómo usar los préstamos con cuidado" },
  "comparing-aid-offers": { en: "Comparing aid offers", es: "Cómo comparar ofertas de ayuda" },
  "training-programs-and-apprenticeships": {
    en: "Paying for career training and apprenticeships",
    es: "Cómo pagar la capacitación y los programas de aprendizaje",
  },
};
const SPANISH_GUIDE = "Guía de ayuda financiera";

function aidPage(lang: string, section: string | undefined): AppPage | null {
  if (lang !== "en" && lang !== "es") return null;
  const guide = lang === "es" ? { text: SPANISH_GUIDE, href: "/aid/es", lang: "es" as const } : { text: PAGES.aid, href: "/aid/en" };
  if (!section) return guide;
  const names = Object.hasOwn(AID_SECTIONS, section) ? AID_SECTIONS[section as AidGuideSectionId] : null;
  // A section that doesn't exist would be a dead end, so link to the guide's contents instead.
  if (!names) return guide;
  return lang === "es" ? { text: names.es, href: `/aid/es/${section}`, lang: "es" } : { text: names.en, href: `/aid/en/${section}` };
}

/** The page a path leads to, with a readable name, or null if it isn't a page we link to. */
export function appPage(path: string): AppPage | null {
  const [pathname, query, ...extra] = path.split("?");
  if (extra.length || path.includes("#")) return null;
  // One slash at the end is fine; Next.js drops it.
  const segments = pathname.slice(1).replace(/(?<=.)\/$/, "").split("/");
  if (!segments.every((s) => SEGMENT.test(s))) return null;
  const route = segments.join("/");
  const href = `/${route}`;
  if (query !== undefined) {
    // Only college search takes a query.
    return route === "colleges" && QUERY.test(query) ? { text: "matching colleges", href: `${href}?${query}` } : null;
  }
  if (Object.hasOwn(PAGES, route)) return { text: PAGES[route], href };
  const [first, second, third, ...rest] = segments;
  if (rest.length) return null;
  if (first === "aid" && second) return aidPage(second, third);
  if (third) return null;
  if (first === "colleges" && /^\d+$/.test(second)) return { text: "college page", href };
  if (first === "careers" && /^\d{2}-\d{4}\.\d{2}$/.test(second)) return { text: "career page", href };
  return null;
}

type Placed = { start: number; end: number; segment: ChatSegment };

export function chatLinks(text: string): ChatSegment[] {
  const links: Placed[] = [];
  let offset = 0;
  for (const segment of linkify(text)) {
    // Other websites only over https. A plain http:// address stays text.
    if (segment.type === "link" && segment.href.startsWith("https://")) {
      const link: ChatSegment = { type: "link", text: segment.text, href: segment.href, source: segment.text, external: true };
      links.push({ start: offset, end: offset + segment.text.length, segment: link });
    }
    offset += segment.text.length;
  }
  for (const match of text.matchAll(CANDIDATE)) {
    const path = match[0].replace(TRAILING_PUNCTUATION, "");
    const start = match.index;
    const end = start + path.length;
    if (links.some((l) => start < l.end && l.start < end)) continue;
    const page = appPage(path);
    if (!page) continue;
    const link: ChatSegment = { type: "link", text: page.text, href: page.href, source: path, external: false, ...(page.lang && { lang: page.lang }) };
    links.push({ start, end, segment: link });
  }
  links.sort((a, b) => a.start - b.start);

  const out: ChatSegment[] = [];
  let last = 0;
  for (const { start, end, segment } of links) {
    if (start > last) out.push({ type: "text", text: text.slice(last, start) });
    out.push(segment);
    last = end;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
