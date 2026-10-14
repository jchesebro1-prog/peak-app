/**
 * Ask AI (spec 2026-10-13-ask-ai-design.md §1, §2) — record references.
 *
 * The model cites a record as `[[kind:id]]`. The server emits one `ref` event
 * per record a tool (or the page context) exposed; the panel links a token
 * only when that exact kind + id was emitted (the whitelist). Pure and
 * client-safe: no store or server imports.
 */
import { quoteBuilderHref } from "@/lib/quote-links";
import { MEETINGS_BASE_HREF, meetingReaderHref, meetingsHref } from "@/app/(app)/inbox/meetings/format";

export const REF_KINDS = ["company", "venue", "quote", "lead", "project", "thread", "meeting", "survey", "part", "task"] as const;
export type RefKind = (typeof REF_KINDS)[number];
export type AskRef = { kind: RefKind; id: string };

/** Longest id a token may carry (catalog SKUs like `Symetrix:Jupiter 4` are the longest real ones). */
export const REF_ID_MAX = 160;

const KIND_SET: ReadonlySet<string> = new Set(REF_KINDS);
export function isRefKind(x: unknown): x is RefKind {
  return typeof x === "string" && KIND_SET.has(x);
}

/** `company:C-1` — the whitelist key. */
export function refKey(kind: RefKind, id: string): string {
  return `${kind}:${id}`;
}

/** The inverse of refKey; null for an unknown kind or an empty / over-long id. */
export function parseRefKey(key: string): AskRef | null {
  const i = typeof key === "string" ? key.indexOf(":") : -1;
  if (i <= 0) return null;
  const kind = key.slice(0, i);
  const id = key.slice(i + 1);
  if (!isRefKind(kind) || !cleanRefId(id)) return null;
  return { kind, id };
}

/** A usable id: trimmed, 1..REF_ID_MAX characters, no line breaks or `]`. Null otherwise. */
export function cleanRefId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const t = id.trim();
  if (!t || t.length > REF_ID_MAX || /[\r\n\]\[]/.test(t)) return null;
  return t;
}

/**
 * `[[kind:id]]`. The id runs to the first `]`; it may hold spaces and colons
 * (`[[part:Symetrix:Jupiter 4]]`) but no line break or bracket.
 */
const REF_TOKEN = /\[\[([a-z]+):([^\]\[\r\n]{1,160})\]\]/;

/** A fresh global token regex per call — a shared /g regex would carry `lastIndex` between callers. */
export function refTokenRe(): RegExp {
  return new RegExp(REF_TOKEN.source, "g");
}

export type RefSegment = { text: string } | { ref: AskRef };

/**
 * Split answer text into plain text and reference segments. A token with an
 * unknown kind stays text. Adjacent text segments are merged. Whether a ref
 * segment becomes a link is the renderer's call (the whitelist).
 */
export function parseRefTokens(text: string): RefSegment[] {
  const s = typeof text === "string" ? text : "";
  const out: RefSegment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && "text" in last) last.text += t;
    else out.push({ text: t });
  };
  let at = 0;
  for (const m of s.matchAll(refTokenRe())) {
    const start = m.index ?? 0;
    pushText(s.slice(at, start));
    const id = cleanRefId(m[2]);
    if (isRefKind(m[1]) && id) out.push({ ref: { kind: m[1], id } });
    else pushText(m[0]);
    at = start + m[0].length;
  }
  pushText(s.slice(at));
  return out;
}

/** The distinct, well-formed `[[kind:id]]` refs in a text, first-seen order, at most `max`. */
export function refTokensIn(text: string, max: number): AskRef[] {
  const seen = new Set<string>();
  const out: AskRef[] = [];
  for (const seg of parseRefTokens(text)) {
    if (!("ref" in seg)) continue;
    const k = refKey(seg.ref.kind, seg.ref.id);
    if (seen.has(k)) continue;
    if (out.length >= max) break;
    seen.add(k);
    out.push(seg.ref);
  }
  return out;
}

/** What a server-side loader knows beyond the id: a quote's builder, a meeting's tab. */
export type RefHrefHint = { quoteType?: string | null; filedAt?: number | null; noise?: boolean };

/**
 * The record's page (verified 2026-10-13 against src/app/(app)):
 * company `/companies/<id>`, venue `/venues/<id>`, quote its own builder
 * (`quoteBuilderHref`; the Estimator without a quoteType), lead
 * `/leads?lead=<id>`, project `/projects/<id>`, thread `/inbox?thread=<id>`,
 * meeting the Meetings reader (`meetingReaderHref` with a hint, else the
 * To file tab — the reader opens any meeting by id), survey
 * `/venue-assessments/<id>`, part `/catalog?q=<sku>` (the catalog list,
 * filtered — open to everyone, unlike `?edit=`), task `/queue`.
 */
export function hrefFor(kind: RefKind, id: string, hint: RefHrefHint = {}): string {
  const e = encodeURIComponent(id);
  switch (kind) {
    case "company":
      return `/companies/${e}`;
    case "venue":
      return `/venues/${e}`;
    case "quote":
      return quoteBuilderHref({ id, quoteType: hint.quoteType ?? null });
    case "lead":
      return `/leads?lead=${e}`;
    case "project":
      return `/projects/${e}`;
    case "thread":
      return `/inbox?thread=${e}`;
    case "meeting":
      return hint.filedAt !== undefined || hint.noise !== undefined
        ? meetingReaderHref({ id, filedAt: hint.filedAt ?? null, noise: !!hint.noise })
        : meetingsHref(MEETINGS_BASE_HREF, "to-file", id);
    case "survey":
      return `/venue-assessments/${e}`;
    case "part":
      return `/catalog?q=${e}`;
    case "task":
      return "/queue";
  }
}
