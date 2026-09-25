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
  t: Pick<CommThread, "messages" | "contactName" | "customer">,
  meName: string
): RowName {
  const all = t.messages || [];
  const authored = all.filter((m) => !!m.author);
  const counterpart = t.contactName || t.customer || "Customer";
  // Newest first by `at` — the store keeps messages sorted, but never trust it.
  const newestFirst = [...authored].sort((a, b) => (b.at || 0) - (a.at || 0));
  const lastOther = newestFirst.find((m) => m.author !== meName);
  const primary = lastOther ? lastOther.author : counterpart;
  // Distinct authors in first-seen order, me rendered as "me", first names only.
  const seen: string[] = [];
  for (const m of [...authored].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (!seen.includes(m.author)) seen.push(m.author);
  }
  const chain = seen.map((a) => (a === meName ? "me" : first(a))).join(", ");
  const secondary = chain ? (all.length > 1 ? `${chain} (${all.length})` : chain) : "";
  return { primary, secondary };
}
