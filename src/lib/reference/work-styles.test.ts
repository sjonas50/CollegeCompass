import { readFileSync } from "node:fs";
import path from "node:path";
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
  strengthsForCareer,
  traitForStyle,
  workStyleForElement,
} from "./work-styles";
import { getOccupationWorkStyles } from "./work-styles-db";

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

  it("splits a career's styles into strengths that fit, skills to build, and the rest", () => {
    // Registered Nurses' most distinctive styles in O*NET 31.0, and two more.
    const { helps, building, other } = strengthsForCareer(
      ["integrity", "cautiousness", "cooperation", "social_orientation", "self_control", "stress_tolerance", "empathy", "dependability", "innovation"],
      traits,
    );
    // High and middle levels are both strengths on the strengths page ("Caring", "Organized when it counts").
    expect(helps.map((h) => [h.style, h.strength.label])).toEqual([
      ["cooperation", "Caring"],
      ["empathy", "Caring"],
      ["dependability", "Organized when it counts"],
      ["innovation", "Curious"],
    ]);
    // Only styles linked to a trait where the student is low are skills to build: quiet isn't a weakness,
    // and connecting with people is something anyone can practice.
    expect(building).toEqual(["social_orientation"]);
    // Styles no trait is linked to say nothing about the student.
    expect(other).toEqual(["integrity", "cautiousness", "self_control", "stress_tolerance"]);
  });

  it("never calls a style no trait is linked to something the student is still building", () => {
    const unmapped = WORK_STYLES.map((s) => s.id).filter((s) => !traitForStyle(s));
    expect(unmapped).toEqual(["initiative", "self_confidence", "humility", "sincerity", "optimism", "cautiousness", "integrity", "stress_tolerance", "self_control"]);
    for (const score of [0, 50, 100]) {
      const all = { extraversion: score, agreeableness: score, conscientiousness: score, neuroticism: score, intellect: score };
      const { helps, building, other } = strengthsForCareer(unmapped, all);
      expect([helps, building, other]).toEqual([[], [], unmapped]);
    }
  });

  it("never links stress tolerance or self-control to how calm a student is", () => {
    for (const neuroticism of [0, 50, 100]) {
      const { helps, building } = strengthsForCareer(["stress_tolerance", "self_control"], { ...traits, neuroticism });
      expect([...helps, ...building]).toEqual([]);
    }
  });

  it("describes connecting with people as something you do, not who you are", () => {
    expect(WORK_STYLE_INFO.social_orientation).toMatchObject({ name: "Connecting with people", description: "Working with others and building connections." });
    expect(WORK_STYLES.map((s) => s.description).join(" ")).not.toMatch(/energy/i);
  });
});

describe("modules client code imports", () => {
  /** The source files a module imports for values (not `import type`), and each of their imports, in src. */
  function importGraph(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm)) {
      if (!spec) continue;
      const base = spec.startsWith("@/") ? path.join("src", spec.slice(2)) : spec.startsWith(".") ? path.join(path.dirname(file), spec) : null;
      if (!base) {
        seen.add(spec);
        continue;
      }
      const resolved = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => {
        try {
          return readFileSync(f) && true;
        } catch {
          return false;
        }
      });
      if (resolved) importGraph(resolved, seen);
    }
    return seen;
  }

  it("keep the database out of matching, which the free quiz's results page runs in the browser", () => {
    const graph = [...importGraph("src/lib/matching/match.ts")];
    expect(graph).toContain("src/lib/reference/work-styles.ts");
    expect(graph.filter((f) => f.startsWith("src/db") || /^(drizzle-orm|postgres|@electric-sql|server-only)/.test(f))).toEqual([]);
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
