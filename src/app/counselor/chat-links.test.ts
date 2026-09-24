import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AID_GUIDE_SECTION_IDS } from "@/lib/aid-guide";
import { collegeSearchHref } from "@/lib/colleges/search";
import { Linked } from "./chat";
import { type ChatSegment, chatLinks } from "./chat-links";

type Link = Extract<ChatSegment, { type: "link" }>;
const linkSegments = (text: string) => chatLinks(text).filter((s): s is Link => s.type === "link");
/** [href, text shown, external] for each link. */
const links = (text: string) => linkSegments(text).map((s) => [s.href, s.text, s.external]);
const hrefs = (text: string) => linkSegments(text).map((s) => s.href);

describe("chat links", () => {
  it("links paths to our pages by name, without trailing punctuation", () => {
    expect(links("See /colleges/166683. Then read /aid/en/fafsa-step-by-step, and check /applications!")).toEqual([
      ["/colleges/166683", "college page", false],
      ["/aid/en/fafsa-step-by-step", "The FAFSA, step by step", false],
      ["/applications", "My college list", false],
    ]);
    expect(links("Try /colleges?major=51.38&state=TX.")).toEqual([["/colleges?major=51.38&state=TX", "matching colleges", false]]);
    expect(links("(/careers/29-1141.00) and /roadmap and /aid/")).toEqual([
      ["/careers/29-1141.00", "career page", false],
      ["/roadmap", "Roadmap", false],
      ["/aid", "Financial aid guide", false],
    ]);
  });

  it("links college searches in full, however collegeSearchHref encodes the name", () => {
    const searches = [
      { q: "ohio state", sort: "net_price" as const },
      { q: "st. john's", sort: "net_price" as const },
      { q: "Texas A&M", state: "TX", major: "51.38", credential: 3 as const, sort: "net_price" as const },
      { q: "100% online", control: 1 as const },
      { q: "San José State", size: "large" as const },
      { q: "a*b + c", page: 2 },
    ];
    for (const filters of searches) {
      const href = collegeSearchHref(filters);
      expect(hrefs(`More results: ${href}.`), href).toEqual([href]);
    }
    expect(hrefs("See /colleges?q=ohio+state&sort=net_price")).toEqual(["/colleges?q=ohio+state&sort=net_price"]);
    expect(hrefs("See /colleges?q=st.+john%27s&sort=net_price")).toEqual(["/colleges?q=st.+john%27s&sort=net_price"]);
    expect(hrefs("See /colleges?q=ohio%20state&sort=net_price")).toEqual(["/colleges?q=ohio%20state&sort=net_price"]);
  });

  it("names the guide's sections in the page's language", () => {
    const [es] = linkSegments("Tu familia puede leer /aid/es/fafsa-step-by-step");
    expect(es).toMatchObject({ href: "/aid/es/fafsa-step-by-step", text: "La FAFSA, paso a paso", lang: "es" });
    expect(linkSegments("/aid/es")[0]).toMatchObject({ href: "/aid/es", text: "Guía de ayuda financiera", lang: "es" });
    expect(linkSegments("/aid/en/how-aid-works")[0].lang).toBeUndefined();
    for (const id of AID_GUIDE_SECTION_IDS) {
      for (const lang of ["en", "es"]) {
        const [link] = linkSegments(`/aid/${lang}/${id}`);
        expect(link.href).toBe(`/aid/${lang}/${id}`);
        expect(link.text).not.toContain("/");
      }
    }
  });

  it("sends a guide section that doesn't exist to the guide's contents", () => {
    expect(links("/aid/en/made-up-section")).toEqual([["/aid/en", "Financial aid guide", false]]);
    expect(links("/aid/fr/how-aid-works /aid/en/a/b")).toEqual([]);
  });

  it("links other websites only over https", () => {
    expect(links("Go to https://studentaid.gov/h/apply-for-aid/fafsa.")).toEqual([
      ["https://studentaid.gov/h/apply-for-aid/fafsa", "https://studentaid.gov/h/apply-for-aid/fafsa", true],
    ]);
    expect(links("Go to http://example.com/free-money now")).toEqual([]);
    expect(links("Log in at http://studentaid.gov.example.xyz/login")).toEqual([]);
    expect(links("http://studentaid.gov")).toEqual([]);
  });

  it("never links paths that climb out with '..', even encoded", () => {
    const tricks = [
      "See /aid/../../api/parent/children/x/export",
      "Go to /aid/../login?next=%2F%2Fevil.com",
      "/colleges/./166683",
      "/aid/%2e%2e/login",
      "/aid/en/..%2f..%2flogin",
      "/colleges/%2E%2E/login",
      "/colleges\\..\\login",
      "/aid/./",
    ];
    for (const text of tricks) expect(links(text), text).toEqual([]);
  });

  it("leaves other slashes and unsafe addresses alone", () => {
    expect(links("and/or 24/7 /etc/passwd /login /api/counselor javascript:https://evil.com")).toEqual([]);
    expect(links("/constructor /toString /__proto__ /Colleges/1 /colleges/abc /careers/nurse /roadmap?next=/login /colleges#x")).toEqual([]);
    expect(links("https://studentaid.gov/colleges/1")).toEqual([["https://studentaid.gov/colleges/1", "https://studentaid.gov/colleges/1", true]]);
    expect(links("https://studentaid.gov/x/(/colleges/1)")).toEqual([
      ["https://studentaid.gov/x/(/colleges/1)", "https://studentaid.gov/x/(/colleges/1)", true],
    ]);
  });

  it("keeps all the text", () => {
    const text = "Look at /colleges/1 and https://bls.gov/ooh today, not http://x.com/colleges /aid/en/how-aid-works.";
    expect(chatLinks(text).map((s) => (s.type === "link" ? s.source : s.text)).join("")).toBe(text);
  });
});

describe("chat link rendering", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Linked, { text }));
  /** Each <a> as its attributes (in any order) and its inner html. */
  const anchors = (html: string) =>
    [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
      attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])),
      inner,
    }));

  it("shows our pages by name, linked to their path", () => {
    const [college, guide] = anchors(render("Check /colleges/166683 and /aid/es/how-aid-works."));
    expect(college).toEqual({ attrs: { href: "/colleges/166683", class: "underline underline-offset-2" }, inner: "college page" });
    expect(guide.attrs).toMatchObject({ href: "/aid/es/how-aid-works", lang: "es", hrefLang: "es" });
    expect(guide.inner).toBe("Cómo funciona la ayuda financiera");
  });

  it("says when a link opens in a new tab", () => {
    const [a] = anchors(render("See https://studentaid.gov/."));
    expect(a.attrs).toMatchObject({ href: "https://studentaid.gov/", target: "_blank", rel: "noopener noreferrer" });
    expect(a.inner).toMatch(/^https:\/\/studentaid.gov\/<span class="sr-only"> \(opens in a new tab\)<\/span><span aria-hidden="true"[^>]*>↗<\/span>$/);
  });

  it("links only government, college and a few trusted sites", () => {
    const external = (text: string) => chatLinks(text).filter((s) => s.type === "link" && s.external).map((s) => (s.type === "link" ? s.href : ""));
    expect(external("See https://studentaid.gov/h/apply-for-aid/fafsa and https://www.collegeboard.org/ and https://www.ucla.edu")).toHaveLength(3);
    expect(external("Watch out for https://studentaid-gov.help/free-money and https://fafsa-help.com")).toEqual([]);
  });
});
