import { describe, expect, it } from "vitest";
import { STEP_TEXT_MAX, StepTextSchema, weekStartOf } from "./steps";

describe("weekStartOf", () => {
  it("returns that week's Monday in UTC", () => {
    expect(weekStartOf(new Date("2026-09-21T00:00:00Z"))).toBe("2026-09-21"); // Monday
    expect(weekStartOf(new Date("2026-09-23T12:00:00Z"))).toBe("2026-09-21"); // Wednesday
    expect(weekStartOf(new Date("2026-09-27T23:59:59Z"))).toBe("2026-09-21"); // Sunday night
    expect(weekStartOf(new Date("2026-09-28T00:00:00Z"))).toBe("2026-09-28"); // next Monday
  });

  it("crosses month and year boundaries", () => {
    expect(weekStartOf(new Date("2026-10-02T09:00:00Z"))).toBe("2026-09-28");
    expect(weekStartOf(new Date("2027-01-01T09:00:00Z"))).toBe("2026-12-28");
    expect(weekStartOf(new Date("2028-03-01T09:00:00Z"))).toBe("2028-02-28"); // leap year
  });

  it("uses UTC, not the server's local time", () => {
    // Sunday evening in California is already Monday in UTC.
    expect(weekStartOf(new Date("2026-09-28T02:00:00Z"))).toBe("2026-09-28");
  });
});

describe("StepTextSchema", () => {
  it("trims and accepts 1–140 characters", () => {
    expect(StepTextSchema.parse("  Ask about PSAT  ")).toBe("Ask about PSAT");
    expect(StepTextSchema.safeParse("x".repeat(STEP_TEXT_MAX)).success).toBe(true);
    expect(StepTextSchema.safeParse("x".repeat(STEP_TEXT_MAX + 1)).success).toBe(false);
    expect(StepTextSchema.safeParse("   ").success).toBe(false);
    expect(StepTextSchema.safeParse(42).success).toBe(false);
  });
});
