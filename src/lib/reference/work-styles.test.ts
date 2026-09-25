import { describe, expect, it } from "vitest";
import { createTestDb, schema } from "@/db";
import { BIG_FIVE } from "../assessments/instruments";
import {
  MAPPED_STYLES,
  MAPPED_TRAITS,
  TRAIT_WORK_STYLES,
  WORK_STYLES,
  WORK_STYLE_INFO,
  distinctiveStyles,
  getOccupationWorkStyles,
  strengthsForCareer,
  traitForStyle,
  workStyleForElement,
} from "./work-styles";

describe("O*NET work styles", () => {
  it("knows all 21 styles of O*NET 31.0 in four groups", () => {
    expect(WORK_STYLES).toHaveLength(21);
    expect(new Set(WORK_STYLES.map((s) => s.elementId)).size).toBe(21);
    const prefix = { achievement: "1.D.1.", interpersonal: "1.D.2.", conscientiousness: "1.D.3.", adjustment: "1.D.4." };
    for (const s of WORK_STYLES) expect(s.elementId.startsWith(prefix[s.group])).toBe(true);
    expect(WORK_STYLES.filter((s) => s.group === "adjustment").map((s) => s.onetName)).toEqual(["Stress Tolerance", "Self-Control"]);
    expect(workStyleForElement("1.D.3.b")).toBe("attention_to_detail");
    expect(workStyleForElement(" 1.D.4.a ")).toBe("stress_tolerance");
    expect(workStyleForElement("1.D.5.a")).toBeNull();
    expect(workStyleForElement(undefined)).toBeNull();
  });

  it("describes every style in plain, short sentences", () => {
    for (const s of WORK_STYLES) {
      expect(s.description).toMatch(/^[A-Z].*\.$/);
      expect(s.description.split(" ").length).toBeLessThanOrEqual(16);
    }
  });
});

describe("mapping Mini-IPIP traits to work styles", () => {
  it("maps exactly the agreed styles", () => {
    expect(TRAIT_WORK_STYLES).toEqual({
      intellect: ["innovation", "intellectual_curiosity", "tolerance_for_ambiguity", "adaptability"],
      conscientiousness: ["attention_to_detail", "dependability", "perseverance", "achievement_orientation"],
      extraversion: ["social_orientation", "leadership_orientation"],
      agreeableness: ["empathy", "cooperation"],
    });
    expect(MAPPED_STYLES).toHaveLength(12);
    expect(traitForStyle("empathy")).toBe("agreeableness");
    expect(traitForStyle("integrity")).toBeNull();
  });

  it("never uses emotional stability or the adjustment styles", () => {
    expect(MAPPED_TRAITS).toEqual(BIG_FIVE.filter((t) => t !== "neuroticism"));
    expect(Object.keys(TRAIT_WORK_STYLES)).not.toContain("neuroticism");
    for (const style of MAPPED_STYLES) expect(WORK_STYLE_INFO[style].group).not.toBe("adjustment");
    expect(traitForStyle("stress_tolerance")).toBeNull();
    expect(traitForStyle("self_control")).toBeNull();
  });

  it("links each style to one trait at most", () => {
    const all = MAPPED_TRAITS.flatMap((t) => TRAIT_WORK_STYLES[t]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("where a student's strengths help", () => {
  const traits = { extraversion: 20, agreeableness: 90, conscientiousness: 55, neuroticism: 95, intellect: 80 };

  it("links styles to strengths the student scored high on, and the rest are skills to build", () => {
    // Registered Nurses' most distinctive styles in O*NET 31.0.
    const { helps, building } = strengthsForCareer(
      ["integrity", "cautiousness", "cooperation", "social_orientation", "self_control", "stress_tolerance", "empathy"],
      traits,
    );
    expect(helps.map((h) => [h.style, h.strength.name])).toEqual([
      ["cooperation", "Warmth"],
      ["empathy", "Warmth"],
    ]);
    // Quiet (extraversion 20) and middling organization aren't called weaknesses: those styles are
    // simply skills to build, like the ones no trait is linked to.
    expect(building).toEqual(["integrity", "cautiousness", "social_orientation", "self_control", "stress_tolerance"]);
  });

  it("never links stress tolerance or self-control to how calm a student is", () => {
    for (const neuroticism of [0, 50, 100]) {
      const { helps } = strengthsForCareer(["stress_tolerance", "self_control"], { ...traits, neuroticism });
      expect(helps).toEqual([]);
    }
  });
});

describe("an occupation's work styles", () => {
  it("loads them most distinctive first and lists the distinctive ones that help", async () => {
    const db = await createTestDb();
    await db.insert(schema.occupations).values({ code: "15-1252.00", title: "Software Developers", description: "" });
    // Software Developers in O*NET 31.0, plus Humility, which hurts some work (made up here).
    await db.insert(schema.occupationWorkStyles).values([
      { occupationCode: "15-1252.00", style: "dependability", impact: 2.41, distinctiveRank: 6 },
      { occupationCode: "15-1252.00", style: "innovation", impact: 2.51, distinctiveRank: 1 },
      { occupationCode: "15-1252.00", style: "adaptability", impact: 2.09, distinctiveRank: 2 },
      { occupationCode: "15-1252.00", style: "integrity", impact: 1.79, distinctiveRank: null },
      { occupationCode: "15-1252.00", style: "humility", impact: -0.5, distinctiveRank: 7 },
    ]);
    const styles = await getOccupationWorkStyles(db, "15-1252.00");
    expect(styles.map((s) => s.style)).toEqual(["innovation", "adaptability", "dependability", "humility", "integrity"]);
    expect(distinctiveStyles(styles)).toEqual(["innovation", "adaptability", "dependability"]);
    expect(distinctiveStyles(styles, 2)).toEqual(["innovation", "adaptability"]);
    expect(await getOccupationWorkStyles(db, "11-1011.00")).toEqual([]);
  });
});
