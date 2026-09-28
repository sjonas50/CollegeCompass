import { describe, expect, it } from "vitest";
import { FAMILY_IDS, getFamily, isFamilyId, MAJOR_FAMILIES, MATH_TARGET_DEFS, MATH_TARGETS, routeCip } from "./families";
import { fixtureCipRouting } from "./fixtures";

describe("major families", () => {
  it("has the research's 32 families, numbered 1-32, with unique ids", () => {
    expect(MAJOR_FAMILIES).toHaveLength(32);
    expect(MAJOR_FAMILIES.map((f) => f.number)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(new Set(FAMILY_IDS).size).toBe(32);
    for (const id of FAMILY_IDS) expect(id).toMatch(/^[a-z][a-z_]*$/);
    expect(getFamily("nursing").number).toBe(8);
    expect(isFamilyId("engineering")).toBe(true);
    expect(isFamilyId("premed")).toBe(false);
  });

  it("defines every math target, with a minimum at or below the target", () => {
    for (const code of MATH_TARGETS) {
      const def = MATH_TARGET_DEFS[code];
      expect(def.minimumRank).toBeLessThanOrEqual(def.rank);
      expect(def.minimum.length).toBeGreaterThan(0);
    }
    expect(MATH_TARGET_DEFS.CALC.rank).toBe(5);
    expect(MATH_TARGET_DEFS.STATS.statistics).toBe(true);
  });
});

describe("routeCip", () => {
  const rules = fixtureCipRouting().rules;

  it("takes the first matching rule", () => {
    expect(routeCip("51.0904", rules)).toBe("public_safety"); // EMS before "any other 51"
    expect(routeCip("51.3801", rules)).toBe("nursing");
    expect(routeCip("51.2601", rules)).toBe("practical_nursing");
    expect(routeCip("51.0801", rules)).toBe("allied_health");
    expect(routeCip("11.0701", rules)).toBe("computer_data_science");
    expect(routeCip("11.0901", rules)).toBe("it_cybersecurity");
    expect(routeCip("15.1201", rules)).toBe("it_cybersecurity"); // 15.12 before "15"
    expect(routeCip("15.0303", rules)).toBe("engineering_tech");
    expect(routeCip("14.0901", rules)).toBe("engineering");
  });

  it("gives no family to codes no rule matches, or to malformed codes", () => {
    expect(routeCip("24.0101", rules)).toBeNull();
    expect(routeCip("51", rules)).toBeNull();
    expect(routeCip("5138.01", rules)).toBeNull();
  });
});
