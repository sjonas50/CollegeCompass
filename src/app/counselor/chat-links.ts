import { linkify, toSafeHref } from "@/lib/aid-guide/linkify";
import type { AidGuideSectionId } from "@/lib/aid-guide/schema";
import { US_STATES } from "@/lib/colleges/states";

// Turns https addresses, a few trusted sites written without https:// and paths to our own pages
// in a counselor reply into link segments. Pure and HTML-free: the chat renders each segment as
// text or an <a>. Links to our pages show the page's name instead of the path, so they read well
// and make sense to screen readers. A college or career page takes the name the counselor wrote
// with it, so two in a row don't both read "college page": "Boston College (/colleges/164924)",
// "[Boston College](/colleges/164924)", "Boston College — /colleges/164924", "Boston College:
// /colleges/164924", or with a place between, "Boston College, Chestnut Hill MA — /colleges/164924"
// (the name is linked, the place stays as written and the path isn't shown).

export type ChatSegment =
  | {
      type: "text";
      text: string;
      /** Set when what the counselor wrote isn't shown: the path after a college's name and place. */
      source?: string;
    }
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
 * instead when they can: a markdown label for any of them, or a name written just before a
 * college or career page.
 */
type AppPage = { text: string; href: string; lang?: "es"; placeholder?: "college" | "career" | "search" };

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
  if (first === "colleges" && /^\d+$/.test(second)) return { text: "college page", href, placeholder: "college" };
  if (first === "careers" && /^\d{2}-\d{4}\.\d{2}$/.test(second)) return { text: "career page", href, placeholder: "career" };
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

// Link words that don't say where the link goes (WCAG 2.4.4): our own name for the page says more.
const GENERIC_LABELS = new Set(
  ["here", "click here", "tap here", "this", "this page", "this link", "page", "link", "more", "read more", "learn more", "see more",
    "more info", "details", "aquí", "haz clic aquí", "esta página", "este enlace", "enlace", "más"],
);

/** A markdown label that names the page, not "here" or the path again. */
function namesPage(label: string): boolean {
  const words = label.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim().replace(/\s+/g, " ");
  return !GENERIC_LABELS.has(words) && !/^(?:\/|https?:)/i.test(label);
}

