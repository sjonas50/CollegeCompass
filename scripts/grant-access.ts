/**
 * Gives a family full access as staff: "comp" (free of charge, like a pilot family) or "sponsored"
 * (someone else covers it, like a school or program).
 *
 *   npm run access:grant -- --by staff@example.com --household ana@example.com --kind comp --until 2027-06-30
 *
 * --household is a household id, or the email or username of a student in it. --until is the last
 * day of access (a UTC calendar day, so access ends that evening in the US), or "none". --by is your
 * staff account (see npm run admin:create); the grant is recorded with it, and audited as
 * access.granted_by_staff without names, emails or ids. Uses DATABASE_URL, or the local PGlite
 * database when it's unset.
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { formatAccessDate } from "../src/lib/access/describe";
import { grantStaffAccess, parseGrantAccessArgs, staffIdByEmail } from "../src/lib/access/staff";

async function main() {
  const args = parseGrantAccessArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.message);
    return 1;
  }
  const db = await getDb();
  const actorId = await staffIdByEmail(db, args.by);
  if (!actorId) {
    console.error("No staff account has that email. Create one with npm run admin:create.");
    return 1;
  }
  const result = await grantStaffAccess(db, actorId, { household: args.household, kind: args.kind, endsAt: args.endsAt });
  if (!result.ok) {
    console.error(
      result.error === "household_not_found"
        ? "No household matches that. Use a household id, or the email or username of a student in it."
        : "That date has already passed.",
    );
    return 1;
  }
  const until = result.endsAt ? `until ${formatAccessDate(result.endsAt)}` : "with no end date";
  console.log(`Household ${result.householdId} has ${args.kind} access ${until}.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
