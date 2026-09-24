/**
 * Turns bare web addresses in guide text into link segments. Pure and HTML-free: the page renders
 * each segment as a React text node or <a>, so nothing in the content is ever parsed as HTML.
 */

export type TextSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

// A candidate starts with http:// or https:// and runs until whitespace, a quote, an angle bracket
// or typographic punctuation (so "https://studentaid.gov—y" and "“https://…”" split cleanly).
const ADDRESS_CHAR = "[^\\s<>\"'`“”‘’«»—–…]";
const CANDIDATE = new RegExp(`https?://${ADDRESS_CHAR}+`, "giu");
// The same, but also a bare scheme, for finding everything written that looks like an address.
const WRITTEN = new RegExp(`https?://${ADDRESS_CHAR}*`, "giu");
// What may come right before an address. Anything else ("javascript:https://…", "xhttps://…")
// means the address is glued to other text, and it stays plain text.
const ALLOWED_BEFORE = /[\s([{"'“‘«¿¡—–]/u;
const TRAILING_PUNCTUATION = ".,;:!?";
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
// A real domain name: labels of letters, digits and hyphens, ending in a letters-only TLD.
// This also rules out IP addresses and "localhost".
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/** Drops sentence punctuation and unbalanced closing brackets from the end of an address. */
function trimTrailing(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url.at(-1) ?? "";
    if (last !== "" && TRAILING_PUNCTUATION.includes(last)) {
      url = url.slice(0, -1);
    } else if (last in CLOSERS && count(url, last) > count(url, CLOSERS[last])) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

/**
 * The normalized href for a web address we are willing to link to, or null. Only http(s) with a
 * real domain name; no user:password@ prefixes (a classic "studentaid.gov@evil.com" look-alike),
 * no non-ASCII or punycode hosts (homograph look-alikes) and no hidden characters.
 */
export function toSafeHref(candidate: string, { requireHttps = false } = {}): string | null {
  if (!/^https?:\/\/[\x21-\x7e]+$/i.test(candidate)) return null;
  if (/[<>"'`\\]/.test(candidate)) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && (requireHttps || url.protocol !== "http:")) return null;
  if (url.username || url.password) return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  if (url.hostname.split(".").some((label) => label.startsWith("xn--"))) return null;
  return url.href;
}

/**
 * Splits text into plain-text and link segments. Joining every segment's `text` gives back the
 * input exactly. Addresses that fail `toSafeHref` stay plain text.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  const pushText = (end: number) => {
    if (end > cursor) segments.push({ type: "text", text: text.slice(cursor, end) });
  };
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index;
    if (start > 0 && !ALLOWED_BEFORE.test(text[start - 1])) continue;
    const address = trimTrailing(match[0]);
    const href = toSafeHref(address);
    if (!href) continue;
    pushText(start);
    segments.push({ type: "link", text: address, href });
    cursor = start + address.length;
  }
  pushText(text.length);
  return segments;
}

/**
 * Every web address written in the text, linkable or not, with where it starts, for content checks.
 * Trailing punctuation is left off, as `linkify` does. A bare scheme ("starts with https://") is
 * text about addresses, not an address, so it isn't listed.
 */
export function findAddresses(text: string): { index: number; address: string }[] {
  return [...text.matchAll(WRITTEN)].flatMap((m) => {
    const address = trimTrailing(m[0]);
    return /^https?:\/\/$/i.test(address) ? [] : [{ index: m.index, address }];
  });
}
