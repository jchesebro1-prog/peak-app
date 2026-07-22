/**
 * Daylite full-graph export (spec §5.1(1) — the "richer export" path, D85 follow-up).
 *
 * WHY: the flat Daylite CSV export carries only People + Companies and DROPS the
 * relationships, link-roles ("Participant"), notes, and the opportunity/project
 * pipeline (see docs/superpowers/specs/daylite-export-audit-checklist.md). The
 * Daylite Cloud API exposes all of it, incl. Role Types + Relationship Types.
 * This script pulls the whole graph so `npm run audit:daylite` can confirm the
 * links/roles survived — then Phase 1 import can proceed on real data.
 *
 * READ-ONLY against the API. Writes <out>/<entity>.json (full fidelity) and
 * <out>/<entity>.csv (flattened, for the audit tool).
 *
 * AUTH: set DAYLITE_TOKEN to a Daylite API access token (sent as a Bearer token).
 * The token is short-lived (~1 hour) — generate it, then run this within the hour.
 * The token is read from the environment and never written to disk or logged.
 *
 *   DAYLITE_TOKEN=xxxxx npm run pull:daylite -- ~/Downloads/daylite-full
 *
 * Base URL: https://api.marketcircle.net/v1   ·   Rate limit: 5000 req/hr/user.
 *
 * PAGINATION IS PROBED ON THE FIRST REQUEST. Daylite's public docs don't pin the
 * scheme, so this follows an RFC-5988 `Link: rel="next"` header when present and
 * otherwise pages by ?limit&offset until a short/empty page. The first request
 * prints its status, headers and body shape so we can confirm/adjust in one run.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const BASE = "https://api.marketcircle.net/v1";
const PAGE_SIZE = 100; // conservative; well under the 5000 req/hr budget for ~5.4k records

/** Entities to pull. Order: reference vocab first, then records. */
const ENTITIES = [
  "role_types",
  "relationship_types",
  "companies",
  "contacts",
  "opportunities",
  "projects",
  "tasks",
  "appointments",
  "notes",
];

const token = process.env.DAYLITE_TOKEN;
let probed = false;

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/** Pull the array of records out of whatever envelope Daylite returns. */
function extractRecords(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    for (const key of ["data", "results", "items", "objects"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    // else: first array-valued property
    for (const v of Object.values(obj)) if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}

/** RFC-5988: parse `Link: <url>; rel="next"` → next url or null. */
function nextFromLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

async function fetchPage(url: string): Promise<{ records: Record<string, unknown>[]; next: string | null }> {
  const res = await fetch(url, { headers: headers() });
  if (!probed) {
    probed = true;
    const hdrs: Record<string, string> = {};
    res.headers.forEach((v, k) => (hdrs[k] = v));
    console.log("\n--- PROBE (first request) -------------------------------");
    console.log("GET", url.replace(BASE, ""));
    console.log("status:", res.status);
    console.log("headers:", JSON.stringify(hdrs, null, 2));
  }
  if (res.status === 401) {
    console.error("\n401 Unauthorized — the DAYLITE_TOKEN is missing or expired (tokens last ~1h). Regenerate it and re-run.");
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\nHTTP ${res.status} for ${url}\n${(await res.text()).slice(0, 400)}`);
    process.exit(1);
  }
  const body = await res.json();
  const records = extractRecords(body);
  if (probed && url.endsWith("?limit=" + PAGE_SIZE + "&offset=0")) {
    console.log("body shape:", Array.isArray(body) ? "bare array" : "object → " + Object.keys(body as object).join(", "));
    console.log("first-page records:", records.length);
    console.log("---------------------------------------------------------\n");
  }
  return { records, next: nextFromLink(res.headers.get("link")) };
}

async function pullEntity(name: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let url: string | null = `${BASE}/${name}?limit=${PAGE_SIZE}&offset=0`;
  let offset = 0;
  let guard = 0;
  while (url && guard++ < 10000) {
    const { records, next } = await fetchPage(url);
    all.push(...records);
    process.stdout.write(`\r  ${name}: ${all.length}`);
    if (next) {
      url = next; // API told us the next page (Link header) — trust it
    } else if (records.length === PAGE_SIZE) {
      offset += PAGE_SIZE; // fall back to offset paging until a short page
      url = `${BASE}/${name}?limit=${PAGE_SIZE}&offset=${offset}`;
    } else {
      url = null; // short/empty page → done
    }
    await new Promise((r) => setTimeout(r, 120)); // gentle on the 5000/hr budget
  }
  process.stdout.write("\n");
  return all;
}

/** Flatten records to CSV: union of top-level keys; nested values → JSON string. */
function toCsv(records: Record<string, unknown>[]): string {
  if (!records.length) return "";
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), keys.push(k));
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(",")];
  for (const r of records) lines.push(keys.map((k) => esc(r[k])).join(","));
  return lines.join("\n");
}

async function main() {
  const outArg = process.argv.slice(2).filter((a) => a !== "--")[0];
  if (!token) {
    console.error("Set DAYLITE_TOKEN to a Daylite API access token. See the header of this file.");
    process.exit(1);
  }
  if (!outArg) {
    console.error("Usage: DAYLITE_TOKEN=xxx npm run pull:daylite -- <output-folder>");
    process.exit(1);
  }
  const out = path.resolve(outArg);
  fs.mkdirSync(out, { recursive: true });
  console.log("Daylite full-graph export → " + out);

  const counts: Record<string, number> = {};
  for (const name of ENTITIES) {
    const records = await pullEntity(name);
    counts[name] = records.length;
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(records, null, 2));
    fs.writeFileSync(path.join(out, `${name}.csv`), toCsv(records));
  }
  fs.writeFileSync(path.join(out, "_summary.json"), JSON.stringify(counts, null, 2));

  console.log("\n=== counts ===");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  console.log(
    "\nNext: npm run audit:daylite -- " + out +
    "\n(confirm links/roles now survive), then review with Claude before import."
  );
}

main().catch((e) => {
  console.error("\nFailed:", e?.message || e);
  process.exit(1);
});
