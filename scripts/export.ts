/**
 * Full-database backup export. Dumps every table (business collections,
 * estimating-rate blobs, team roster, app settings, per-user notification
 * prefs, Gmail connection metadata) to one timestamped JSON file — the
 * portable, human-readable snapshot referenced in MASTER-HOWTO §3.
 *
 *   npm run db:export                    → ./backups/peak-backup-YYYYMMDD-HHMM.json (local PGlite)
 *   DATABASE_URL=... npm run db:export   → same, against hosted Postgres (Neon)
 *   OUT=/path/file.json npm run db:export → write to an explicit path
 *
 * Format 2 also dumps the customer tables (companies, contacts, contact_emails,
 * contact_phones, sites). The Estimator handoff slicer reads only an allow-listed
 * cut of this file (handoff/estimator/slice.ts).
 *
 * Gmail refresh/access tokens are encrypted at rest (lib/gmail/crypto.ts) and
 * are exported as-is; the backup is therefore as sensitive as the database —
 * store it somewhere private (I5: monthly export to Google Drive).
 */
import { getDb } from "../src/db";
import { resolveDbTarget } from "./db-target";
import { DOC_TABLES } from "../src/db/doc-tables";
import {
  blobs,
  users,
  appSettings,
  gmailConnections,
  notifPrefs,
  geoCache,
  companies,
  contacts,
  contactEmails,
  contactPhones,
  sites,
} from "../src/db/schema";
import * as fs from "node:fs";
import * as path from "node:path";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes())
  );
}

async function main() {
  resolveDbTarget("export");
  const db = await getDb();

  const collections: Record<string, unknown[]> = {};
  let recordCount = 0;
  for (const [name, table] of Object.entries(DOC_TABLES)) {
    const rows = await db.select().from(table);
    collections[name] = rows;
    recordCount += rows.length;
  }

  const backup = {
    meta: {
      app: "Peak Backend",
      exportedAt: new Date().toISOString(),
      source: process.env.DATABASE_URL ? "hosted" : "local-pglite",
      // 2 = adds the customer tables (companies, contacts, contactEmails, contactPhones, sites)
      // for the Estimator handoff slicer (npm run handoff:slice). Nothing else changed.
      format: 2,
    },
    users: await db.select().from(users),
    appSettings: await db.select().from(appSettings),
    blobs: await db.select().from(blobs),
    notifPrefs: await db.select().from(notifPrefs),
    gmailConnections: await db.select().from(gmailConnections),
    geoCache: await db.select().from(geoCache),
    companies: await db.select().from(companies),
    contacts: await db.select().from(contacts),
    contactEmails: await db.select().from(contactEmails),
    contactPhones: await db.select().from(contactPhones),
    sites: await db.select().from(sites),
    collections,
  };

  const outArg = process.env.OUT;
  let outPath: string;
  if (outArg) {
    outPath = path.resolve(outArg);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
  } else {
    const dir = path.join(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    outPath = path.join(dir, `peak-backup-${stamp()}.json`);
  }

  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(
    `Backup written: ${outPath}\n` +
      `  ${recordCount} records across ${Object.keys(collections).length} collections, ` +
      `${backup.users.length} team members. format ${backup.meta.format}; ` +
      `${backup.companies.length} companies, ${backup.contacts.length} contacts ` +
      `(${backup.contactEmails.length} emails, ${backup.contactPhones.length} phones), ${backup.sites.length} sites.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
