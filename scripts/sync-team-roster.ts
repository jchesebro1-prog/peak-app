/**
 * Roster sync (D126/D128): make the users table exactly the real Peak team —
 * the prototype six plus Chris Mittlesteadt, everyone active, D118-derived
 * emails, and (Jeff's 2026-07-29 choice) every role for everyone but him.
 *
 * Handles the mess a manual cleanup attempt leaves behind (seen in prod on
 * 2026-07-29): DUPLICATE rows per person (a second Jeff, re-added Jena/Jack)
 * and misspelled near-misses ("Chris Middlesteadt"). Per person the CANONICAL
 * row is Jeff's own row for the owner, else the lowest-numbered id (the
 * original — anything referencing it survives); every other row is deleted
 * BEFORE emails are (re)assigned so the unique(email) constraint can't trip.
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

const EVERY_ROLE = ["Admin", "Manager", "Estimator", "Reviewer"];
const TARGET: Array<{ name: string; roles: string[] }> = [
  { name: "Jeff Chesebro", roles: ["Admin", "Estimator"] }, // used only if inserting
  { name: "Nic Trapani", roles: EVERY_ROLE },
  { name: "Jena Tolksdorf", roles: EVERY_ROLE },
  { name: "Jack Hamilton", roles: EVERY_ROLE },
  { name: "Jason Keagy", roles: EVERY_ROLE },
  { name: "Isaac Mittlesteadt", roles: EVERY_ROLE },
  { name: "Chris Mittlesteadt", roles: EVERY_ROLE },
];

const idNum = (id: string) => {
  const m = /u(\d+)/.exec(id || "");
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
};

async function main() {
  const { hosted } = resolveDbTarget("sync-team-roster");
  requireHostedConfirmation(hosted, process.argv);

  const db = await getDb();
  const rows = await db.select().from(users).orderBy(users.id);

  console.log("\nBEFORE:");
  for (const u of rows)
    console.log(`  ${u.id}  ${u.name}  <${u.email}>  google=${u.googleEmail ?? "—"}  roles=${(u.roles || []).join("/")}  status=${u.status}`);

  const me = rows.find(
    (u) =>
      (u.googleEmail || "").toLowerCase() === OWNER_GOOGLE ||
      u.name.trim().toLowerCase() === OWNER_NAME
  );
  if (!me) {
    console.error("\nABORT: Jeff's row not found — refusing to touch the roster (sign-in lockout guard).");
    process.exit(1);
  }

  // Pick the canonical row per target name: the owner's own row for Jeff,
  // otherwise the lowest-numbered (original) id among same-name rows.
  const canonical = new Map<string, (typeof rows)[number]>();
  for (const t of TARGET) {
    const key = t.name.toLowerCase();
    const matches = rows.filter((u) => u.name.trim().toLowerCase() === key);
    if (!matches.length) continue;
    const keep =
      matches.find((u) => u.id === me.id) ??
      [...matches].sort((a, b) => idNum(a.id) - idNum(b.id))[0];
    canonical.set(key, keep);
  }

  // 1) Delete every non-canonical row — off-roster names, misspellings, and
  //    same-name duplicates alike — freeing their emails for step 2.
  console.log("");
  for (const u of rows) {
    if (u.id === me.id) continue;
    if (canonical.get(u.name.trim().toLowerCase())?.id === u.id) continue;
    await db.delete(users).where(eq(users.id, u.id));
    console.log(`deleted ${u.id} ${u.name} <${u.email}>`);
  }

  // 2) Upsert the target roster onto the canonical rows.
  let maxId = 0;
  for (const u of rows) maxId = Math.max(maxId, idNum(u.id) === Infinity ? 0 : idNum(u.id));
  for (const t of TARGET) {
    const existing = canonical.get(t.name.toLowerCase());
    if (existing && existing.id === me.id) {
      // Owner: never touch roles. The company email still moves to the D118
      // pattern — Google sign-in matches on googleEmail, re-asserted here,
      // so this can't lock him out.
      await db
        .update(users)
        .set({
          email: emailFor(existing.name),
          status: "active",
          googleEmail: existing.googleEmail || OWNER_GOOGLE,
        })
        .where(eq(users.id, existing.id));
      console.log(`kept    ${existing.id} ${existing.name} <${emailFor(existing.name)}> (owner — roles untouched)`);
    } else if (existing) {
      await db
        .update(users)
        .set({ email: emailFor(t.name), roles: t.roles, status: "active" })
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
        status: "active",
        createdAt: Date.now(),
        photoUrl: null,
      });
      console.log(`added   ${id} ${t.name} <${emailFor(t.name)}> roles=${t.roles.join("/")}`);
    }
  }

  const after = await db.select().from(users).orderBy(users.id);
  console.log("\nAFTER:");
  for (const u of after)
    console.log(`  ${u.id}  ${u.name}  <${u.email}>  google=${u.googleEmail ?? "—"}  roles=${(u.roles || []).join("/")}  status=${u.status}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
