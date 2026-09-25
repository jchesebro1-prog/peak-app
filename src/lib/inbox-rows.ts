/**
 * #128 — the Inbox list row's name, Gmail-style: the last person who
 * responded (ignoring me), with a "Brenda, me (3)" chain under it. Pure.
 */
import type { CommThread } from "@/lib/stores/comms";

export type RowName = { primary: string; secondary: string };

function first(name: string): string {
  const n = (name || "").trim();
  return n.split(/\s+/)[0] || n;
}

export function rowName(
  t: Pick<CommThread, "messages" | "contactName" | "customer">
): RowName {
  const all = t.messages || [];
  const authored = all.filter((m) => !!m.author);
  const counterpart = t.contactName || t.customer || "Customer";
  // #128 review (I3): the Inbox is personal-only (one mailbox per signed-in
  // user — comms.ts visibleTo), so "is this me" is `direction === "out"`,
  // not a name match. A name match missed a reply the moment Gmail's display
  // name for the account didn't exactly equal the roster name (a trailing
  // suffix, a nickname, a mid-cycle rename) — direction can't drift like that.
  const newestFirst = [...authored].sort((a, b) => (b.at || 0) - (a.at || 0));
  const lastOther = newestFirst.find((m) => m.direction !== "out");
  const primary = lastOther ? lastOther.author : counterpart;
  // Distinct participants in first-seen order — every outbound message
  // collapses to "me" (whatever its stamped author name), every inbound one
  // keeps its full author name for the redundancy check just below.
  const seen: string[] = [];
  for (const m of [...authored].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const label = m.direction === "out" ? "me" : m.author;
    if (!seen.includes(label)) seen.push(label);
  }
  // A single participant whose label already equals the primary name (one
  // inbound thread, nobody's replied) says nothing the row doesn't already
  // show; a lone "me" while primary is the counterpart still does (you sent
  // it and they haven't answered), so that one is kept.
  const redundant = seen.length === 1 && seen[0] === primary;
  const chain = redundant ? "" : seen.map((a) => (a === "me" ? "me" : first(a))).join(", ");
  const secondary = chain ? (all.length > 1 ? `${chain} (${all.length})` : chain) : "";
  return { primary, secondary };
}
