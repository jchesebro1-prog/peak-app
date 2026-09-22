/**
 * Apple Reminders sync agent (D93) — the Mac-side half of the work queue.
 *
 * Server contract: src/app/api/queue/route.ts (read it before changing this
 * file — DO NOT modify the route, src/lib/queue.ts, or
 * src/lib/stores/assignments.ts; they are done and correct).
 * Design: docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md
 *
 * Apple publishes no cloud API for Reminders — access is local-device only
 * (AppleScript/osascript/EventKit), so a hosted app can never write a
 * reminder itself. This script is the thing that runs ON THE MAC: it GETs a
 * person's open queue, reconciles it against the "Peak" list in
 * Reminders.app, and POSTs completions back for the one item type the server
 * allows writing back (`assignment`).
 *
 * MAC ONLY. Uses `osascript`, which does not exist off macOS — see
 * assertMac() below for the guard and its error message.
 *
 * ---------------------------------------------------------------------------
 * Required environment
 * ---------------------------------------------------------------------------
 *   QUEUE_API_BASE_URL   e.g. https://quartzite-six.vercel.app, or
 *                         http://localhost:3000 for a local dev server.
 *   QUEUE_API_TOKEN      matches the deployed app's QUEUE_API_TOKEN env var.
 *                         Keep it in the macOS keychain or a local env file
 *                         (see below) — never in this repo or a memory file.
 *   QUEUE_AGENT_WHO       the team-member NAME the queue is assembled for
 *                         (the app's convention — matches Assignment.assignee,
 *                         e.g. "Jeff Chesebro"). Whoever's Mac this runs on.
 *
 * Optional:
 *   QUEUE_AGENT_LIST          Reminders list name. Default: "Peak".
 *   QUEUE_AGENT_LEDGER_PATH   where the hand-delete ledger is kept. Default:
 *                             ~/.peak-reminders-agent-ledger.json
 *
 * For a manual run, drop these into this repo's `.env.local` (same file
 * `npm run dev` reads) and the script will pick them up — see loadEnvLocal()
 * import below, same helper scripts/db-target.ts uses for DB scripts. A
 * value already set in the shell environment always wins.
 *
 * ---------------------------------------------------------------------------
 * Run it once by hand
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/reminders-agent.ts
 *
 * The first run prompts for Automation access to Reminders.app (System
 * Settings > Privacy & Security > Automation) — grant it to whatever process
 * is invoking osascript (Terminal, or launchd's own host process once
 * scheduled). Without that grant every osascript call fails and the run
 * exits non-zero.
 *
 * ---------------------------------------------------------------------------
 * Schedule it (every few minutes — same cadence as the Gmail poll)
 * ---------------------------------------------------------------------------
 * launchd (preferred on macOS — survives reboots, runs while logged in).
 * Save as ~/Library/LaunchAgents/com.peak.reminders-agent.plist, filling in
 * real paths and the token, then:
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.peak.reminders-agent.plist
 *
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
 *     "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
 *   <plist version="1.0">
 *   <dict>
 *     <key>Label</key><string>com.peak.reminders-agent</string>
 *     <key>ProgramArguments</key>
 *     <array>
 *       <string>/usr/local/bin/npx</string>
 *       <string>tsx</string>
 *       <string>/Users/jeff/peak-app/scripts/reminders-agent.ts</string>
 *     </array>
 *     <key>WorkingDirectory</key><string>/Users/jeff/peak-app</string>
 *     <key>EnvironmentVariables</key>
 *     <dict>
 *       <key>QUEUE_API_BASE_URL</key><string>https://quartzite-six.vercel.app</string>
 *       <key>QUEUE_API_TOKEN</key><string>PUT-THE-REAL-TOKEN-HERE</string>
 *       <key>QUEUE_AGENT_WHO</key><string>Jeff Chesebro</string>
 *     </dict>
 *     <key>StartInterval</key><integer>300</integer>
 *     <key>StandardOutPath</key><string>/tmp/peak-reminders-agent.log</string>
 *     <key>StandardErrorPath</key><string>/tmp/peak-reminders-agent.log</string>
 *   </dict>
 *   </plist>
 *
 * cron (simpler, needs Terminal/cron granted Automation access too):
 *   * /5 * * * * cd /Users/jeff/peak-app && /usr/local/bin/npx tsx scripts/reminders-agent.ts >> /tmp/peak-reminders-agent.log 2>&1
 *   (remove the space between "*" and "/5" — written apart here only so this
 *   block comment doesn't look like an active path glob to a reader's eye.)
 *
 * ---------------------------------------------------------------------------
 * Reconciliation model (do exactly what the design doc says — see it for the
 * full rationale; this is the summary that maps directly onto the code below)
 * ---------------------------------------------------------------------------
 *   - Every open queue item (any source) gets a reminder in "Peak" if it
 *     doesn't have one yet — one-way for derived items, the mirror only.
 *   - A queue item that disappears from the server (closed, done, or the
 *     assignee changed) gets its local reminder marked completed.
 *   - Two-way ONLY for `source: "assignment"` items: a reminder checked off
 *     by hand in Reminders.app gets POSTed back as a completion. Derived
 *     items never write back, matching the API route's own restriction — a
 *     phone checkbox must never approve a review or close a milestone.
 *   - A reminder Jeff deletes by hand is never resurrected, even though the
 *     underlying queue item is still open.
 *
 * Dedupe mechanic: AppleScript/JXA reminders carry no custom-metadata slot
 * beyond name/body/due date, so each mirrored reminder's `body` embeds a
 * marker line `peak-queue-key: <key>` (the same `key` loadQueue()/the route
 * already treat as the stable dedupe id). Every run re-derives "what's
 * already mirrored" by reading that marker back out of the live Reminders
 * list — self-healing if the ledger file is ever lost. The ledger file's
 * ONLY job is remembering "this key used to have a mirror and doesn't
 * anymore while its queue item is still open" (a hand-delete), because that
 * fact cannot be recovered from Reminders' current state alone.
 *
 * The marker line is plain text inside the reminder's own body/notes field
 * — Reminders.app has no locked or hidden metadata slot to put it in, so it
 * is technically hand-editable. Treat it as read-only: editing or removing
 * it (rather than checking the reminder off, or deleting it outright, both
 * of which ARE the supported ways to act on one) can misattribute a sync to
 * the wrong queue item. This is a known, low-probability limitation of
 * mirroring into a free-text notes field, not something this script can
 * fully guard against.
 *
 * Failure handling: a bad token or an unreachable host is a hard failure
 * (non-zero exit, nothing written). A single reminder's osascript call
 * failing, or a single write-back POST failing, is logged and the run
 * continues — see the try/catch around each per-item operation below.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadEnvLocal } from "./db-target";
import type { QueueItem } from "@/lib/queue-types";

function assertMac(): void {
  if (process.platform !== "darwin") {
    console.error(
      "[reminders-agent] FATAL: this script drives Reminders.app via osascript, " +
        `which only exists on macOS (detected platform: "${process.platform}").\n` +
        'Run it on the Mac whose signed-in Apple account owns the "Peak" reminders list.'
    );
    process.exit(1);
  }
}

function fatal(message: string): never {
  console.error(`[reminders-agent] FATAL: ${message}`);
  process.exit(1);
}

type Config = {
  baseUrl: string;
  token: string;
  who: string;
  listName: string;
  ledgerPath: string;
};

function readConfig(): Config {
  loadEnvLocal(); // convenience for a manual run; never overrides real env

  const baseUrl = (process.env.QUEUE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.QUEUE_API_TOKEN || "").trim();
  const who = (process.env.QUEUE_AGENT_WHO || "").trim();
  const listName = (process.env.QUEUE_AGENT_LIST || "Peak").trim();
  const ledgerPath = (
    process.env.QUEUE_AGENT_LEDGER_PATH || path.join(os.homedir(), ".peak-reminders-agent-ledger.json")
  ).trim();

  const missing: string[] = [];
  if (!baseUrl) missing.push("QUEUE_API_BASE_URL");
  if (!token) missing.push("QUEUE_API_TOKEN");
  if (!who) missing.push("QUEUE_AGENT_WHO");
  if (missing.length) {
    fatal(
      `missing required environment variable(s): ${missing.join(", ")}. ` +
        "See the doc comment at the top of scripts/reminders-agent.ts."
    );
  }
  return { baseUrl, token, who, listName, ledgerPath };
}

/* ------------------------------------------------------------------ *
 * Hand-delete ledger — see the doc comment above for why this file
 * tracks only "deleted" keys, not the full id map.
 * ------------------------------------------------------------------ */

