/**
 * Ask AI — the answer's safe rendering model (spec 2026-10-13-ask-ai-design.md
 * §1 "Answer rendering"). Model text is untrusted: it becomes plain-text
 * blocks — paragraphs, `- ` bullets and `**bold**` only — that the panel
 * renders as React text nodes, never as HTML. A `[[kind:id]]` token becomes a
 * link only when a `ref` event whitelisted that exact kind:id in this
 * conversation; anything else prints as text. Pure and client-safe.
 */
import { parseRefTokens, refKey, type RefKind } from "./ask-refs";

export type AskLinkRef = { kind: RefKind; id: string; title: string; href: string };
/** The conversation's whitelist: `kind:id` → what the `ref` event said. */
export type AskWhitelist = ReadonlyMap<string, { title: string; href: string }>;
export type AskInline = { text: string; bold: boolean } | { link: AskLinkRef; bold: boolean };
export type AskBlock = { type: "p"; lines: AskInline[][] } | { type: "ul"; items: AskInline[][] };

/** A link's text is the record's title, shortened. */
export const ASK_LINK_TITLE_MAX = 80;

const BULLET = /^\s*[-*•]\s+/;
const HEADING = /^\s*#{1,6}\s+/;

/** A site-relative path only (`/x`, never `//x` or `/\x`), with no whitespace or control characters. */
export function isSitePath(href: unknown): href is string {
  return typeof href === "string" && href.startsWith("/") && !/^\/[\\/]/.test(href) && !/[\s\u0000-\u001f\u007f-\u009f]/.test(href);
}

/** A web source's URL when it is http(s), else null. */
export function safeSourceUrl(url: unknown): string | null {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** A source's label: its title, else the URL's host. */
export function sourceLabel(url: string, title: string): string {
  const t = (title || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 120 ? t.slice(0, 119) + "…" : t;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function shortTitle(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > ASK_LINK_TITLE_MAX ? t.slice(0, ASK_LINK_TITLE_MAX - 1) + "…" : t;
}

/**
 * One line → inline runs. `**` toggles bold across text and links; an
 * unpaired last `**` stays literal. A whitelisted token links to its href
 * with the record's title; any other token prints its id as plain text.
 */
export function renderInline(line: string, whitelist: AskWhitelist): AskInline[] {
  const segs = parseRefTokens(line);
  let markers = 0;
  for (const s of segs) if ("text" in s) markers += s.text.split("**").length - 1;
  const usable = markers - (markers % 2);
  let seen = 0;
  let bold = false;
  const out: AskInline[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && "text" in last && last.bold === bold) out[out.length - 1] = { text: last.text + text, bold };
    else out.push({ text, bold });
  };
  for (const s of segs) {
    if ("ref" in s) {
      const hit = whitelist.get(refKey(s.ref.kind, s.ref.id));
      if (hit && isSitePath(hit.href)) out.push({ link: { kind: s.ref.kind, id: s.ref.id, title: shortTitle(hit.title || s.ref.id), href: hit.href }, bold });
      else pushText(s.ref.id);
      continue;
    }
    s.text.split("**").forEach((piece, i) => {
      if (i > 0) {
        if (seen < usable) {
          bold = !bold;
          seen++;
        } else pushText("**");
      }
      pushText(piece);
    });
  }
  return out;
}

/** The whole answer → blocks: blank lines split paragraphs, `- ` / `* ` / `• ` lines group into a list, `#` headings print bold. */
export function renderAnswerBlocks(text: string, whitelist: AskWhitelist): AskBlock[] {
  const blocks: AskBlock[] = [];
  let cur: AskBlock | null = null;
  for (const raw of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!raw.trim()) {
      cur = null;
      continue;
    }
    if (BULLET.test(raw)) {
      if (!cur || cur.type !== "ul") blocks.push((cur = { type: "ul", items: [] }));
      cur.items.push(renderInline(raw.replace(BULLET, "").trimEnd(), whitelist));
      continue;
    }
    const heading = HEADING.test(raw);
    let inl = renderInline(raw.replace(HEADING, "").trim(), whitelist);
    if (heading) inl = inl.map((x) => ({ ...x, bold: true }));
    if (!cur || cur.type !== "p") blocks.push((cur = { type: "p", lines: [] }));
    cur.lines.push(inl);
  }
  return blocks;
}
