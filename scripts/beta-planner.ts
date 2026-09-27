/**
 * Puts a family in the class planner beta ("Your path" on /plan, its print view and a parent's
 * read-only path), or takes it out with --off. Everyone else keeps the checklist and course ideas,
 * unless PLANNER_PATH=everyone.
 *
 *   npm run beta:planner -- --by staff@example.com --household ana@example.com
 *   npm run beta:planner -- --by staff@example.com --household ana@example.com --off
 *
 * --household is a household id, or the email or username of a student in it. --by is your staff
 * account (see npm run admin:create); the change is audited as planner.beta_set_by_staff with it,
 * without names, emails or ids. Uses DATABASE_URL, or the local PGlite database when it's unset.
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { runBetaPlanner } from "../src/lib/planner/beta";

async function main() {
  const result = await runBetaPlanner(await getDb(), process.argv.slice(2));
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  console.log(result.message);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
