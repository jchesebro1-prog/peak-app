/**
 * Ask AI page context (spec 2026-10-13-ask-ai-design.md §3) — the record the
 * panel was opened over: pure route parsing (`parsePage`) plus the matching
 * read tool's loader, under the same access rule. An unknown route, a
 * missing record and a forbidden one all give no context (null).
 *
 * `text` is the record's summary, unwrapped — packFirstUserMessage caps it
 * and wraps it in `<current_screen>` + `<record>` itself. `refs` are the
 * records the summary exposes (the ref whitelist), `ref` first.
 */
import { parsePage } from "./features/ask-page";
import { loadRecordSummary, type AskToolRef, type AskUser } from "./ask-tools-server";

export type AskPageContext = { ref: AskToolRef; title: string; text: string; refs: AskToolRef[]; emails: string[] };

export async function pageContext(path: string | null | undefined, me: AskUser): Promise<AskPageContext | null> {
  const at = parsePage(path);
  if (!at) return null;
  const s = await loadRecordSummary(at.kind, at.id, me);
  if (!s) return null;
  return { ref: s.ref, title: s.ref.title, text: s.body, refs: s.refs, emails: s.emails };
}
