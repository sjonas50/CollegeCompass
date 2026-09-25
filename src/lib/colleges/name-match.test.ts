import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db";
import { colleges } from "@/db/schema";
import { initials, initialsSql, nameWords, typedWords, wordMatch, wordsSql } from "./name-match";
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

  it("reads words that are also JavaScript object properties as ordinary words", () => {
    // Before: "constructor" came back as the built-in Object function, so it could never match.
    expect(nameWords("Constructor Academy")).toEqual(["constructor", "academy"]);
    expect(nameWords("toString __proto__ hasOwnProperty valueOf")).toEqual(["tostring", "proto", "hasownproperty", "valueof"]);
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
      "The  Beauty Institute",
      "Porter & Chester Institute",
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

describe("typedWords", () => {
  it("reads a separate St at the end, after another word, as State", () => {
    expect(typedWords("Penn St")).toEqual(["penn", "state"]);
    expect(typedWords("ohio st.")).toEqual(["ohio", "state"]);
    expect(typedWords("San Diego St. ")).toEqual(["san", "diego", "state"]);
    expect(typedWords("Kent-St")).toEqual(["kent", "state"]);
  });

  it("reads St anywhere else, and Saint anywhere, as Saint", () => {
    expect(typedWords("St Olaf")).toEqual(["st", "olaf"]);
    expect(typedWords("St.")).toEqual(["st"]);
    expect(typedWords("The St")).toEqual(["st"]);
    expect(typedWords("Mount St. Mary's")).toEqual(["mt", "st", "marys"]);
    expect(typedWords("Mount Saint")).toEqual(["mt", "st"]);
    expect(typedWords("Pennst")).toEqual(["pennst"]);
    expect(typedWords("constructor")).toEqual(["constructor"]);
  });

  it("reads letters joined by & or 'and' as one abbreviation, however it's spaced", () => {
    for (const text of ["A&M", "a & m", "A and M", " a&M. "]) expect(typedWords(text), text).toEqual(["a and m"]);
    expect(typedWords("Texas A&M")).toEqual(["texas", "a and m"]);
    expect(typedWords("NC A&T St")).toEqual(["nc", "a and t", "state"]);
    expect(typedWords("Missouri S&T")).toEqual(["missouri", "s and t"]);
    // Words, not letters: each is its own word.
    expect(typedWords("William & Mary")).toEqual(["william", "and", "mary"]);
    expect(typedWords("AT&T")).toEqual(["at", "and", "t"]);
    expect(typedWords("a&")).toEqual(["a", "and"]);
  });
});

describe("wordMatch", () => {
  // Real College Scorecard names and cities (June 2026), with the double spaces, "&", apostrophes,
  // accents and short forms that the cheap check sees differently from the full match.
  const TRICKY: [name: string, city: string][] = [
    ["The  Beauty Institute", "Whitehall"],
    ["The  Salon Professional Academy of Holland", "Holland"],
    ["Porter & Chester Institute", "Bridgeport"],
    ["Alabama School of Nail Technology & Cosmetology", "Jackson"],
    ["Texas A & M University-Corpus Christi", "Corpus Christi"],
    ["Texas A&M University-College Station", "College Station"],
    ["Mount St. Mary's University", "Emmitsburg"],
    ["Mt San Antonio College", "Walnut"],
    ["Saint Louis University", "Saint Louis"],
    ["Washington University in St Louis", "St. Louis"],
    ["Paul Mitchell the School-St. George", "Saint George"],
    ["Fort Lewis College", "Durango"],
    ["North Idaho College", "Coeur d'Alene"],
    ["Universidad Central de Bayamon", "Bayamón"],
    ["Virginia Polytechnic Institute and State University", "Blacksburg"],
    ["Massachusetts Institute of Technology", "Cambridge"],
    ["University of California-Los Angeles", "Los Angeles"],
    ["Monty Tech", "Fitchburg"],
    ["Florida Agricultural and Mechanical University", "Tallahassee"],
    ["William & Mary", "Williamsburg"],
  ];
  const SHORT_FORMS = new Set(["st", "mt", "ft"]);

  /** Abbreviations the full match should find in this name: "a and m" in A&M and in Agricultural and Mechanical. */
  function abbreviationsFor(name: string): Set<string> {
    const words = nameWords(name);
    const found = words.flatMap((w, i) => (i > 0 && w === "and" && i + 1 < words.length ? [`${words[i - 1][0]} and ${words[i + 1][0]}`] : []));
    return new Set(found.filter((a) => /^[a-z] and [a-z]$/.test(a)));
  }

  /** Typed words the full match should find in this college: word starts, inside a name's words, initials and abbreviations. */
  function wordsFor(name: string, city: string): Set<string> {
    const found = new Set<string>();
    const prefixes = (word: string, min = 1) => Array.from({ length: word.length - min + 1 }, (_, i) => word.slice(0, i + min));
    for (const word of [...nameWords(name), ...nameWords(city)]) {
      // "st" is a whole word: it doesn't find "Stratford".
      for (const p of prefixes(word)) if (!SHORT_FORMS.has(p) || p === word) found.add(p);
    }
    for (const word of nameWords(name)) {
      for (let from = 1; from + 4 <= word.length; from++) for (let to = from + 4; to <= word.length; to++) found.add(word.slice(from, to));
    }
    for (const p of prefixes(initials(nameWords(name)), 2)) if (/^[a-z]+$/.test(p) && !SHORT_FORMS.has(p)) found.add(p);
    for (const a of abbreviationsFor(name)) found.add(a);
    return found;
  }

  it("is only ever true when its cheap check is, and finds each college by its own words", async () => {
    const db = await createTestDb();
    await insertColleges(db, TRICKY.map(([name, city], i) => ({ unitId: i + 1, name, city })));
    const expected = new Map(TRICKY.map(([name, city]) => [name, wordsFor(name, city)]));
    const typed = [
      ...new Set([...[...expected.values()].flatMap((words) => [...words]), "a", "an", "and", "st", "mt", "ft", "a and c", "s and c", "a and t", "s and t", "x and y"]),
    ];

    const missedByCheap = new Map<string, string[]>();
    const notFound = new Map<string, string[]>();
    // Abbreviations are the words next to each other, never letters that start any words: "a and
    // m" isn't William & Mary.
    const extraAbbreviations = new Map<string, string[]>();
    const CHUNK = 40;
    for (let i = 0; i < typed.length; i += CHUNK) {
      const chunk = typed.slice(i, i + CHUNK);
      const checks = chunk.map((w) => ({ w, ...wordMatch(colleges.name, colleges.city, w) }));
      const rows = await db
        .select({
          name: colleges.name,
          missed: sql<string>`concat_ws('|', ${sql.join(checks.map((c) => sql`case when (${c.full}) and not (${c.cheap}) then ${c.w}::text end`), sql`, `)})`,
          full: sql<string>`concat_ws('|', ${sql.join(checks.map((c) => sql`case when ${c.full} then ${c.w}::text end`), sql`, `)})`,
        })
        .from(colleges);
      for (const row of rows) {
        if (row.missed) missedByCheap.set(row.name, [...(missedByCheap.get(row.name) ?? []), ...row.missed.split("|")]);
        const full = new Set(row.full.split("|"));
        const missing = chunk.filter((w) => expected.get(row.name)!.has(w) && !full.has(w));
        if (missing.length) notFound.set(row.name, [...(notFound.get(row.name) ?? []), ...missing]);
        const extra = chunk.filter((w) => w.includes(" ") && full.has(w) && !abbreviationsFor(row.name).has(w));
        if (extra.length) extraAbbreviations.set(row.name, [...(extraAbbreviations.get(row.name) ?? []), ...extra]);
      }
    }
    expect(Object.fromEntries(missedByCheap)).toEqual({});
    expect(Object.fromEntries(notFound)).toEqual({});
    expect(Object.fromEntries(extraAbbreviations)).toEqual({});
    // Among them, the ones that used to slip past the cheap check: initials after "The" and a
    // double space, and "&" for "an".
    expect(expected.get("The  Beauty Institute")).toContain("bi");
    expect(expected.get("The  Salon Professional Academy of Holland")).toContain("sp");
    expect(expected.get("Porter & Chester Institute")).toContain("an");
    // And abbreviations, as letters and spelled out.
    expect(expected.get("Texas A&M University-College Station")).toContain("a and m");
    expect(expected.get("Florida Agricultural and Mechanical University")).toContain("a and m");
    expect(expected.get("William & Mary")).toContain("w and m");
  }, 30_000);
});
