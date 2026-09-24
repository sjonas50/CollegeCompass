/**
 * Creates a staff admin account. Admins can only be created here, never through signup.
 *
 *   npm run admin:create -- --email staff@example.com --name "Jordan"
 *
 * The password comes from ADMIN_PASSWORD, or is asked for twice without echoing (at least 16
 * characters). Uses DATABASE_URL, or the local PGlite database when it's unset.
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { ADMIN_PASSWORD_MIN, createAdminUser, parseCreateAdminArgs } from "../src/lib/admin/create-admin";

/** Reads a line from the terminal without showing what's typed. */
function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.reject(new Error("No terminal to type a password into. Set ADMIN_PASSWORD instead."));
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return finish();
        if (ch === "\u0003") return finish(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) return fromEnv;
  const first = await promptHidden(`Password (at least ${ADMIN_PASSWORD_MIN} characters): `);
  const second = await promptHidden("Type it again: ");
  if (first !== second) throw new Error("The passwords didn't match.");
  return first;
}

async function main() {
  const args = parseCreateAdminArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.message);
    return 1;
  }
  const password = await readPassword();
  const result = await createAdminUser(await getDb(), { email: args.email, displayName: args.name, password });
  if (!result.ok) {
    console.error(result.error === "email_taken" ? "An account with that email already exists. Use a separate email for staff." : result.messages.join("\n"));
    return 1;
  }
  console.log(`Admin account created for ${result.email}. Sign in at /login.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
