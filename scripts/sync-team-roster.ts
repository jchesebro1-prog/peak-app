/**
 * One-time roster sync (D126): replace the prototype seed roster with the
 * real Peak team. Returning members are UPDATED IN PLACE (same id, so any
 * assignment/review/queue reference to them survives); prototype-era rows
 * are deleted; new members are inserted with D118-derived emails.
 *
 * Jeff's row is the lockout guard: the script refuses to run if it can't
 * find him, never deletes his row, and never touches his roles — it only
 * moves his company email to the D118 pattern, ensures the row is active,
 * and re-asserts his Google sign-in address.
 *
 * Run: npx tsx scripts/sync-team-roster.ts            (local PGlite dev DB)
 *      DATABASE_URL=... npx tsx scripts/sync-team-roster.ts --yes  (hosted;
 *      take a backup first: DATABASE_URL=... npm run db:export)
 */
import { eq } from "drizzle-orm";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { emailFor, deriveInitials, fallbackColor, IDENTITY } from "@/lib/team";

const OWNER_GOOGLE = "jchesebro1@gmail.com";
const OWNER_NAME = "jeff chesebro";

const TARGET: Array<{ name: string; roles: string[] }> = [
  { name: "Jeff Chesebro", roles: ["Admin", "Estimator"] },
  { name: "Nic Trapani", roles: ["Estimator"] },
  { name: "Jason Keagy", roles: ["Estimator"] },
  { name: "Isaac Mittlesteadt", roles: ["Reviewer"] },
  { name: "Chris Mittlesteadt", roles: ["Manager"] },
];

async function main() {
  const { hosted } = resolveDbTarget("sync-team-roster");
  requireHostedConfirmation(hosted, process.argv);

  const db = await getDb();
  const rows = await db.select().from(users).orderBy(users.id);

  console.log("\nBEFORE:");
  for (const u of rows)
    console.log(`  ${u.id}  ${u.name}  <${u.email}>  google=${u.googleEmail ?? "—"}  roles=${(u.roles || []).join("/")}  active=${u.active}`);

  const me = rows.find(
    (u) =>
      (u.googleEmail || "").toLowerCase() === OWNER_GOOGLE ||
      u.name.trim().toLowerCase() === OWNER_NAME
  );
  if (!me) {
    console.error("\nABORT: Jeff's row not found — refusing to touch the roster (sign-in lockout guard).");
    process.exit(1);
  }

  const byName = new Map(rows.map((u) => [u.name.trim().toLowerCase(), u]));
  const targetNames = new Set(TARGET.map((t) => t.name.toLowerCase()));

  // 1) Delete rows that aren't on the target roster (frees their unique emails).
  for (const u of rows) {
    if (u.id === me.id || targetNames.has(u.name.trim().toLowerCase())) continue;
    await db.delete(users).where(eq(users.id, u.id));
    console.log(`\ndeleted ${u.id} ${u.name} <${u.email}>`);
  }

  // 2) Upsert the target roster.
  let maxId = 0;
  for (const u of rows) {
    const m = /u(\d+)/.exec(u.id || "");
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  }
  for (const t of TARGET) {
    const existing = byName.get(t.name.toLowerCase());
    if (existing && existing.id === me.id) {
      // Owner: never touch roles. The company email still moves to the D118
      // pattern (his ask covers his own row) — Google sign-in matches on
      // googleEmail, which is re-asserted here, so this can't lock him out.
      await db
        .update(users)
        .set({
          email: emailFor(existing.name),
          active: true,
          googleEmail: existing.googleEmail || OWNER_GOOGLE,
        })
        .where(eq(users.id, existing.id));
      console.log(`kept    ${existing.id} ${existing.name} <${emailFor(existing.name)}> (owner — roles untouched)`);
    } else if (existing) {
      await db
        .update(users)
        .set({ email: emailFor(t.name), roles: t.roles, active: true })
        .where(eq(users.id, existing.id));
      console.log(`updated ${existing.id} ${t.name} -> <${emailFor(t.name)}> roles=${t.roles.join("/")}`);
    } else {
      const id = "u" + ++maxId;
      await db.insert(users).values({
        id,
        name: t.name,
        email: emailFor(t.name),
        googleEmail: null,
        roles: t.roles,
        color: IDENTITY[t.name]?.color ?? fallbackColor(t.name),
        initials: IDENTITY[t.name]?.initials ?? deriveInitials(t.name),
        active: true,
        createdAt: Date.now(),
        photoUrl: null,
      });
      console.log(`added   ${id} ${t.name} <${emailFor(t.name)}> roles=${t.roles.join("/")}`);
    }
  }

  const after = await db.select().from(users).orderBy(users.id);
  console.log("\nAFTER:");
  for (const u of after)
    console.log(`  ${u.id}  ${u.name}  <${u.email}>  google=${u.googleEmail ?? "—"}  roles=${(u.roles || []).join("/")}  active=${u.active}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
