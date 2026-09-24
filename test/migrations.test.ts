import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { describe, expect, it } from "vitest";

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** A copy of the migrations folder containing only the first `count` migrations. */
function migrationsUpTo(count: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "cc-migrations-"));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("migration 0004", () => {
  it("numbers existing counselor messages in the order they were written", async () => {
    const client = new PGlite();
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: migrationsUpTo(4) });

    const [user] = (await db.execute(sql`insert into users (role, password_hash, display_name) values ('student', 'x', 'Ana') returning id`)).rows as { id: string }[];
    const conv = async () =>
      ((await db.execute(sql`insert into counselor_conversations (user_id) values (${user.id}) returning id`)).rows as { id: string }[])[0].id;
    const say = (c: string, text: string, minutes: number) =>
      db.execute(sql`insert into counselor_messages (conversation_id, role, content, created_at)
                     values (${c}, 'user', ${text}, now() - make_interval(mins => ${minutes}))`);

    // Fill pages with another conversation, write A's first messages, delete the filler and
    // vacuum so A's later messages land in the freed space ahead of its earlier ones.
    const filler = await conv();
    for (let i = 0; i < 40; i++) await say(filler, `filler ${i} ${"x".repeat(200)}`, 100);
    const a = await conv();
    for (let i = 0; i < 4; i++) await say(a, `A${i}`, 50 - i);
    await db.execute(sql`delete from counselor_conversations where id = ${filler}`);
    await client.exec("vacuum");
    for (let i = 4; i < 8; i++) await say(a, `A${i}`, 50 - i);

    await migrate(db, { migrationsFolder: MIGRATIONS });
    const rows = (await db.execute(sql`select content from counselor_messages where conversation_id = ${a} order by seq`)).rows as { content: string }[];
    expect(rows.map((r) => r.content)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]);

    // New messages continue after the backfilled numbers.
    await say(a, "A8", 0);
    const last = (await db.execute(sql`select content from counselor_messages where conversation_id = ${a} order by seq desc limit 1`)).rows as { content: string }[];
    expect(last[0].content).toBe("A8");
  });
});
