import { describe, expect, it } from "vitest";
import { MATCH_FAMILIES, NOT_MATCHED_FOR_MINORS, REVIEWED_AND_KEPT, isAllowedForMinors, isPostsecondaryTeacher, matchFamily } from "./minors";

describe("careers never matched for minors", () => {
  const entries = Object.entries(NOT_MATCHED_FOR_MINORS);

  it("are a short list of O*NET codes, each with its title and a one-line reason", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(12);
    for (const [code, { title, reason }] of entries) {
      expect(code).toMatch(/^\d{2}-\d{4}\.\d{2}$/);
      expect(title.trim()).toBe(title);
      expect(reason).toMatch(/^[A-Z][^\n]{10,110}\.$/);
      expect(isAllowedForMinors(code)).toBe(false);
    }
  });

  it("stay conservative: only gambling and serving alcohol", () => {
    for (const { title } of Object.values(NOT_MATCHED_FOR_MINORS)) expect(title).toMatch(/^(?:.*\bGambling\b.*|Bartenders)$/);
    // Everything else is still a possible match, including careers that are only thinned out.
    for (const code of ["41-9012.00", "25-1123.00", "35-3031.00", "27-2031.00", "31-9011.00", ...Object.keys(REVIEWED_AND_KEPT)]) {
      expect(isAllowedForMinors(code)).toBe(true);
    }
  });

  it("don't overlap the careers reviewed and kept", () => {
    for (const code of Object.keys(REVIEWED_AND_KEPT)) expect(Object.hasOwn(NOT_MATCHED_FOR_MINORS, code)).toBe(false);
    // Titles that only mention gambling to rule it out.
    expect(REVIEWED_AND_KEPT["11-9072.00"].title).toMatch(/Except Gambling$/);
  });

  it("aren't fooled by object keys", () => {
    expect(isAllowedForMinors("constructor")).toBe(true);
    expect(isAllowedForMinors("toString")).toBe(true);
  });
});

describe("families shown once per results group", () => {
  it("are college teaching jobs and modeling", () => {
    expect(MATCH_FAMILIES.map((f) => f.id)).toEqual(["postsecondary-teacher", "model"]);
    expect(matchFamily({ code: "25-1072.00", title: "Nursing Instructors and Teachers, Postsecondary" })).toBe("postsecondary-teacher");
    expect(matchFamily({ code: "25-1194.00", title: "Career/Technical Education Teachers, Postsecondary" })).toBe("postsecondary-teacher");
    expect(matchFamily({ code: "41-9012.00", title: "Models" })).toBe("model");
  });

  it("leave out lookalikes", () => {
    for (const career of [
      { code: "11-9033.00", title: "Education Administrators, Postsecondary" },
      { code: "25-9044.00", title: "Teaching Assistants, Postsecondary" },
      { code: "25-2031.00", title: "Secondary School Teachers, Except Special and Career/Technical Education" },
      { code: "25-1069.00", title: "Social Sciences Teachers, Postsecondary, All Other" },
      { code: "51-4061.00", title: "Model Makers, Metal and Plastic" },
      { code: "41-9011.00", title: "Demonstrators and Product Promoters" },
    ]) {
      expect(matchFamily(career)).toBeNull();
    }
    expect(isPostsecondaryTeacher("Postsecondary Teachers, All Other")).toBe(false);
  });
});
