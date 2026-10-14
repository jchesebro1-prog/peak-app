/**
 * Ask AI stream events (spec 2026-10-13-ask-ai-design.md §2) — NDJSON, one
 * JSON object per line. Pure and client-safe: the route encodes, the panel
 * decodes.
 */
import { isRefKind, type RefKind } from "./ask-refs";
import { isAskCard, type AskCard } from "./ask-cards";

export type AskEvent =
  | { t: "status"; text: string }
  /** One per record a tool returned — the link whitelist. */
  | { t: "ref"; kind: RefKind; id: string; title: string; href: string }
  | { t: "text"; d: string }
  | { t: "card"; card: AskCard }
  | { t: "source"; url: string; title: string }
  | { t: "done"; runId: string | null }
  | { t: "error"; message: string };

/** One event as one line (JSON.stringify escapes every line break inside strings). */
export function encodeEvent(e: AskEvent): string {
  return JSON.stringify(e) + "\n";
}

const str = (v: unknown): v is string => typeof v === "string";

/** A parsed line → a well-formed event, else null (unknown or malformed lines are skipped). */
export function toAskEvent(v: unknown): AskEvent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.t) {
    case "status":
      return str(o.text) ? { t: "status", text: o.text } : null;
    case "ref":
      return isRefKind(o.kind) && str(o.id) && str(o.title) && str(o.href) && o.href.startsWith("/") && !/^\/[\\/]/.test(o.href)
        ? { t: "ref", kind: o.kind, id: o.id, title: o.title, href: o.href }
        : null;
    case "text":
      return str(o.d) ? { t: "text", d: o.d } : null;
    case "card":
      return isAskCard(o.card) ? { t: "card", card: o.card } : null;
    case "source":
      return str(o.url) && /^https?:\/\//i.test(o.url) && str(o.title) ? { t: "source", url: o.url, title: o.title } : null;
    case "done":
      return o.runId === null || str(o.runId) ? { t: "done", runId: o.runId as string | null } : null;
    case "error":
      return str(o.message) ? { t: "error", message: o.message } : null;
    default:
      return null;
  }
}

/**
 * Decode every complete line in `buffer`; `rest` is the trailing partial line
 * to prepend to the next chunk. Blank, non-JSON and malformed lines are dropped.
 */
export function decodeLines(buffer: string): { events: AskEvent[]; rest: string } {
  const s = typeof buffer === "string" ? buffer : "";
  const cut = s.lastIndexOf("\n");
  if (cut < 0) return { events: [], rest: s };
  const events: AskEvent[] = [];
  for (const line of s.slice(0, cut).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let v: unknown;
    try {
      v = JSON.parse(t);
    } catch {
      continue;
    }
    const e = toAskEvent(v);
    if (e) events.push(e);
  }
  return { events, rest: s.slice(cut + 1) };
}