// A name: capitalized words, maybe joined by small words, as in "Texas A&M", "St. Olaf College",
// "U.S. Naval Academy" or "University of Texas at Austin". It ends the text it's matched against.
const NAME_WORD = String.raw`(?:\p{Lu}[\p{L}\p{N}'’&–-]*|\p{Lu}\p{Ll}{0,2}\.|(?:\p{Lu}\.){2,})`;
const NAME_JOIN = String.raw`(?:of|at|the|de|la|del|and|in|for|on|y|&|[-–])`;
const NAME_AT_END = new RegExp(String.raw`(?<=^|[\s(])${NAME_WORD}(?:\s+(?:${NAME_JOIN}\s+)*${NAME_WORD})*(?=\s*$)`, "u");
const JOIN_WORD = new RegExp(String.raw`^${NAME_JOIN}$`, "u");
// Capitalized words that start a sentence rather than a name ("Look at Texas A&M"), or that say
// what a link is rather than name it ("Link: /colleges/1").
const NOT_NAMES = new Set(
  "i you your we it its this that these those here there look check see try visit compare consider explore read open both also then or and but maybe if some another next like for with in at link page site website more info details profile overview note tip".split(" "),
);
const notName = (word: string) => NOT_NAMES.has(word.split(/['’]/)[0].toLowerCase());

// "and" usually joins two schools ("Georgia Tech and Emory University"), so a college's name starts
// after it, unless the words on each side make one name: kinds of school or subjects ("Community
// and Technical College", "University of Science and Technology"), or a few well-known names.
// Career titles keep "and": O*NET writes 437 of its 1,016 that way ("Accountants and Auditors").
const SCHOOL_WORDS = new Set(
  `Academy Acupuncture Adult Aeronautics Agricultural Agriculture Allied Architecture Art Arts Barber Barbering Beauty Business
  Career Careers Center College Community Continuing Cosmetology Culinary Culture Dental Design Dramatic Education Engineering
  Esthetics Graduate Hairstyling Health Healthcare Hospitality Institute Integrative Justice Law Management Massage Mechanical
  Medical Medicine Mines Mining Ministry Music Musical Nails Nursing Oriental Performing Pharmacy Religion Salon School Science
  Sciences Seminary Spa State Studies Technical Technology Theological Theology Trade Tribal University Wellness`.split(/\s+/),
);
const AND_NAMES = new Set(["Washington and Lee", "Washington and Jefferson", "William and Mary", "Franklin and Marshall", "Lewis and Clark", "Hobart and William"]);

/** Where the last school in a run of names joined by "and" starts. */
function lastSchool(name: string): number {
  let start = 0;
  for (const and of name.matchAll(/\s+and\s+/g)) {
    const before = /\S+$/.exec(name.slice(0, and.index))?.[0] ?? "";
    const after = /^\S+/.exec(name.slice(and.index + and[0].length))?.[0] ?? "";
    const oneName = (SCHOOL_WORDS.has(before) && SCHOOL_WORDS.has(after)) || AND_NAMES.has(`${before} and ${after}`);
    if (!oneName) start = and.index + and[0].length;
  }
  return start;
}

/** The name written just before `at`, not reaching back past `from`. */
function nameBefore(text: string, from: number, at: number, kind: "college" | "career"): { start: number; name: string } | null {
  const base = Math.max(from, at - 2 * MAX_NAME);
  const match = NAME_AT_END.exec(text.slice(base, at));
  if (!match) return null;
  let skipped = kind === "college" ? lastSchool(match[0]) : 0;
  let name = match[0].slice(skipped);
  for (let lead = /^(\S+)\s+/.exec(name); lead && (notName(lead[1]) || JOIN_WORD.test(lead[1])); lead = /^(\S+)\s+/.exec(name)) {
    name = name.slice(lead[0].length);
    skipped += lead[0].length;
  }
  if (notName(name) || name.length > MAX_NAME) return null;
  return { start: base + match.index + skipped, name };
}

// What joins a name to its path besides "(...)": a dash or a colon ("Boston College — /colleges/164924").
const JOIN_BEFORE_PATH = /(?:\s*[—–]\s*|\s+-\s+|:\s+)$/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STATE = [...US_STATES.flatMap((s) => [s.code, s.name]), "D.C."].sort((a, b) => b.length - a.length).map(escape).join("|");
// A place after a college's name, as the tools give it (", Ithaca NY", ", Chestnut Hill, MA") or
// in words (" in Houston, Texas"). The city is a few capitalized words ("St. Paul", "Coeur d'Alene").
const CITY_WORD = String.raw`(?:${NAME_WORD}|d['’]\p{Lu}\p{L}*)`;
const CITY = String.raw`${CITY_WORD}(?:\s+(?:(?:de|la|del|du|of|the)\s+)?${CITY_WORD}){0,3}`;
const PLACE_AT_END = new RegExp(String.raw`(?:,|\s+in)\s+${CITY},?\s+(?:${STATE})\s*$`, "u");
// A college is never named just "Texas" or "NY": that's where it is.
const ONLY_A_STATE = new RegExp(String.raw`^(?:${STATE})$`, "u");

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

/**
 * A college or career page written after its name: "Name (/path)", "Name — /path" or "Name: /path",
 * and for a college also with its place between ("Cornell University, Ithaca NY — /colleges/190415").
 * The name becomes the link. A place stays as written, and the path and what joins it aren't shown.
 * Looks back no further than `from`: the start of the line, or the end of the link before.
 */
function namedPage(text: string, from: number, start: number, end: number, href: string, kind: "college" | "career"): Placed[] | null {
  let joinStart: number;
  let linkEnd: number;
  if (text[start - 1] === "(" && text[end] === ")") {
    joinStart = start - 1;
    linkEnd = end + 1;
  } else {
    const join = JOIN_BEFORE_PATH.exec(text.slice(from, start));
    if (!join) return null;
    joinStart = from + join.index;
    linkEnd = end;
  }
  const headStart = Math.max(from, joinStart - 2 * MAX_NAME);
  const head = text.slice(headStart, joinStart);
  const place = kind === "college" ? PLACE_AT_END.exec(head) : null;
  const named = nameBefore(text, from, place ? headStart + place.index : joinStart, kind);
  if (!named || (kind === "college" && ONLY_A_STATE.test(named.name))) return null;
  const nameEnd = place ? named.start + named.name.length : linkEnd;
  const source = text.slice(named.start, nameEnd);
  const link: ChatSegment = { type: "link", text: named.name, href, source, external: false };
  if (!place) return [{ start: named.start, end: nameEnd, segment: link }];
  const placeEnd = headStart + head.trimEnd().length;
  const hidden: ChatSegment = { type: "text", text: "", source: text.slice(placeEnd, linkEnd) };
  return [
    { start: named.start, end: nameEnd, segment: link },
    { start: placeEnd, end: linkEnd, segment: hidden },
  ];
}

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
  // The label of a markdown link ("[studentaid.gov](https://studentaid.gov)") isn't a link of its own.
  const isLabel = (end: number) => text.startsWith("](", end);
  for (const match of text.matchAll(BARE_CANDIDATE)) {
    const written = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = bareSiteHref(written);
    const start = match.index;
    const end = start + written.length;
    if (!href || !trustedLink(href) || isLabel(end) || overlaps(start, end)) continue;
    links.push({ start, end, segment: { type: "link", text: written, href, source: written, external: true } });
  }
  for (const match of text.matchAll(CANDIDATE)) {
    const path = match[0].replace(TRAILING_PUNCTUATION, "");
    const page = appPage(path);
    const start = match.index;
    const end = start + path.length;
    if (!page || isLabel(end)) continue;
    const lang = page.lang && { lang: page.lang };
    const linked = (from: number, to: number, shown: string): Placed => ({
      start: from,
      end: to,
      segment: { type: "link", text: shown, href: page.href, source: text.slice(from, to), external: false, ...lang },
    });
    // The widest choice that's free: markdown around the path, or the name written with it, else the path.
    const choices: Placed[][] = [];
    const markdown = markdownLink(text, start, end);
    if (markdown) choices.push([linked(markdown.start, markdown.end, page.placeholder && namesPage(markdown.label) ? markdown.label : page.text)]);
    if (page.placeholder === "college" || page.placeholder === "career") {
      const from = Math.max(text.lastIndexOf("\n", start) + 1, ...links.filter((l) => l.end <= start).map((l) => l.end));
      const named = namedPage(text, from, start, end, page.href, page.placeholder);
      if (named) choices.push(named);
    }
    choices.push([linked(start, end, page.text)]);
    const choice = choices.find((placed) => placed.every((p) => !overlaps(p.start, p.end)));
    if (choice) links.push(...choice);
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
