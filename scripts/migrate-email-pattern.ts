/**
 * One-time sign-on email migration (D118): roster emails that still carry
 * the OLD auto-derived pattern (first initial + last name, jchesebro@…)
 * move to the new company pattern (firstname + last initial, jeffc@…).
 * Hand-customized addresses and googleEmail values are left untouched.
 * Run: npx tsx scripts/migrate-email-pattern.ts   (local PGlite dev DB, or
 * prod when DATABASE_URL is set in the environment).
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { emailFor, legacyEmailFor } from "@/lib/team";

const db = await getDb();
const rows = await db.select().from(users);

let changed = 0;
for (const u of rows) {
  const stored = (u.email || "").toLowerCase();
  const legacy = legacyEmailFor(u.name);
  if (stored !== legacy) {
    console.log(`skip  ${u.name}: ${u.email} (custom — not the old auto-derived form)`);
    continue;
  }
  let next = emailFor(u.name);
  const taken = rows.some(
    (o) => o.id !== u.id && (o.email || "").toLowerCase() === next
  );
  if (taken) next = legacy; // deterministic collision fallback (D118)
  if (next === stored) {
    console.log(`skip  ${u.name}: ${u.email} (collision fallback keeps legacy form)`);
    continue;
  }
  await db.update(users).set({ email: next }).where(eq(users.id, u.id));
  console.log(`moved ${u.name}: ${u.email} -> ${next}`);
  changed++;
}

console.log(changed ? `\n${changed} roster email(s) migrated` : "\nnothing to migrate");
process.exit(0);
