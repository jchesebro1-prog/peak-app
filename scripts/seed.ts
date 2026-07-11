/**
 * Seed the database with the development fixtures (prototype roster +
 * default settings). Safe to run repeatedly — only fills empty tables.
 *
 *   npm run db:seed             (local PGlite)
 *   DATABASE_URL=... npm run db:seed   (hosted Postgres)
 */
import { getDb } from "../src/db";
import { seedIfEmpty } from "../src/db/seed-data";

async function main() {
  const db = await getDb();
  await seedIfEmpty(db);
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
