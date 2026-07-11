import { users, appSettings } from "./schema";
import type { Db } from "./index";
import { IDENTITY, emailFor } from "@/lib/team";
import { listDocs, upsertDoc, type Doc } from "./doc-store";
import type { CollectionName } from "./doc-tables";
import { customersSeed } from "./seeds/customers";
import { quotesSeed } from "./seeds/quotes";
import { catalogSeed } from "./seeds/catalog";
import { leadsSeed } from "./seeds/leads";
import { surveysSeed } from "./seeds/surveys";
import { commsSeed } from "./seeds/comms";
import { flameJobsSeed } from "./seeds/flame-jobs";
import { repairJobsSeed } from "./seeds/repair-jobs";
import { inspectionsSeed } from "./seeds/inspections";
import { projectsSeed } from "./seeds/projects";
import { designsSeed } from "./seeds/designs";

/**
 * Development fixtures — the prototype's seed roster from team.js seedData().
 * Names, roles, colors, initials, and derived @peaksystemsgroup.com emails
 * are preserved exactly.
 *
 * googleEmail for Jeff is set to his personal Gmail so the owner can sign in
 * with Google before a company Workspace is confirmed (QUESTIONS.md #1).
 */
const ROSTER: Array<{ name: string; roles: string[]; googleEmail?: string }> = [
  { name: "Jeff Chesebro", roles: ["Admin", "Estimator"], googleEmail: "jchesebro1@gmail.com" },
  { name: "Nic Trapani", roles: ["Estimator"] },
  { name: "Jena Tolksdorf", roles: ["Estimator"] },
  { name: "Jack Hamilton", roles: ["Manager"] },
  { name: "Jason Keagy", roles: ["Estimator"] },
  { name: "Isaac Mittlesteadt", roles: ["Reviewer"] },
];

/**
 * Default app settings — exact port of settings.js DEFAULTS (rss_settings_v1).
 * The stored row is a sparse patch over these, same as the prototype.
 */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  accent: "#7b3f8a",
  companyName: "Peak Systems Group",
  federalHolidays: true,
  seedDemo: false,
  feedbackEmail: "",
  offices: [
    {
      id: "hq",
      name: "Milwaukee Shop (HQ)",
      street: "2150 W Canal St",
      city: "Milwaukee",
      state: "WI",
      zip: "53233",
      phone: "(414) 763-2200",
      lat: 43.032,
      lng: -87.945,
    },
    {
      id: "mad",
      name: "Madison Office",
      street: "2310 Daniels St",
      city: "Madison",
      state: "WI",
      zip: "53718",
      phone: "(608) 241-7500",
      lat: 43.085,
      lng: -89.301,
    },
  ],
};

/** Accent palette offered in Settings → Branding (settings.js ACCENTS). */
export const ACCENTS = ["#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];

export function seedUsers() {
  return ROSTER.map((u, i) => ({
    id: "u" + (i + 1),
    name: u.name,
    email: emailFor(u.name),
    googleEmail: u.googleEmail ?? null,
    roles: u.roles,
    color: IDENTITY[u.name]?.color ?? "#6b7079",
    initials: IDENTITY[u.name]?.initials ?? "??",
    active: true,
    createdAt: Date.now(),
    photoUrl: null,
  }));
}

/**
 * Demo fixtures per collection — the prototype's store seeds, ported
 * verbatim by the Phase 2 port (src/db/seeds/*). Seeded only when the
 * collection is empty AND demo data is on (Settings → Beta → Demo data;
 * local dev turns it on by default, DECISIONS.md D16).
 */
const DEMO_SEEDS: Array<[CollectionName, () => Doc[]]> = [
  ["customers", customersSeed as () => Doc[]],
  ["catalog_parts", catalogSeed as unknown as () => Doc[]],
  ["quotes", quotesSeed as unknown as () => Doc[]],
  ["leads", leadsSeed as unknown as () => Doc[]],
  ["surveys", surveysSeed as unknown as () => Doc[]],
  ["comms", commsSeed as unknown as () => Doc[]],
  ["flame_jobs", flameJobsSeed as unknown as () => Doc[]],
  ["repair_jobs", repairJobsSeed as unknown as () => Doc[]],
  ["inspections", inspectionsSeed as unknown as () => Doc[]],
  ["projects", projectsSeed as unknown as () => Doc[]],
  ["designs", designsSeed as unknown as () => Doc[]],
];

export async function seedDemoCollections(): Promise<number> {
  let seeded = 0;
  for (const [coll, make] of DEMO_SEEDS) {
    const existing = await listDocs(coll, { includeDeleted: true });
    if (existing.length) continue;
    for (const doc of make()) {
      await upsertDoc(coll, doc);
      seeded++;
    }
  }
  return seeded;
}

export async function seedIfEmpty(db: Db) {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length === 0) {
    await db.insert(users).values(seedUsers());
  }
  const settingsRows = await db.select().from(appSettings).limit(1);
  // Local dev (no DATABASE_URL) gets demo data on by default so the app is
  // explorable; hosted databases start clean unless SEED_DEMO=true.
  const demoDefault = !process.env.DATABASE_URL || process.env.SEED_DEMO === "true";
  if (settingsRows.length === 0) {
    await db.insert(appSettings).values({
      id: "main",
      data: { ...DEFAULT_SETTINGS, seedDemo: demoDefault },
      updatedAt: Date.now(),
    });
  }
  const data =
    settingsRows.length === 0
      ? { ...DEFAULT_SETTINGS, seedDemo: demoDefault }
      : { ...DEFAULT_SETTINGS, ...(settingsRows[0].data as Record<string, unknown>) };
  if (data.seedDemo === true) {
    await seedDemoCollections();
  }
}