type Ledger = {
  /** key -> epoch-ms first seen mirrored. Cleared once the key is no longer
   *  relevant (closed server-side and gone from Reminders). */
  mirrored: Record<string, number>;
  /** key -> epoch-ms detected hand-deleted. Suppresses recreation. */
  deleted: Record<string, number>;
};

function loadLedger(ledgerPath: string): Ledger {
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    return {
      mirrored: parsed.mirrored && typeof parsed.mirrored === "object" ? parsed.mirrored : {},
      deleted: parsed.deleted && typeof parsed.deleted === "object" ? parsed.deleted : {},
    };
  } catch {
    return { mirrored: {}, deleted: {} };
  }
}

function saveLedger(ledgerPath: string, ledger: Ledger): void {
  try {
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[reminders-agent] WARN: could not write ledger at ${ledgerPath}: ${(err as Error).message}`);
  }
}

/* ------------------------------------------------------------------ *
 * osascript bridge — JXA (`osascript -l JavaScript`), not AppleScript.
 *
 * Why JXA here: the four operations below (list/create/complete) need
 * structured input (a title and a multi-line notes body that can contain
 * arbitrary punctuation) and structured output (JSON). Passing those as
 * extra argv entries to `osascript -l JavaScript -e <script> arg1 arg2 ...`
 * and reading them via JXA's top-level `run(argv)` means no string is ever
 * interpolated into the script text — no quoting/escaping hazard, unlike
 * building an AppleScript source string with `"` + title + `"` concatenation
 * (a title containing a quote or backslash would break or, worse, inject
 * script). JXA's `JSON.stringify`/`JSON.parse` also make the "list current
 * reminders" read a single clean call instead of manually delimiter-joining
 * AppleScript list results. AppleScript would work but the seams above are
 * exactly its weak points for this data shape.
 * ------------------------------------------------------------------ */

const JXA_SCRIPT = `
function run(argv) {
  var cmd = argv[0];
  var Reminders = Application("Reminders");

  function getList(name) {
    var matches = Reminders.lists.whose({ name: name });
    if (matches.length > 0) return matches[0];
    var created = Reminders.List({ name: name });
    Reminders.lists.push(created);
    return Reminders.lists.whose({ name: name })[0];
  }

  if (cmd === "list") {
    var list = getList(argv[1]);
    var reminders = list.reminders();
    var out = [];
    for (var i = 0; i < reminders.length; i++) {
      var r = reminders[i];
      out.push({ id: r.id(), name: r.name(), body: r.body() || "", completed: r.completed() });
    }
    return JSON.stringify(out);
  }

  if (cmd === "create") {
    var listName = argv[1];
    var title = argv[2];
    var body = argv[3];
    var dueMs = parseInt(argv[4], 10);
    var list = getList(listName);
    var props = { name: title, body: body };
    if (!isNaN(dueMs) && dueMs > 0) props.dueDate = new Date(dueMs);
    var rem = Reminders.Reminder(props);
    list.reminders.push(rem);
    return JSON.stringify({ id: rem.id() });
  }

  if (cmd === "complete") {
    var listName = argv[1];
    var reminderId = argv[2];
    var list = getList(listName);
    var reminders = list.reminders();
    for (var j = 0; j < reminders.length; j++) {
      if (reminders[j].id() === reminderId) {
        reminders[j].completed = true;
        return JSON.stringify({ ok: true });
      }
    }
    return JSON.stringify({ ok: false, error: "reminder not found (likely deleted by hand)" });
  }

  return JSON.stringify({ ok: false, error: "unknown command: " + cmd });
}
`;

function runJxa(args: string[]): string {
  return execFileSync("osascript", ["-l", "JavaScript", "-e", JXA_SCRIPT, ...args], {
    encoding: "utf8",
  }).trim();
}

type MirroredReminder = { id: string; name: string; body: string; completed: boolean };

function jxaList(listName: string): MirroredReminder[] {
  return JSON.parse(runJxa(["list", listName])) as MirroredReminder[];
}

function jxaCreate(listName: string, title: string, body: string, dueMs: number): { id: string } {
  return JSON.parse(runJxa(["create", listName, title, body, String(dueMs)])) as { id: string };
}

function jxaComplete(listName: string, reminderId: string): { ok: boolean; error?: string } {
  return JSON.parse(runJxa(["complete", listName, reminderId])) as { ok: boolean; error?: string };
}

/* ------------------------------------------------------------------ *
 * Marker parsing — the dedupe mechanic. See the doc comment up top.
 * ------------------------------------------------------------------ */

const MARKER_RE = /^peak-queue-key:\s*(.+)$/m;

function buildMarkerMap(reminders: MirroredReminder[]): Map<string, MirroredReminder> {
  const map = new Map<string, MirroredReminder>();
  for (const r of reminders) {
    const m = MARKER_RE.exec(r.body || "");
    if (m) map.set(m[1].trim(), r);
  }
  return map;
}

function buildNotes(config: Config, item: QueueItem): string {
  const lines = [`peak-queue-key: ${item.key}`, `source: ${item.source}`];
  if (item.context) lines.push(item.context);
  if (item.href) lines.push(`${config.baseUrl}${item.href}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  assertMac();
  const config = readConfig();

  console.log(
    `[reminders-agent] who="${config.who}" base=${config.baseUrl} list="${config.listName}"`
  );

  let queueRes: Response;
  try {
    queueRes = await fetch(`${config.baseUrl}/api/queue?who=${encodeURIComponent(config.who)}`, {
      headers: { "x-queue-token": config.token },
    });
  } catch (err) {
    fatal(`could not reach ${config.baseUrl}: ${(err as Error).message}`);
  }
  if (queueRes.status === 401) {
    fatal("unauthorized (HTTP 401) — check QUEUE_API_TOKEN against the deployed app's value");
  }
  if (!queueRes.ok) {
    fatal(`GET /api/queue failed: HTTP ${queueRes.status}`);
  }
  const queueBody = (await queueRes.json()) as { who: string; generatedAt: number; items: QueueItem[] };
  const items = queueBody.items || [];
  console.log(`[reminders-agent] fetched ${items.length} open queue item(s) for "${queueBody.who}"`);

  let existingReminders: MirroredReminder[];
  try {
    existingReminders = jxaList(config.listName);
  } catch (err) {
    fatal(
      `could not read the "${config.listName}" Reminders list via osascript: ${(err as Error).message}\n` +
        "Check System Settings > Privacy & Security > Automation and grant Reminders access to " +
        "whatever process ran this (Terminal, or launchd's host, once scheduled)."
    );
  }

  const ledger = loadLedger(config.ledgerPath);
  const markerMap = buildMarkerMap(existingReminders);
  const itemsByKey = new Map(items.map((i) => [i.key, i]));

  let created = 0;
  let completedLocally = 0;
  let postedBack = 0;
  let handDeletesDetected = 0;
  let hiccups = 0;

  // 1) Detect reminders removed by hand while their queue item is still
  //    open, and prune ledger entries that no longer matter at all.
  for (const key of Object.keys(ledger.mirrored)) {
    if (markerMap.has(key)) continue; // still there, nothing to decide
    if (itemsByKey.has(key)) {
      if (!ledger.deleted[key]) {
        ledger.deleted[key] = Date.now();
        handDeletesDetected++;
        console.log(
          `[reminders-agent] "${key}" was removed from Reminders by hand while still open — will not recreate it`
        );
      }
    } else {
      // closed server-side AND gone from Reminders: nothing left to track.
      delete ledger.mirrored[key];
      delete ledger.deleted[key];
    }
  }

  // 2) Create a reminder for every open item that doesn't have one yet,
  //    unless it was hand-deleted earlier.
  for (const item of items) {
    if (markerMap.has(item.key)) {
      if (!ledger.mirrored[item.key]) ledger.mirrored[item.key] = Date.now(); // self-heal a lost ledger
      continue;
    }
    if (ledger.deleted[item.key]) continue; // respect the hand-delete
    try {
      const notes = buildNotes(config, item);
      jxaCreate(config.listName, item.title, notes, item.due || 0);
      ledger.mirrored[item.key] = Date.now();
      created++;
      console.log(`[reminders-agent] created: "${item.title}" (${item.key})`);
    } catch (err) {
      hiccups++;
      console.error(`[reminders-agent] WARN: could not create a reminder for "${item.key}": ${(err as Error).message}`);
    }
  }

  // 3) Complete local reminders whose underlying queue item is gone
  //    (closed, done, or reassigned away from this person).
  for (const [key, rem] of markerMap) {
    if (itemsByKey.has(key)) continue; // still open
    if (rem.completed) continue; // already done, nothing to do
    try {
      jxaComplete(config.listName, rem.id);
      completedLocally++;
      console.log(`[reminders-agent] completed locally (closed in the app): "${rem.name}" (${key})`);
    } catch (err) {
      hiccups++;
      console.error(`[reminders-agent] WARN: could not complete the reminder for "${key}": ${(err as Error).message}`);
    }
  }

  // 4) Write back completions — assignment items only, per the API route's
  //    own restriction ("Write-back is restricted to assignment items").
  for (const item of items) {
    if (item.source !== "assignment" || !item.writable) continue;
    const rem = markerMap.get(item.key);
    if (!rem || !rem.completed) continue;
    try {
      const res = await fetch(`${config.baseUrl}/api/queue`, {
        method: "POST",
        headers: { "x-queue-token": config.token, "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.key, done: true }),
      });
      if (!res.ok) {
        hiccups++;
        console.error(`[reminders-agent] WARN: write-back for "${item.key}" failed: HTTP ${res.status}`);
        continue;
      }
      postedBack++;
      console.log(`[reminders-agent] wrote back completion: "${item.title}" (${item.key})`);
    } catch (err) {
      hiccups++;
      console.error(`[reminders-agent] WARN: write-back for "${item.key}" failed: ${(err as Error).message}`);
    }
  }

  saveLedger(config.ledgerPath, ledger);

  console.log(
    `[reminders-agent] done — created ${created}, completed locally ${completedLocally}, ` +
      `wrote back ${postedBack}, hand-deletes detected ${handDeletesDetected}, hiccups ${hiccups}`
  );
}

main().catch((err) => {
  fatal(`unexpected error: ${(err as Error).stack || (err as Error).message}`);
});
