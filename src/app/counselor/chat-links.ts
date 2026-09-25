import { linkify, toSafeHref } from "@/lib/aid-guide/linkify";
import type { AidGuideSectionId } from "@/lib/aid-guide/schema";

// Turns https addresses, a few trusted sites written without https:// and paths to our own pages
// in a counselor reply into link segments. Pure and HTML-free: the chat renders each segment as
// text or an <a>. Links to our pages show the page's name instead of the path, so they read well
// and make sense to screen readers. A college or career page takes the name the counselor wrote
// with it ("Boston College (/colleges/164924)"), so two in a row don't both read "college page".

export type ChatSegment =
  | { type: "text"; text: string }
  | {
      type: "link";
      /**
       * What the student sees: the page's name for our pages (for a college or career, the name the
       * counselor gave it), the address as written for other websites.
       */
      text: string;
      href: string;
      /** Exactly what the counselor wrote. */
      source: string;
      external: boolean;
      /** Set when the link text isn't English (it names a page of the Spanish guide). */
      lang?: "es";
    };

/**
 * `placeholder`: the text only says what kind of page it is, so the counselor's words name it
 * instead when they can: a markdown label for either kind, or a name written just before a
 * college or career ("detail") page.
 */
type AppPage = { text: string; href: string; lang?: "es"; placeholder?: "detail" | "search" };

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
    return route === "colleges" && QUERY.test(query) ? { text: "matching colleges", href: `${href}?${query}`, placeholder: "search" } : null;
  }
  if (Object.hasOwn(PAGES, route)) return { text: PAGES[route], href };
  const [first, second, third, ...rest] = segments;
  if (rest.length) return null;
  if (first === "aid" && second) return aidPage(second, third);
  if (third) return null;
  if (first === "colleges" && /^\d+$/.test(second)) return { text: "college page", href, placeholder: "detail" };
  if (first === "careers" && /^\d{2}-\d{4}\.\d{2}$/.test(second)) return { text: "career page", href, placeholder: "detail" };
  return null;
}

const MAX_NAME = 80;

/** "[label](/path)" around the path at start–end: the whole span, and the label. */
function markdownLink(text: string, start: number, end: number): { start: number; end: number; label: string } | null {
  if (text.slice(Math.max(start - 2, 0), start) !== "](" || text[end] !== ")") return null;
  const open = text.lastIndexOf("[", start - 2);
  if (open < 0) return null;
  const label = text.slice(open + 1, start - 2).trim();
  if (/[[\]\n]/.test(label) || !/[\p{L}\p{N}]/u.test(label) || label.length > MAX_NAME) return null;
  return { start: open, end: end + 1, label };
}

