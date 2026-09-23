/** Applies database migrations to DATABASE_URL (or the local PGlite database). */
import "dotenv/config";
import { migrateDb } from "../src/db";

migrateDb()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
