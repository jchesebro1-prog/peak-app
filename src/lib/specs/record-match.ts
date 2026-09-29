/**
 * Spec record matching (#205 follow-on, spec 2026-09-28-spec-records-design.md
 * §3.2) — pure. Matches one BOM/estimate row against the Spec Library, in
 * order: pinned → exact part number → wildcard → match key → legacy →
 * draft → no-match-with-candidates. Only `ready` records print; `archived` never
 * matches; a `draft` hit is reported, never printed. Never auto-assigns —
 * `no-match` candidates are for a human to pick from.
 */

import { similarity } from "@/lib/bid-spec";
import type { SpecRecord } from "@/lib/specs/records";
import { normMatchKey, normPartNumber, partNumberCandidates, wildcardMatches } from "@/lib/specs/record-keys";

export type MatchRow = {
  sku?: string;
  mfrNumber?: string;
  specKey?: string;
  desc?: string;
  specId?: string;
  waived?: { reason: string };
};

export type RowMatch =
  | { status: "matched"; specId: string; via: "pinned" | "exact" | "wildcard" | "key" }
  | { status: "legacy"; draftSpecId?: string }
  | { status: "ambiguous"; specIds: string[] }
  | { status: "draft"; specId: string }
  | { status: "waived"; reason: string }
  | { status: "no-match"; candidates: string[] };

/**
 * The smallest score that still keeps the no-match candidate list useful.
 * D94's own bucket (`bid-spec.ts`) uses 0.34 for whole-fixture descriptions
 * matched against other whole-fixture descriptions — both sides are dense,
 * similarly-shaped text. Here one side is often just a short row description
 * plus a stray part number, scored against a record's title + basis of
 * design + manufacturer + part numbers, which is longer and pulls the
 * denominator up. At the brief's floor of 0.2, the canonical "Lonestar
 * moving light" / `XYZ-123` row (brief §10) scores ~0.15–0.18 against the
 * Lonestar records it should surface and is silently dropped — worse than
 * useless, since the row then reports `no-match` with an EMPTY candidate
 * list instead of a wrong-but-dismissable one. 0.1 is the smallest value
 * that keeps that row's real candidates (never auto-assigned regardless).
 */
const CANDIDATE_FLOOR = 0.1;
const MAX_CANDIDATES = 4;

function bySpecId(records: SpecRecord[], specId: string): SpecRecord | undefined {
  return records.find((r) => r.specId === specId);
}

function exactHits(ready: SpecRecord[], candidates: string[]): SpecRecord[] {
  if (!candidates.length) return [];
  return ready.filter((r) => r.mfrNumbers.some((n) => candidates.includes(normPartNumber(n))));
}

function wildcardHits(ready: SpecRecord[], candidates: string[]): SpecRecord[] {
  if (!candidates.length) return [];
  return ready.filter((r) => r.mfrNumbers.some((n) => candidates.some((c) => wildcardMatches(n, c))));
}

function keyHits(ready: SpecRecord[], specKey: string | undefined): SpecRecord[] {
  if (!specKey) return [];
  const key = normMatchKey(specKey);
  return ready.filter((r) => r.kind === "system" && r.matchKey && normMatchKey(r.matchKey) === key);
}

function sortedIds(records: SpecRecord[]): string[] {
  return records.map((r) => r.specId).sort();
}

export function matchRow(
  row: MatchRow,
  records: SpecRecord[],
  part?: { manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string } | null,
  hasLegacyText?: boolean
): RowMatch {
  if (row.waived) return { status: "waived", reason: row.waived.reason };

  // Pinned specId (Link-to-existing / Add-from-library). A ready hit wins
  // outright; a draft hit reports draft; archived or unknown falls through
  // to the ordinary matching steps below.
  if (row.specId) {
    const pinned = bySpecId(records, row.specId);
    if (pinned?.status === "ready") return { status: "matched", specId: pinned.specId, via: "pinned" };
    if (pinned?.status === "draft") return { status: "draft", specId: pinned.specId };
  }

  const ready = records.filter((r) => r.status === "ready");
  const draft = records.filter((r) => r.status === "draft");
  const candidates = partNumberCandidates(row, part);

  const step1 = exactHits(ready, candidates);
  if (step1.length === 1) return { status: "matched", specId: step1[0].specId, via: "exact" };
  if (step1.length >= 2) return { status: "ambiguous", specIds: sortedIds(step1) };

  const step2 = wildcardHits(ready, candidates);
  if (step2.length === 1) return { status: "matched", specId: step2[0].specId, via: "wildcard" };
  if (step2.length >= 2) return { status: "ambiguous", specIds: sortedIds(step2) };

  const step3 = keyHits(ready, row.specKey);
  if (step3.length === 1) return { status: "matched", specId: step3[0].specId, via: "key" };
  if (step3.length >= 2) return { status: "ambiguous", specIds: sortedIds(step3) };

  // No ready hit at steps 1-3. Legacy catalog text still prints, so it wins
  // over a draft-only hit (D452) — a draft must never shadow text that
  // prints today; the draft rides along as a note. A draft-only hit with no
  // legacy text is reported (not printed), ahead of no-match.
  const draftHit =
    exactHits(draft, candidates)[0] ?? wildcardHits(draft, candidates)[0] ?? keyHits(draft, row.specKey)[0];
  if (hasLegacyText) return draftHit ? { status: "legacy", draftSpecId: draftHit.specId } : { status: "legacy" };
  if (draftHit) return { status: "draft", specId: draftHit.specId };

  const rowText = [row.desc, candidates.join(" ")].filter(Boolean).join(" ");
  const scored = ready
    .map((r) => {
      const recordText = [r.title, r.basisOfDesign, r.manufacturer, ...r.mfrNumbers].filter(Boolean).join(" ");
      return { specId: r.specId, score: similarity(rowText, recordText) };
    })
    .filter((s) => s.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score || a.specId.localeCompare(b.specId))
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.specId);

  return { status: "no-match", candidates: scored };
}

/** Every `ready` companion record whose `includeWith` names one of the
 *  already-matched spec ids — once per document, unique, sorted by specId,
 *  never a record that is itself already matched. */
export function companionsFor(matchedSpecIds: Iterable<string>, records: SpecRecord[]): string[] {
  const matched = new Set(matchedSpecIds);
  const out = new Set<string>();
  for (const r of records) {
    if (r.status !== "ready" || r.kind !== "companion") continue;
    if (matched.has(r.specId)) continue;
    if (r.includeWith.some((id) => matched.has(id))) out.add(r.specId);
  }
  return [...out].sort();
}
