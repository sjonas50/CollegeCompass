import { describe, expect, it } from "vitest";
import { applicationCycle, keyDateStatus, keyDates, keyDatesFor } from "./key-dates";

const at = (iso: string) => new Date(`${iso}T18:00:00Z`);

describe("applicationCycle", () => {
  it("runs June through May", () => {
    expect(applicationCycle(at("2026-09-24"))).toBe(2026);
    expect(applicationCycle(at("2026-06-01"))).toBe(2026);
    expect(applicationCycle(at("2027-03-01"))).toBe(2026);
    expect(applicationCycle(at("2027-05-31"))).toBe(2026);
    expect(applicationCycle(at("2027-06-01"))).toBe(2027);
  });
});

describe("keyDates", () => {
  it("uses the verified 2027–28 FAFSA date for the 2026–27 cycle", () => {
    const fafsa = keyDates(2026).find((d) => d.id === "fafsa");
    expect(fafsa).toMatchObject({ when: "By October 1, 2026", start: "2026-10-01", opens: true, title: "The 2027–28 FAFSA opens" });
  });

  it("falls back to the usual pattern for years without a confirmed date", () => {
    const fafsa = keyDates(2027).find((d) => d.id === "fafsa");
    expect(fafsa?.when).toBe("Usually October 1");
    expect(fafsa?.detail).toContain("Check studentaid.gov");
  });

  it("describes college deadlines as patterns, never promises", () => {
    for (const item of keyDates(2026).filter((d) => ["early-decision", "early-action", "regular", "decision-day"].includes(d.id))) {
      expect(item.when, item.id).toMatch(/^Often /);
      expect(item.detail, item.id).toMatch(/[Cc]heck each college|double-check/);
    }
  });

  it("covers the whole year in order, with state aid linked to studentaid.gov", () => {
    const items = keyDates(2026);
    expect(items.map((d) => d.id)).toEqual(["fafsa", "css-profile", "state-aid", "early-decision", "early-action", "regular", "decision-day"]);
    expect(items.find((d) => d.id === "state-aid")?.link?.href).toBe("https://studentaid.gov/apply-for-aid/fafsa/fafsa-deadlines");
    expect(items.find((d) => d.id === "decision-day")).toMatchObject({ when: "Often May 1, 2027", start: "2027-05-01" });
    for (const item of items) {
      if (item.link?.external) expect(item.link.href).toMatch(/^https:\/\/([a-z]+\.)?(studentaid\.gov|collegeboard\.org)\//);
    }
  });
});

describe("keyDateStatus", () => {
  const [fafsa, , stateAid, early, earlyAction, regular] = keyDates(2026);

  it("marks forms as open once they open", () => {
    expect(keyDateStatus(fafsa, "2026-09-30")).toBe("upcoming");
    expect(keyDateStatus(fafsa, "2026-10-01")).toBe("open_now");
    expect(keyDateStatus(fafsa, "2027-04-01")).toBe("open_now");
  });

  it("marks deadlines as passed only after their last day", () => {
    expect(keyDateStatus(early, "2026-11-01")).toBe("upcoming");
    expect(keyDateStatus(early, "2026-11-02")).toBe("passed");
    expect(keyDateStatus(earlyAction, "2026-11-15")).toBe("upcoming");
    expect(keyDateStatus(regular, "2027-02-01")).toBe("upcoming");
    expect(keyDateStatus(regular, "2027-03-02")).toBe("passed");
    expect(keyDateStatus(stateAid, "2026-09-24")).toBe("varies");
  });

  it("labels the school year", () => {
    const year = keyDatesFor(at("2026-09-24"));
    expect(year).toMatchObject({ cycle: 2026, schoolYear: "2026–27", startsCollege: 2027 });
    expect(year.items.find((i) => i.id === "fafsa")?.status).toBe("upcoming");
    expect(keyDatesFor(at("2026-12-01")).items.find((i) => i.id === "early-decision")?.status).toBe("passed");
  });
});
