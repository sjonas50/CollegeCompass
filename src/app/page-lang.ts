// The language of each page, for <html lang>: the Spanish financial aid guide is Spanish and every
// other page is English. Layouts can't see the path, so src/proxy.ts works it out from the path and
// passes it to the root layout in a request header. Pure, so the proxy can import it.

export const SITE_LANG = "en";
export const PAGE_LANGS = ["en", "es"] as const;
export type PageLang = (typeof PAGE_LANGS)[number];

/** Request header the proxy sets with `pageLangForPath`; the root layout reads it. */
export const PAGE_LANG_HEADER = "x-page-lang";

function isPageLang(value: string | null | undefined): value is PageLang {
  return (PAGE_LANGS as readonly (string | null | undefined)[]).includes(value);
}

/** The language of the page at this path: "/aid/es/…" is Spanish, everything else English. */
export function pageLangForPath(pathname: string): PageLang {
  const lang = /^\/aid\/([^/]+)(?:\/|$)/.exec(pathname)?.[1];
  return isPageLang(lang) ? lang : SITE_LANG;
}

/** The <html lang> for the header's value. A missing or unexpected value means English. */
export function documentLang(headerValue: string | null | undefined): PageLang {
  return isPageLang(headerValue) ? headerValue : SITE_LANG;
}

/**
 * Sets the document's language and returns a cleanup that puts back the site's. For pages whose
 * language differs from the site's, reached by client-side navigation: the root layout isn't
 * rendered again then, so its <html lang> would stay as it was.
 */
export function setDocumentLang(root: { lang: string }, lang: string): () => void {
  root.lang = lang;
  return () => {
    root.lang = SITE_LANG;
  };
}
