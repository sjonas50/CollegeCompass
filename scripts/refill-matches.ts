/**
 * Remakes students' latest career matches where today's rules for which careers can be matches
 * (src/lib/matching/minors.ts) leave out some of the stored careers, so each list is full again:
 * the next careers down fill the freed places (see refillMatches). Until then, pages hide the left
 * out careers and show a shorter list. Run it once after deploying SCORING_VERSION 3, and after
 * each deployed change to minors.ts. Running it again changes nothing.
 *
 *   npm run matches:refill -- --dry-run   # only counts the lists that need it
 *   npm run matches:refill
 *
 * Prints counts only. Needs the reference data loaded. Uses DATABASE_URL, or the local PGlite
 * database when it's unset.
 */
import "dotenv/config";
import { getDb } from "../src/db";
import { refillAllMatches } from "../src/lib/matching/service";

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(" ")}. The only option is --dry-run.`);
    return 1;
  }
  const dryRun = args.includes("--dry-run");
  const { checked, remade } = await refillAllMatches(await getDb(), { dryRun });
  console.log(
    dryRun
      ? `Checked ${checked} students' latest matches: ${remade} would be remade. Nothing was changed.`
      : `Checked ${checked} students' latest matches: remade ${remade}.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
