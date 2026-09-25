import { beforeEach, describe, expect, it } from "vitest";
import { type Db, createTestDb } from "@/db";
import { occupations } from "@/db/schema";
import { counselorTools } from "./tools";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  // Real O*NET 30.x codes and titles.
  await db.insert(occupations).values(
    [
      ["29-1221.00", "Pediatricians, General"],
      ["29-1223.00", "Psychiatrists"],
      ["29-1071.00", "Physician Assistants"],
      ["15-1252.00", "Software Developers"],
    ].map(([code, title]) => ({ code, title, description: "What the work is.", jobZone: 5 })),
  );
});

async function searchCareersTool(query: string) {
  const tool = counselorTools({ db, userId: "not-used", grade: 9 }).find((t) => t.name === "search_careers")!;
  return JSON.parse(String(await tool.run({ query } as never)));
}

describe("search_careers", () => {
  it("finds careers by everyday words", async () => {
    expect(await searchCareersTool("doctor")).toEqual([
      { code: "29-1221.00", title: "Pediatricians, General" },
      { code: "29-1223.00", title: "Psychiatrists" },
    ]);
    expect(await searchCareersTool("software engineer")).toEqual([{ code: "15-1252.00", title: "Software Developers" }]);
  });

  it("suggests another word for the job title when nothing matches", async () => {
    const out = await searchCareersTool("biology");
    expect(out.note).toBe('No careers matched. Try another word for the job title, like "physician" or "software developer".');
    // Whole words match, so a shorter word usually finds less, not more.
    expect(out.note).not.toMatch(/shorter/);
  });
});
