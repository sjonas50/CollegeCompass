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
/** Each <a> as its attributes (in any order) and its inner html. */
const anchors = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    attrs: Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])),
    inner,
  }));

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
    const texts = [
      "Look at /colleges/1 and https://bls.gov/ooh today, not http://x.com/colleges /aid/en/how-aid-works.",
      "- Boston College (/colleges/164924): see [the guide](/aid/en) and StudentAid.gov's help at studentaid.gov/es.",
    ];
    for (const text of texts) expect(chatLinks(text).map((s) => (s.type === "link" ? s.source : s.text)).join("")).toBe(text);
  });
});

describe("chat links to colleges and careers", () => {
  /** What a screen reader hears: the text, with each link's text in its place. */
  const shown = (text: string) => chatLinks(text).map((s) => s.text).join("");

  it("names each college by the name written with it, so two in a row don't sound the same", () => {
    const reply = "Two to look at:\n- Boston College (/colleges/164924): about $30,000 a year\n- Cornell University (/colleges/190415)";
    expect(links(reply)).toEqual([
      ["/colleges/164924", "Boston College", false],
      ["/colleges/190415", "Cornell University", false],
    ]);
    expect(shown(reply)).toBe("Two to look at:\n- Boston College: about $30,000 a year\n- Cornell University");
    expect(links("You might like Ohio State (/colleges/204796) or Texas A&M (/colleges/228723).")).toEqual([
      ["/colleges/204796", "Ohio State", false],
      ["/colleges/228723", "Texas A&M", false],
    ]);
    expect(
      links("Look at St. Olaf College (/colleges/174844), the University of Texas at Austin (/colleges/228778) and U.S. Naval Academy (/colleges/291236)."),
    ).toEqual([
      ["/colleges/174844", "St. Olaf College", false],
      ["/colleges/228778", "University of Texas at Austin", false],
      ["/colleges/291236", "U.S. Naval Academy", false],
    ]);
    expect(links("Registered Nurses (/careers/29-1141.00) and Electricians (/careers/47-2111.00)")).toEqual([
      ["/careers/29-1141.00", "Registered Nurses", false],
      ["/careers/47-2111.00", "Electricians", false],
    ]);
  });

  it("uses the label of a markdown link, and our own name for pages we name", () => {
    expect(links("Compare [Boston College](/colleges/164924) and [Cornell](/colleges/190415).")).toEqual([
      ["/colleges/164924", "Boston College", false],
      ["/colleges/190415", "Cornell", false],
    ]);
    expect(links("See [nursing programs in Texas](/colleges?major=51.38&state=TX).")).toEqual([
      ["/colleges?major=51.38&state=TX", "nursing programs in Texas", false],
    ]);
    const [guide] = linkSegments("Tu familia puede leer [the guide](/aid/es/fafsa-step-by-step).");
    expect(guide).toMatchObject({ text: "La FAFSA, paso a paso", lang: "es", source: "[the guide](/aid/es/fafsa-step-by-step)" });
    // Not a usable label: only the path is linked.
    expect(links("[](/colleges/1) [a\nb](/colleges/2)")).toEqual([
      ["/colleges/1", "college page", false],
      ["/colleges/2", "college page", false],
    ]);
  });

  it("says \"college page\" when no name is written with it", () => {
    expect(links("Its College Compass page (/colleges/164924) links the calculator. Also see /colleges/190415.")).toEqual([
      ["/colleges/164924", "college page", false],
      ["/colleges/190415", "college page", false],
    ]);
    expect(links("(/colleges/1) and\nBoston College\n(/colleges/2)")).toEqual([
      ["/colleges/1", "college page", false],
      ["/colleges/2", "college page", false],
    ]);
    // A name never takes in another link or a sentence starter.
    expect(links("See https://www.bc.edu Boston College (/colleges/164924). This (/colleges/1)")).toEqual([
      ["https://www.bc.edu/", "https://www.bc.edu", true],
      ["/colleges/164924", "Boston College", false],
      ["/colleges/1", "college page", false],
    ]);
  });
});

describe("chat links to trusted sites written without https://", () => {
  it("links them over https, showing what the counselor wrote", () => {
    expect(links("Confirm dates at studentaid.gov. For pay, see bls.gov/ooh, or call or text 988 (988lifeline.org).")).toEqual([
      ["https://studentaid.gov/", "studentaid.gov", true],
      ["https://www.bls.gov/ooh", "bls.gov/ooh", true],
      ["https://988lifeline.org/", "988lifeline.org", true],
    ]);
    expect(links("StudentAid.gov's guide, www.fafsa.gov, collegescorecard.ed.gov, collegeboard.org, act.org and apprenticeship.gov")).toEqual([
      ["https://studentaid.gov/", "StudentAid.gov", true],
      ["https://fafsa.gov/", "www.fafsa.gov", true],
      ["https://collegescorecard.ed.gov/", "collegescorecard.ed.gov", true],
      ["https://www.collegeboard.org/", "collegeboard.org", true],
      ["https://www.act.org/", "act.org", true],
      ["https://www.apprenticeship.gov/", "apprenticeship.gov", true],
    ]);
    expect(links("See studentaid.gov/es or https://studentaid.gov/h/apply-for-aid/fafsa")).toEqual([
      ["https://studentaid.gov/es", "studentaid.gov/es", true],
      ["https://studentaid.gov/h/apply-for-aid/fafsa", "https://studentaid.gov/h/apply-for-aid/fafsa", true],
    ]);
  });

  it("never links look-alikes, other sites or anything added to the name", () => {
    const tricks = [
      "studentaid.gov.help",
      "fake-studentaid.gov",
      "my.studentaid.gov",
      "xstudentaid.gov",
      "studentaid.gove",
      "studentaid.gov@evil.com",
      "help@studentaid.gov",
      "studentaid.gov:8080",
      "studentaid.gov?next=evil.com",
      "studentaid.gov#top",
      "studentaid.gov/../login",
      "evil.com/studentaid.gov",
      "http://studentaid.gov",
      "javascript:studentaid.gov",
      "irs.gov",
      "gov",
    ];
    for (const text of tricks) expect(links(`Go to ${text} now`), text).toEqual([]);
  });

  it("open in a new tab and say so", () => {
    const [a] = anchors(renderToStaticMarkup(createElement(Linked, { text: "Check studentaid.gov." })));
    expect(a.attrs).toMatchObject({ href: "https://studentaid.gov/", target: "_blank", rel: "noopener noreferrer" });
    expect(a.inner).toMatch(/^studentaid\.gov<span class="sr-only"> \(opens in a new tab\)<\/span>/);
  });
});

describe("chat link rendering", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(Linked, { text }));

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
    expect(external("Try https://npc.collegeboard.org/app/umich or https://apply.commonapp.org")).toHaveLength(2);
    expect(external("Not https://collegeboard.org.evil.com or https://evilcollegeboard.org")).toEqual([]);
  });
});
