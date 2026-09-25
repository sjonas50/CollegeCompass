// Checking that a citation's quote still appears in its source (used by `npm run check:rules`).
//
// Quotes are the source's own words, but saved copies of PDFs and web pages break text in odd
// places ("202 6-2027", "Credi t", line numbers in enrolled bills, curly vs straight quotes). So
// both sides are compared as lowercase letters and digits only. An ellipsis in a quote ("…" or
// "...") marks words left out: each part must appear, in order.

/** Lowercase letters and digits only, with accents removed. */
export function normalizeForQuote(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Does `quote` appear in `sourceText` (word for word, ignoring spacing, punctuation and case)? */
export function quoteAppears(quote: string, sourceText: string): boolean {
  const haystack = normalizeForQuote(sourceText);
  let from = 0;
  for (const part of quote.split(/…|\.\.\./)) {
    const needle = normalizeForQuote(part);
    if (!needle) continue;
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    from = at + needle.length;
  }
  return true;
}
