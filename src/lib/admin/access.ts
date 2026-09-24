import { eq } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { users } from "@/db/schema";

export class AdminRequiredError extends Error {
  constructor() {
    super("Staff admin access required");
    this.name = "AdminRequiredError";
  }
}

/**
 * Every staff function checks the acting account in the database, not only the page's
 * requireUser(["admin"]), so a missed check in a page or action can't expose student data.
 */
export async function assertAdmin(db: Db, actorId: string): Promise<void> {
  if (!z.uuid().safeParse(actorId).success) throw new AdminRequiredError();
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, actorId));
  if (row?.role !== "admin") throw new AdminRequiredError();
}
