/**
 * #281 — a system narrative's plain-text formatting, turned into printable
 * blocks. Pure (no React) so the test:specs harness can import it.
 *
 * Rules: a blank line (whitespace-only counts) starts a new group; inside a
 * group, consecutive lines starting with "- " (after leading whitespace) form
 * one bullet list (marker stripped, item trimmed), and any other consecutive
 * lines form one paragraph whose line breaks are kept (each line trimmed at
 * the end). Nothing is stored — the narrative stays the raw string.
 */
export type NarrativeBlock = { kind: "p"; lines: string[] } | { kind: "ul"; items: string[] };

const BULLET = /^\s*- /;

export function narrativeBlocks(text: string | null | undefined): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  const lines = (text || "").replace(/\r\n?/g, "\n").split("\n");
  let cur: NarrativeBlock | null = null;
  for (const raw of lines) {
    if (!raw.trim()) {
      // A blank line closes whatever block is open.
      cur = null;
      continue;
    }
    if (BULLET.test(raw)) {
      const item = raw.replace(BULLET, "").trim();
      if (!cur || cur.kind !== "ul") {
        cur = { kind: "ul", items: [] };
        blocks.push(cur);
      }
      cur.items.push(item);
    } else {
      if (!cur || cur.kind !== "p") {
        cur = { kind: "p", lines: [] };
        blocks.push(cur);
      }
      cur.lines.push(raw.trimEnd());
    }
  }
  return blocks;
}
