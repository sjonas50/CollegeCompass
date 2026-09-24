import { describe, expect, it } from "vitest";
import { safeNext } from "./forms";

/** Where a browser would end up after redirecting to `next` from our login page. */
const landsOn = (next: string) => new URL(next, "https://app.example/login").origin;

describe("safeNext", () => {
  it("keeps paths on this site, with their query", () => {
    expect(safeNext("/counselor/abc")).toBe("/counselor/abc");
    expect(safeNext("/colleges?q=ohio+state&sort=net_price")).toBe("/colleges?q=ohio+state&sort=net_price");
    expect(safeNext("/colleges?q=ohio%20state")).toBe("/colleges?q=ohio%20state");
    expect(safeNext("/aid/es/how-aid-works#sources")).toBe("/aid/es/how-aid-works#sources");
  });

  it("refuses anything that isn't a path", () => {
    for (const value of [null, undefined, "", "dashboard", "https://evil.com", "javascript:alert(1)", " /dashboard"]) {
      expect(safeNext(value), String(value)).toBeNull();
    }
    expect(safeNext(new File([], "x"))).toBeNull();
  });

  it("refuses addresses that browsers read as another site", () => {
    const tricks = [
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/ /evil.com",
      "/ /evil.com",
      "/%09/evil.com",
      "/%0a/evil.com",
      "/%5Cevil.com",
      "/%2Fevil.com",
      "/..//evil.com",
      "/%2e%2e//evil.com",
      "/%E0%A4%A",
    ];
    for (const value of tricks) {
      expect(safeNext(value), JSON.stringify(value)).toBeNull();
    }
    // The first three really do leave the site when a browser follows them as written.
    expect(landsOn("/\t/evil.com")).toBe("https://evil.com");
    expect(landsOn("/\\evil.com")).toBe("https://evil.com");
    expect(landsOn("/\n/evil.com")).toBe("https://evil.com");
  });

  it("resolves dot segments so what's checked is where the redirect goes", () => {
    expect(safeNext("/aid/../login")).toBe("/login");
    expect(safeNext("/a/./b")).toBe("/a/b");
  });

  it("gives back only paths that stay on this site", () => {
    for (const value of ["/counselor", "/colleges?q=st.+john%27s", "/aid/../dashboard"]) {
      const next = safeNext(value);
      expect(next).not.toBeNull();
      expect(landsOn(next!)).toBe("https://app.example");
    }
  });
});