// A name: capitalized words, maybe joined by small words, as in "Texas A&M", "St. Olaf College",
// "U.S. Naval Academy" or "University of Texas at Austin". It ends the text it's matched against.
const NAME_WORD = String.raw`(?:\p{Lu}[\p{L}\p{N}'’&–-]*|\p{Lu}\p{Ll}{0,2}\.|(?:\p{Lu}\.){2,})`;
const NAME_JOIN = String.raw`(?:of|at|the|de|la|del|and|in|for|on|y|&|[-–])`;
const NAME_AT_END = new RegExp(String.raw`(?<=^|[\s(])${NAME_WORD}(?:\s+(?:${NAME_JOIN}\s+)*${NAME_WORD})*(?=\s*$)`, "u");
const JOIN_WORD = new RegExp(String.raw`^${NAME_JOIN}$`, "u");
// Capitalized words that start a sentence rather than a name ("Look at Texas A&M").
const NOT_NAMES = new Set(
  "i you your we it its this that these those here there look check see try visit compare consider explore read open both also then or and but maybe if some another next like for with".split(" "),
);
const notName = (word: string) => NOT_NAMES.has(word.split(/['’]/)[0].toLowerCase());

/** The name written just before the "(" at `paren`, not reaching back past `from`. */
function nameBefore(text: string, from: number, paren: number): { start: number; name: string } | null {
  const base = Math.max(from, paren - 2 * MAX_NAME);
  const match = NAME_AT_END.exec(text.slice(base, paren));
  if (!match) return null;
  let name = match[0];
  let skipped = 0;
  for (let lead = /^(\S+)\s+/.exec(name); lead && (notName(lead[1]) || JOIN_WORD.test(lead[1])); lead = /^(\S+)\s+/.exec(name)) {
    name = name.slice(lead[0].length);
    skipped += lead[0].length;
  }
  if (notName(name) || name.length > MAX_NAME) return null;
  return { start: base + match.index + skipped, name };
}

/**
 * Trusted sites the counselor names without https:// ("confirm dates at studentaid.gov"), and the
 * host each is served from. Only these exact names are linked, never a look-alike or a subdomain.
 */
const BARE_SITES: Record<string, string> = {
  "studentaid.gov": "studentaid.gov",
  "fafsa.gov": "fafsa.gov",
  // bls.gov/ooh redirects to BLS's home page, dropping the path.
  "bls.gov": "www.bls.gov",
  "collegescorecard.ed.gov": "collegescorecard.ed.gov",
  "988lifeline.org": "988lifeline.org",
  "collegeboard.org": "www.collegeboard.org",
  "act.org": "www.act.org",
  "apprenticeship.gov": "www.apprenticeship.gov",
};
// Starts where a path may and runs to the next space, quote or bracket, like CANDIDATE.
const BARE_CANDIDATE = /(?<=^|[\s([{"'`“‘«¿¡—–])[^\s<>"'`“”‘’«»—–…()[\]{}]+/gu;
// All of it (less sentence punctuation at the end) must be the site, maybe with www. and a plain
// path: "studentaid.gov", "StudentAid.gov/es", "bls.gov/ooh/". Nothing like "@", ":", "?" or "#".
const BARE_SITE = /^(?:www\.)?([a-z0-9.-]+)((?:\/[\w.~-]*)*)$/i;

function bareSiteHref(written: string): string | null {
  const match = BARE_SITE.exec(written);
  if (!match) return null;
  const site = match[1].toLowerCase();
  if (!Object.hasOwn(BARE_SITES, site) || match[2].split("/").some((s) => s === "." || s === "..")) return null;
  return toSafeHref(`https://${BARE_SITES[site]}${match[2]}`, { requireHttps: true });
}

type Placed = { start: number; end: number; segment: ChatSegment };

/** Besides any .gov or .edu site. Subdomains count too (npc.collegeboard.org, apply.commonapp.org). */
const TRUSTED_SITES = ["collegeboard.org", "act.org", "commonapp.org", "careeronestop.org", "988lifeline.org", "crisistextline.org"];

/** Https links to government, college and trusted sites. */
function trustedLink(href: string): boolean {
  if (!href.startsWith("https://")) return false;
  let host: string;
  try {
    host = new URL(href).hostname;
  } catch {
    return false;
  }
  return /\.(gov|edu)$/.test(host) || TRUSTED_SITES.some((site) => host === site || host.endsWith(`.${site}`));
}

export function chatLinks(text: string): ChatSegment[] {
  const links: Placed[] = [];
  let offset = 0;
  for (const segment of linkify(text)) {
    // Other websites only over https, and only government, college and a few trusted sites, so a
    // look-alike address (even one the counselor quotes as a warning) stays plain text.
    if (segment.type === "link" && trustedLink(segment.href)) {
      const link: ChatSegment = { type: "link", text: segment.text, href: segment.href, source: segment.text, external: true };
      links.push({ start: offset, end: offset + segment.text.length, segment: link });
    }
    offset += segment.text.length;
  }
  const overlaps = (start: number, end: number) => links.some((l) => start < l.end && l.start < end);
  for (const match of text.matchAll(BARE_CANDIDATE)) {
    const written = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = bareSiteHref(written);
    const start = match.index;
    const end = start + written.length;
    if (!href || !trustedLink(href) || overlaps(start, end)) continue;
    links.push({ start, end, segment: { type: "link", text: written, href, source: written, external: true } });
  }
  for (const match of text.matchAll(CANDIDATE)) {
    const path = match[0].replace(TRAILING_PUNCTUATION, "");
    const page = appPage(path);
    if (!page) continue;
    const start = match.index;
    const end = start + path.length;
    // The widest span that's free: markdown around the path, or a name and "(path)", else the path.
    const spans: { start: number; end: number; text: string }[] = [];
    const markdown = markdownLink(text, start, end);
    if (markdown) spans.push({ ...markdown, text: page.placeholder ? markdown.label : page.text });
    if (page.placeholder === "detail" && text[start - 1] === "(" && text[end] === ")") {
      const from = Math.max(text.lastIndexOf("\n", start) + 1, ...links.filter((l) => l.end < start).map((l) => l.end));
      const named = nameBefore(text, from, start - 1);
      if (named) spans.push({ start: named.start, end: end + 1, text: named.name });
    }
    spans.push({ start, end, text: page.text });
    const span = spans.find((s) => !overlaps(s.start, s.end));
    if (!span) continue;
    const source = text.slice(span.start, span.end);
    const link: ChatSegment = { type: "link", text: span.text, href: page.href, source, external: false, ...(page.lang && { lang: page.lang }) };
    links.push({ start: span.start, end: span.end, segment: link });
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
