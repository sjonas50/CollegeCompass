import { describe, expect, it } from "vitest";
import { chatLinks } from "./chat-links";

const links = (text: string) => chatLinks(text).filter((s) => s.type === "link").map((s) => (s.type === "link" ? [s.href, s.external] : null));

describe("chat links", () => {
  it("links paths to our pages, without trailing punctuation", () => {
    expect(links("See /colleges/166683. Then read /aid/en/fafsa-step-by-step, and check /applications!")).toEqual([
      ["/colleges/166683", false],
      ["/aid/en/fafsa-step-by-step", false],
      ["/applications", false],
    ]);
    expect(links("Try /colleges?major=51.38&state=TX.")).toEqual([["/colleges?major=51.38&state=TX", false]]);
  });

  it("links official https addresses as external", () => {
    expect(links("Go to https://studentaid.gov/h/apply-for-aid/fafsa.")).toEqual([["https://studentaid.gov/h/apply-for-aid/fafsa", true]]);
  });

  it("leaves other slashes and unsafe addresses alone", () => {
    expect(links("and/or 24/7 /etc/passwd /login javascript:https://evil.com")).toEqual([]);
    expect(links("https://studentaid.gov/colleges/1")).toEqual([["https://studentaid.gov/colleges/1", true]]);
  });

  it("keeps all the text", () => {
    const text = "Look at /colleges/1 and https://bls.gov/ooh today.";
    expect(chatLinks(text).map((s) => s.text).join("")).toBe(text);
  });
});
