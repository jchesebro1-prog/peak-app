/**
 * One-shot: move existing in-database Grid plan sheets to Vercel Blob
 * (D116, MASTER-HOWTO §9) — uploads each grid_sheets doc that still
 * carries a base64 payload and rewrites it to the returned URL.
 *
 *   npx tsx scripts/backfill-blob-sheets.ts             (local PGlite)
 *   DATABASE_URL=... npx tsx scripts/backfill-blob-sheets.ts   (hosted)
 *
 * PGlite is single-process: NEVER run this with a dev server (or any other
 * db script) running, and copy .data aside first. See AGENTS.md.
 */
import { readFileSync } from "node:fs";

// Standalone scripts don't get Next's .env.local loading — do it by hand
// (never overrides values already in the environment).
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — rely on the ambient environment */
}

import { listDocs, patchDoc } from "../src/db/doc-store";
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "../src/lib/blob";
import type { GridSheet } from "../src/lib/stores/grid-projects";

async function main() {
  if (!blobEnabled()) {
    console.error("BLOB_READ_WRITE_TOKEN is not set — nothing to do.");
    process.exit(1);
  }
  const sheets = await listDocs<GridSheet>("grid_sheets");
  const pending = sheets.filter((s) => !s.url && s.dataUrl);
  console.log(`${sheets.length} sheets, ${pending.length} still in-database.`);
  let moved = 0;
  for (const s of pending) {
    const { bytes } = dataUrlToBytes(s.dataUrl);
    const url = await putBlob(
      `grid-sheets/${s.projectId}/${safeName(s.name)}`,
      bytes,
      s.mime
    );
    await patchDoc<GridSheet>("grid_sheets", s.id, (doc) => {
      doc.url = url;
      doc.dataUrl = "";
    });
    moved++;
    console.log(`  ${s.id} (${s.name}, ${Math.round(bytes.length / 1024)} KB) → ${url}`);
  }
  console.log(`Done — ${moved} sheet${moved === 1 ? "" : "s"} moved to Blob.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
