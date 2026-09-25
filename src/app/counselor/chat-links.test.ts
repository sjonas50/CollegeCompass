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
/** What the counselor wrote, put back together from the segments. */
const written = (text: string) => chatLinks(text).map((s) => s.source ?? s.text).join("");
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
      "- Cornell University, Ithaca NY — /colleges/190415 (about $30,000)\n- Registered Nurses: /careers/29-1141.00",
      "Check [studentaid.gov](https://studentaid.gov) or [here](/colleges?major=51.38).",
    ];
    for (const text of texts) expect(written(text)).toBe(text);
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

  it("uses our own name when a markdown label doesn't say where the link goes", () => {
    expect(links("[here](/colleges?major=51.38) [Click here!](/careers/29-1141.00) [this page](/colleges/1) [link](/colleges/2) [More](/colleges/3)")).toEqual([
      ["/colleges?major=51.38", "matching colleges", false],
      ["/careers/29-1141.00", "career page", false],
      ["/colleges/1", "college page", false],
      ["/colleges/2", "college page", false],
      ["/colleges/3", "college page", false],
    ]);
    expect(links("Mira [aquí](/colleges/1).")).toEqual([["/colleges/1", "college page", false]]);
    // "Here's" isn't "here": a label that says something is kept.
    expect(links("[Here's the list](/colleges?state=TX)")).toEqual([["/colleges?state=TX", "Here's the list", false]]);
  });

  it("links a markdown link once, never its label on its own", () => {
    const one = (text: string) => chatLinks(text).map((s) => (s.type === "link" ? [s.text, s.href] : s.text));
    expect(one("[/colleges/1](/colleges/1)")).toEqual([["college page", "/colleges/1"]]);
    expect(one("[/aid/en](/aid/en/how-aid-works)")).toEqual([["How financial aid works", "/aid/en/how-aid-works"]]);
    expect(one("Check [studentaid.gov](https://studentaid.gov) now")).toEqual([
      "Check [studentaid.gov](",
      ["https://studentaid.gov", "https://studentaid.gov/"],
      ") now",
    ]);
  });

  it("names a college written as 'Name, Place — /path', the way counselors list them", () => {
    // The reply from the bug report.
    const reply = "Two schools to compare:\n- Cornell University, Ithaca NY — /colleges/190415\n- Boston College, Chestnut Hill MA — /colleges/164924";
    expect(links(reply)).toEqual([
      ["/colleges/190415", "Cornell University", false],
      ["/colleges/164924", "Boston College", false],
    ]);
    // The place stays; the path, and the dash joining it, don't show.
    expect(shown(reply)).toBe("Two schools to compare:\n- Cornell University, Ithaca NY\n- Boston College, Chestnut Hill MA");
    // The chat hands each list item over without its "- ".
    expect(shown("Cornell University, Ithaca NY — /colleges/190415 — strong engineering")).toBe("Cornell University, Ithaca NY — strong engineering");
    const named = [
      "Cornell University: /colleges/190415",
      "Cornell University — /colleges/190415.",
      "Cornell University – /colleges/190415",
      "Cornell University - /colleges/190415",
      "Cornell University —/colleges/190415",
      "Cornell University, Ithaca, NY: /colleges/190415",
      "Cornell University, Ithaca, New York — /colleges/190415",
      "Cornell University in Ithaca, New York — /colleges/190415",
      "Cornell University, Ithaca NY (/colleges/190415)",
      "Here's the page for Cornell University: /colleges/190415",
    ];
    for (const text of named) {
      expect(links(text), text).toEqual([["/colleges/190415", "Cornell University", false]]);
      expect(written(text), text).toBe(text);
    }
    expect(links("North Idaho College, Coeur d'Alene ID — /colleges/142559")).toEqual([["/colleges/142559", "North Idaho College", false]]);
    expect(links("Georgetown University, Washington, D.C. — /colleges/131496")).toEqual([["/colleges/131496", "Georgetown University", false]]);
    expect(links("University of Minnesota, St. Paul, Minnesota: /colleges/174066")).toEqual([["/colleges/174066", "University of Minnesota", false]]);
    expect(shown("Rice University in Houston, Texas (/colleges/227757) is small.")).toBe("Rice University in Houston, Texas is small.");
    expect(links("Registered Nurses — /careers/29-1141.00, Electricians: /careers/47-2111.00")).toEqual([
      ["/careers/29-1141.00", "Registered Nurses", false],
      ["/careers/47-2111.00", "Electricians", false],
    ]);
  });

  it("links only the last school when names are joined by \"and\"", () => {
    expect(links("Both Georgia Tech and Emory University (/colleges/139658) are in Atlanta.")).toEqual([["/colleges/139658", "Emory University", false]]);
    expect(links("Harvard and Yale (/colleges/130794)")).toEqual([["/colleges/130794", "Yale", false]]);
    expect(links("Students like Duke and Rice University (/colleges/227757)")).toEqual([["/colleges/227757", "Rice University", false]]);
    expect(links("Harvard and the University of Chicago — /colleges/144050")).toEqual([["/colleges/144050", "University of Chicago", false]]);
    expect(links("Harvard, Yale and Cornell University — /colleges/190415")).toEqual([["/colleges/190415", "Cornell University", false]]);
    expect(shown("Both Georgia Tech and Emory University (/colleges/139658)")).toBe("Both Georgia Tech and Emory University");
  });

  it("keeps \"and\" inside a single name", () => {
    const names = [
      "College of William and Mary",
      "William & Mary",
      "Texas A&M",
      "Washington and Lee University",
      "Franklin and Marshall College",
      "Lewis and Clark College",
      "Hobart and William Smith Colleges",
      "Virginia Polytechnic Institute and State University",
      "Florida Agricultural and Mechanical University",
      "Southcentral Kentucky Community and Technical College",
      "Missouri University of Science and Technology",
      "Savannah College of Art and Design",
      "SUNY College of Environmental Science and Forestry",
      "Johnson and Wales University",
      "Davis and Elkins College",
      "Emory and Henry College",
      "Bryant and Stratton College",
      "Southern University and A&M College",
      // As the Scorecard writes it.
      "Southern University and A & M College",
      "Fond du Lac Tribal and Community College",
    ];
    for (const name of names) expect(links(`${name} (/colleges/1)`), name).toEqual([["/colleges/1", name, false]]);
    // Career titles often have "and" in them.
    expect(links("Accountants and Auditors (/careers/13-2011.00)")).toEqual([["/careers/13-2011.00", "Accountants and Auditors", false]]);
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
    // Words that say what the link is, or only a place.
    for (const text of ["Two options: /colleges/1", "Link: /colleges/1", "More — /colleges/1", "Houston, Texas — /colleges/1", "In NY: /colleges/1"]) {
      expect(links(text), text).toEqual([["/colleges/1", "college page", false]]);
    }
    // Labels before a dash or colon, the way a college list is sorted: they don't name a school.
    const labels = [
      "- Reach: /colleges/1",
      "Match — /colleges/1",
      "Safety - /colleges/1",
      "Cost: /colleges/1",
      "One in the Midwest: /colleges/1",
      "Great for Nursing — /colleges/1",
    ];
    for (const text of labels) {
      expect(links(text), text).toEqual([["/colleges/1", "college page", false]]);
      expect(written(text), text).toBe(text);
    }
  });

  it("after a dash or colon, takes a college's name only when it names a school", () => {
    const named = [
      ["Ohio State: /colleges/204796", "Ohio State"],
      ["Georgia Tech — /colleges/139755", "Georgia Tech"],
      ["- Juilliard School: /colleges/192110", "Juilliard School"],
      ["Hobart and William Smith Colleges - /colleges/191630", "Hobart and William Smith Colleges"],
      ["MIT: /colleges/166683", "MIT"],
      ["UCLA — /colleges/110662", "UCLA"],
      ["Reach: MIT — /colleges/166683", "MIT"],
    ];
    for (const [text, name] of named) expect(links(text), text).toEqual([[text.slice(text.indexOf("/")), name, false]]);
    // In parentheses the name is plainly the college's.
    expect(links("Reach: Harvard (/colleges/166027)")).toEqual([["/colleges/166027", "Harvard", false]]);
    // A career title needs no head word.
    expect(links("Registered Nurses: /careers/29-1141.00")).toEqual([["/careers/29-1141.00", "Registered Nurses", false]]);
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

  it("links a college's name and keeps its place as text", () => {
    expect(render("Cornell University, Ithaca NY — /colleges/190415")).toBe(
      '<a class="underline underline-offset-2" href="/colleges/190415">Cornell University</a>, Ithaca NY',
    );
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
