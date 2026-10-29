/**
 * Estimator handoff — the drift guard for ported server logic. The prototype carries browser copies of
 * server code it cannot import (store readers and writers, loaders, the save pipeline, the review tabs);
 * port-sources.json records, for each port, the original file(s) it copies and a sha256 of each original
 * at port time. `npm run handoff:verify -- --drift` recomputes the hashes and fails, naming every port
 * whose original has changed since; after re-checking the port, `--drift --update <port> …` stamps the new hashes of
 * the named ports only (a bare `--drift --update` re-stamps every entry — only right after re-checking them all).
 *
 * Deliberately NOT part of test:specs: an app-side edit to an original must not fail the app team's
 * unrelated work. It runs in the handoff verify flow only. Plan: PR 2 Task 5 (review fix 6).
 */
import { createHash } from "node:crypto";

export const PORT_SOURCES_FILE = "handoff/estimator/port-sources.json";

export type PortOriginal = { path: string; sha256: string };
export type PortEntry = { port: string; what: string; originals: PortOriginal[] };
export type PortSources = { $comment?: string; ports: PortEntry[] };

export type DriftResult = {
  /** Originals compared. */
  checked: number;
  /** An original whose hash differs from the one recorded at port time. */
  changed: Array<{ port: string; original: string }>;
  /** An original that no longer exists (moved or deleted). */
  missing: Array<{ port: string; original: string }>;
  /** A port module listed in the manifest that doesn't exist. */
  portsMissing: string[];
};

/** sha256 hex of a file's bytes. */
export function sha256Of(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Throws on a manifest that isn't `{ ports: [{ port, what, originals: [{ path, sha256 }] }] }`. Pure. */
export function parsePortSources(raw: unknown): PortSources {
  const m = raw as PortSources;
  const ok =
    !!m &&
    Array.isArray(m.ports) &&
    m.ports.every(
      (p) =>
        p && typeof p.port === "string" && typeof p.what === "string" && Array.isArray(p.originals) && p.originals.length > 0 && p.originals.every((o) => o && typeof o.path === "string" && typeof o.sha256 === "string"),
    );
  if (!ok) throw new Error(`${PORT_SOURCES_FILE}: expected { ports: [{ port, what, originals: [{ path, sha256 }] }] }`);
  return m;
}

/** Compares each recorded hash with the original's current one (`hashOf` → null when the file is gone). Pure. */
export function driftOf(m: PortSources, hashOf: (path: string) => string | null, exists: (path: string) => boolean): DriftResult {
  const out: DriftResult = { checked: 0, changed: [], missing: [], portsMissing: [] };
  for (const p of m.ports) {
    if (!exists(p.port)) out.portsMissing.push(p.port);
    for (const o of p.originals) {
      out.checked++;
      const now = hashOf(o.path);
      if (now === null) out.missing.push({ port: p.port, original: o.path });
      else if (now !== o.sha256) out.changed.push({ port: p.port, original: o.path });
    }
  }
  return out;
}

export const driftClean = (r: DriftResult): boolean => !r.changed.length && !r.missing.length && !r.portsMissing.length;

/** One line per finding, each saying what to do. Pure. */
export function driftMessages(r: DriftResult): string[] {
  return [
    ...r.changed.map((c) => `re-check ${c.port} against ${c.original}, then update ${PORT_SOURCES_FILE} with \`--drift --update ${c.port}\``),
    ...r.missing.map((c) => `${c.original} is gone — find where ${c.port}'s original moved, fix the entry in ${PORT_SOURCES_FILE}, then \`--drift --update ${c.port}\``),
    ...r.portsMissing.map((p) => `${p} is listed in ${PORT_SOURCES_FILE} but doesn't exist — remove or fix its entry`),
  ];
}

/**
 * The manifest with each original's hash recomputed (a gone original keeps its old hash) — every port's, or, with
 * `only`, just the named ports' (each other entry is left exactly as it was). Pure.
 */
export function updatedPortSources(m: PortSources, hashOf: (path: string) => string | null, only?: readonly string[]): PortSources {
  const pick = only ? new Set(only) : null;
  return { ...m, ports: m.ports.map((p) => (pick && !pick.has(p.port) ? p : { ...p, originals: p.originals.map((o) => ({ ...o, sha256: hashOf(o.path) ?? o.sha256 })) })) };
}

/** The names in `only` that match no port in the manifest (a typo must not silently stamp nothing). Pure. */
export function unknownPorts(m: PortSources, only: readonly string[]): string[] {
  const have = new Set(m.ports.map((p) => p.port));
  return only.filter((n) => !have.has(n));
}

/** Where the completeness check looks: every runtime module (actions, loaders, props, the stores' ports). */
export const PORT_SCAN_DIR = "handoff/estimator/runtime";

/**
 * Does this module say it ports a Quartzite module? Its leading doc comment names a src/ file together with "port" /
 * "implementation(s) of" / "implements", or it type-checks itself against an app module (`import type * as Original
 * from "@/…"` — the registered action implementations). Pure.
 */
export function claimsPort(source: string): boolean {
  const head = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? "";
  const named = /src\/[\w()[\]./-]+\.tsx?/.test(head) && /\bport(?:ed|s|ing)?\b|\bimplementations? of\b|\bimplements\b/i.test(head);
  return named || /^import type \* as Original from "@\//m.test(source);
}

/**
 * Port modules (repo-relative paths under PORT_SCAN_DIR) that claim a port (claimsPort) but have no entry in the
 * manifest — a new port the drift guard would never watch. [] = complete. Pure over the listing and a reader.
 */
export function unlistedPorts(m: PortSources, files: readonly string[], read: (path: string) => string): string[] {
  const have = new Set(m.ports.map((p) => p.port));
  return files.filter((f) => /\.tsx?$/.test(f) && !have.has(f) && claimsPort(read(f))).sort();
}
