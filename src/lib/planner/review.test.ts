import { describe, expect, it } from "vitest";
import { toCredits, toUnits, schoolYearLabel } from "./common";
import { DRAFT_NOTICE, STANDING_PLAN_NOTE, TX_ALGEBRA_2_NOTE } from "./copy";
import { fixtureGraduationFile } from "./fixtures";
import { contentFingerprint, isStale, reviewLabel, staleAfter, staleLabel } from "./review";

describe("units", () => {
  it("counts credits in quarter units", () => {
    expect(toUnits(1)).toBe(4);
    expect(toUnits(0.5)).toBe(2);
    expect(toUnits(3.5)).toBe(14);
    expect(toCredits(22)).toBe(5.5);
    expect(() => toUnits(0.3)).toThrow(RangeError);
  });

  it("names school years", () => {
    expect(schoolYearLabel(2026)).toBe("2026-27");
    expect(schoolYearLabel(2099)).toBe("2099-00");
  });
});

describe("review and staleness", () => {
  it("labels draft content for everyone", () => {
    expect(reviewLabel({ status: "draft" })).toBe("Not yet reviewed by a school counselor");
    expect(reviewLabel({ status: "counselor-reviewed", reviewedBy: "A counselor", reviewedOn: "2026-12-01" })).toBe(
      "Reviewed by a school counselor on 2026-12-01",
    );
  });

  it("goes stale after July 31 following the school year, or after a re-check date", () => {
    expect(staleAfter(2026)).toBe("2027-07-31");
    expect(isStale("2027-07-31", 2026)).toBe(false);
    expect(isStale("2027-08-01", 2026)).toBe(true);
    expect(isStale("2026-10-01", 2026, "2026-09-15")).toBe(true);
    expect(staleLabel(2026)).toBe("Checked for 2026-27; being re-checked. Ask your counselor.");
  });

  it("fingerprints content, not the review block or key order", () => {
    const file = fixtureGraduationFile();
    const reviewed = { ...file, review: { status: "counselor-reviewed" as const, reviewedBy: "A", reviewedOn: "2026-10-01" } };
    expect(contentFingerprint(reviewed)).toBe(contentFingerprint(file));
    const reordered = Object.fromEntries(Object.entries(file).reverse()) as typeof file;
    expect(contentFingerprint(reordered)).toBe(contentFingerprint(file));
    const edited = { ...file, ruleSets: [{ ...file.ruleSets[0], title: "Changed" }] };
    expect(contentFingerprint(edited)).not.toBe(contentFingerprint(file));
    expect(contentFingerprint(file)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("fixed wording", () => {
  it("keeps the draft notice, the standing note and the Texas Algebra II wording", () => {
    expect(DRAFT_NOTICE).toBe("Draft: take this to your school counselor.");
    expect(STANDING_PLAN_NOTE).toMatch(/IEP or 504 plan, or are learning English/);
    expect(TX_ALGEBRA_2_NOTE).toMatch(/lowers your priority for the TEXAS Grant/);
    expect(TX_ALGEBRA_2_NOTE).not.toMatch(/TEOG|no TEXAS Grant/);
  });
});
