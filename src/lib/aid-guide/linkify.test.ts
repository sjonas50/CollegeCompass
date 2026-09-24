import { describe, expect, it } from "vitest";
import { type TextSegment, findAddresses, linkify, toSafeHref } from "./linkify";

const links = (text: string) => linkify(text).filter((s): s is Extract<TextSegment, { type: "link" }> => s.type === "link");
const joined = (segments: TextSegment[]) => segments.map((s) => s.text).join("");

describe("linkify", () => {
  it("turns a bare https address into a link and keeps the text around it", () => {
    expect(linkify("Apply at https://studentaid.gov today.")).toEqual([
      { type: "text", text: "Apply at " },
      { type: "link", text: "https://studentaid.gov", href: "https://studentaid.gov/" },
      { type: "text", text: " today." },
    ]);
  });

  it("links an address at the very start or end, and several in one sentence", () => {
    expect(links("https://studentaid.gov").map((l) => l.text)).toEqual(["https://studentaid.gov"]);
    expect(links("Use https://fafsa.gov or https://cssprofile.collegeboard.org/").map((l) => l.text)).toEqual([
      "https://fafsa.gov",
      "https://cssprofile.collegeboard.org/",
    ]);
  });

  it("returns plain text untouched", () => {
    expect(linkify("No links here.")).toEqual([{ type: "text", text: "No links here." }]);
    expect(linkify("")).toEqual([]);
  });

  it("keeps paths, queries and anchors", () => {
    expect(links("See https://studentaid.gov/h/apply-for-aid/fafsa?lang=es#deadlines now")[0].text).toBe(
      "https://studentaid.gov/h/apply-for-aid/fafsa?lang=es#deadlines",
    );
  });

  it("leaves sentence punctuation and closing brackets out of the link", () => {
    for (const [text, address] of [
      ["Go to https://studentaid.gov.", "https://studentaid.gov"],
      ["Go to https://studentaid.gov, then sign in.", "https://studentaid.gov"],
      ["Is it https://studentaid.gov?", "https://studentaid.gov"],
      ["the FAFSA (https://studentaid.gov/fafsa) is free", "https://studentaid.gov/fafsa"],
      ["[https://studentaid.gov]", "https://studentaid.gov"],
      ["“https://studentaid.gov”", "https://studentaid.gov"],
      ["«https://studentaid.gov/es»", "https://studentaid.gov/es"],
      ["¿Ya visitó https://studentaid.gov/es?", "https://studentaid.gov/es"],
      ["https://studentaid.gov—it's free", "https://studentaid.gov"],
    ]) {
      expect(links(text).map((l) => l.text), text).toEqual([address]);
    }
  });

  it("keeps brackets that belong to the address", () => {
    expect(links("See https://en.wikipedia.org/wiki/Pell_Grant_(US) for history.")[0].text).toBe(
      "https://en.wikipedia.org/wiki/Pell_Grant_(US)",
    );
  });

  it("links http addresses too (the content checks require https)", () => {
    expect(links("http://studentaid.gov")[0].href).toBe("http://studentaid.gov/");
  });

  it("always gives back exactly the text it was given", () => {
    const samples = [
      "Apply at https://studentaid.gov today.",
      "(https://studentaid.gov/fafsa), https://fafsa.gov.",
      "javascript:alert(1) and data:text/html,<b>hi</b>",
      "https://studentaid.gov@evil.example and https://xn--80ak6aa92e.com",
      "  spaces   and\nnew lines https://studentaid.gov  ",
    ];
    for (const text of samples) expect(joined(linkify(text))).toBe(text);
  });

  describe("never links anything but a real web address", () => {
    it.each([
      ["a javascript: URL", "Click javascript:alert(1)"],
      ["a javascript: URL in mixed case", "Click JaVaScRiPt:alert(document.cookie)"],
      ["a javascript: URL wrapped around an address", "Click javascript:https://studentaid.gov"],
      ["a javascript: URL that comments out an address", "Click javascript:alert(1)//https://studentaid.gov"],
      ["a data: URL", "Open data:text/html,<script>alert(1)</script>"],
      ["a base64 data: URL", "Open data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
      ["a data: URL with an address inside", "Open data:text/html,https://studentaid.gov"],
      ["a vbscript: URL", "vbscript:msgbox(1)"],
      ["a file: URL", "file:///etc/passwd"],
      ["an ftp: URL", "ftp://studentaid.gov/file"],
      ["a protocol-relative address", "//evil.example/steal"],
      ["an address without a scheme", "www.studentaid.gov or studentaid.gov"],
      ["a misspelled scheme", "hxxps://studentaid.gov and htps://studentaid.gov"],
      ["a scheme glued to a word", "xhttps://evil.example and fakehttps://evil.example"],
      ["a scheme with one slash", "https:/studentaid.gov"],
      ["a scheme without a colon", "https//studentaid.gov"],
      ["full-width letters", "ｈｔｔｐｓ://studentaid.gov"],
      ["a full-width colon", "https：//studentaid.gov"],
      ["a user:password@ look-alike", "https://studentaid.gov@evil.example/login"],
      ["a username look-alike", "https://studentaid.gov:pass@evil.example"],
      ["a look-alike letter from another alphabet", "https://studentaıd.gov"],
      ["a Cyrillic look-alike domain", "https://аpple.com"],
      ["a punycode domain", "https://xn--80ak6aa92e.com"],
      ["a hidden zero-width character", "https://student​aid.gov"],
      ["an IP address", "https://127.0.0.1/admin"],
      ["localhost", "http://localhost:3000"],
      ["a scheme with no host", "https://"],
      ["an address with a backslash", "https://studentaid.gov\\@evil.example"],
    ])("%s", (_name, text) => {
      expect(links(text)).toEqual([]);
      expect(joined(linkify(text))).toBe(text);
    });
  });

  it("stops an address at a quote, so nothing can break out of the href", () => {
    const [link] = links('See https://studentaid.gov"onmouseover="alert(1) now');
    expect(link.text).toBe("https://studentaid.gov");
    expect(link.href).not.toMatch(/["'<>]/);
    expect(links("https://studentaid.gov<script>alert(1)</script>")[0].text).toBe("https://studentaid.gov");
  });
});

describe("toSafeHref", () => {
  it("normalizes a safe address", () => {
    expect(toSafeHref("https://StudentAid.gov/fafsa")).toBe("https://studentaid.gov/fafsa");
  });

  it("can require https", () => {
    expect(toSafeHref("http://studentaid.gov", { requireHttps: true })).toBeNull();
    expect(toSafeHref("https://studentaid.gov", { requireHttps: true })).toBe("https://studentaid.gov/");
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "mailto:help@studentaid.gov", "https://studentaid.gov @evil", " https://studentaid.gov", "https://a b.gov", "https://studentaid"])(
    "rejects %s",
    (candidate) => expect(toSafeHref(candidate)).toBeNull(),
  );
});

describe("findAddresses", () => {
  it("finds every written address, linkable or not", () => {
    expect(findAddresses("a https://studentaid.gov b http://x c javascript:https://evil.example")).toEqual([
      "https://studentaid.gov",
      "http://x",
      "https://evil.example",
    ]);
  });
});
