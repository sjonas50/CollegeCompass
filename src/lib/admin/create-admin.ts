import { sql } from "drizzle-orm";
import * as z from "zod";
import type { Db } from "@/db";
import { users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";

/** Staff accounts can read flagged student messages, so their passwords are longer than families'. */
export const ADMIN_PASSWORD_MIN = 16;

export const CreateAdminSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  displayName: z.string().trim().min(1, "Enter a name.").max(40, "Use 40 characters or fewer."),
  password: z
    .string()
    .min(ADMIN_PASSWORD_MIN, `Use at least ${ADMIN_PASSWORD_MIN} characters.`)
    .max(128, "Use 128 characters or fewer."),
});

export type CreateAdminResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: "invalid"; messages: string[] }
  | { ok: false; error: "email_taken" };

/**
 * Creates a staff admin account. Only the `npm run admin:create` script calls this: there is no
 * signup path for admins. An email that already belongs to any account (a parent, say) is refused
 * rather than promoted, so a family account never quietly gains staff access.
 */
export async function createAdminUser(
  db: Db,
  input: { email: string; displayName: string; password: string },
): Promise<CreateAdminResult> {
  const parsed = CreateAdminSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "invalid", messages: parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`) };
  }
  const { email, displayName, password } = parsed.data;
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ role: "admin", email, displayName, passwordHash, remindersEnabled: false })
    .returning({ id: users.id });
  await audit(db, "admin.created", { subjectUserId: user.id, metadata: { via: "cli" } });
  return { ok: true, userId: user.id, email };
}

export type CreateAdminArgs = { ok: true; email: string; name: string } | { ok: false; message: string };

export const CREATE_ADMIN_USAGE =
  "Usage: npm run admin:create -- --email staff@example.com --name \"First name\"\n" +
  `The password comes from ADMIN_PASSWORD, or you're asked for it (at least ${ADMIN_PASSWORD_MIN} characters).`;

/** Reads `--email` and `--name` (as `--flag value` or `--flag=value`) from the script's arguments. */
export function parseCreateAdminArgs(argv: readonly string[]): CreateAdminArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { ok: false, message: CREATE_ADMIN_USAGE };
    const match = /^--(email|name)(?:=(.*))?$/.exec(arg);
    if (!match) return { ok: false, message: `Unknown argument: ${arg}\n${CREATE_ADMIN_USAGE}` };
    const value = match[2] ?? argv[++i];
    if (value === undefined || value.startsWith("--")) return { ok: false, message: `--${match[1]} needs a value.\n${CREATE_ADMIN_USAGE}` };
    values[match[1]] = value;
  }
  if (!values.email || !values.name?.trim()) return { ok: false, message: CREATE_ADMIN_USAGE };
  return { ok: true, email: values.email, name: values.name };
}
