import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db";
import { colleges } from "@/db/schema";
import { initials, initialsSql, nameWords, wordsSql } from "./name-match";
import { insertColleges } from "./test-fixtures";

describe("nameWords", () => {
  it("drops punctuation and spells short forms one way", () => {
    expect(nameWords("St. Olaf College")).toEqual(["st", "olaf", "college"]);
    expect(nameWords("Saint John's University")).toEqual(["st", "johns", "university"]);
    expect(nameWords("Mount St. Mary’s University")).toEqual(["mt", "st", "marys", "university"]);
    expect(nameWords("Fort Lewis College")).toEqual(["ft", "lewis", "college"]);
    expect(nameWords("Texas A&M University-College Station")).toEqual(["texas", "a", "and", "m", "university", "college", "station"]);
    expect(nameWords("The University of Texas at Austin")).toEqual(["university", "of", "texas", "at", "austin"]);
    expect(nameWords("Bayamón")).toEqual(["bayamon"]);
    // Only whole words are short forms.
    expect(nameWords("Fortis College Mountainside")).toEqual(["fortis", "college", "mountainside"]);
    expect(nameWords("  %  ")).toEqual([]);
  });

  it("finds initials, leaving out small words", () => {
    expect(initials(nameWords("Massachusetts Institute of Technology"))).toBe("mit");
    expect(initials(nameWords("University of California-Los Angeles"))).toBe("ucla");
    expect(initials(nameWords("New York University"))).toBe("nyu");
    expect(initials(nameWords("Texas A&M University"))).toBe("tamu");
  });

  it("gives the same words and initials in SQL", async () => {
    const db = await createTestDb();
    const samples = [
      "St. Olaf College",
      "Saint John's University",
      "Mount St. Mary’s University",
      "Fort Lewis College",
      "Fortis College Mountainside",
      "Texas A & M University-Corpus Christi",
      "The University of Texas at Austin",
      "Bayamón",
      "Paul Mitchell the School-St. George",
      "Helpers--Electricians (Evening)/Online",
      "Institute of Technology",
    ];
    await insertColleges(db, samples.map((name, i) => ({ unitId: i + 1, name })));
    const words = wordsSql(colleges.name);
    const rows = await db
      .select({ name: colleges.name, words: sql<string>`${words}`, initials: sql<string>`${initialsSql(words)}` })
      .from(colleges);
    expect(rows).toHaveLength(samples.length);
    for (const row of rows) {
      expect(row.words, row.name).toBe(` ${nameWords(row.name).join(" ")} `);
      expect(row.initials, row.name).toBe(initials(nameWords(row.name)));
    }
  });
});
