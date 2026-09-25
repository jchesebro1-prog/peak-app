"use client";

import { useMemo, useState, useTransition, type CSSProperties, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { outlineToText, renderBody } from "@/lib/specs/outline";
import { scaffoldFrom, type SpecTemplateHeading } from "@/lib/specs/templates";
import { timeAgo } from "@/lib/format";
import { writePartSpecFieldsAction } from "./actions";

/**
 * Task 13 — the Spec panel on the part editor (mounted inside
 * PartFormModal's `<form>` in catalog/page.tsx, right after the datasheet
 * control). Article, entry title, same-as pointer, outline body and a live
 * preview of the numbering the entry will actually print with —
 * renderBody/outlineToText is the ONLY place that turns body text into
 * numbered lines, so this preview can never disagree with Phase B's
 * assembly.
 *
 * PUNCHLIST #141 state rule: every editable field seeds local state from
 * props ONCE per mount (never keyed on specUpdatedAt, never re-derived from
 * props in an effect) so an in-progress edit survives an unrelated
 * router.refresh() elsewhere on the page. The state chip at the top is the
 * one thing that reads `part` directly on every render instead of seeding
 * local state, which is what lets router.refresh() after a save bring it
 * current ("Authored") without remounting the textarea.
 *
 * Lives inside `<form action={upsertPart}>` like PartDatasheetControl
 * beside it: every button is type="button", no input/select/textarea here
 * carries a `name` (nothing leaks into upsertPart's FormData), and Enter in
 * a single-line field is preventDefault-ed so it can never submit the
 * surrounding part form.
 */

export type SpecPanelPart = {
  sku: string;
  desc: string;
  category?: string;
  specArticleId?: string;
  specSectionId?: string;
  specTitle?: string;
  specBody?: string;
  specSameAs?: string;
  specSort?: number;
  specState?: "authored" | "draft";
  specSource?: string;
  specUpdatedAt?: number;
  specUpdatedBy?: string;
};

export type SpecPanelArticle = { id: string; title: string; sectionNumber: string; manufacturers: string[] };
export type SpecPanelTemplate = { id: string; key: string; headings: SpecTemplateHeading[] };

const LBL: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const EXPLAIN: CSSProperties = { fontSize: 11, color: "#aab0bb", marginTop: 5, lineHeight: 1.4 };
const MUTED: CSSProperties = { fontSize: 11.5, color: "#9aa0ab" };
const ERR: CSSProperties = { fontSize: 12, color: "#b4543a" };
const SAVED: CSSProperties = { fontSize: 12, color: "#1f7a52", fontWeight: 600 };
const PREVIEW: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "#fafbfc",
  border: "1px solid #f0f1f4",
  borderRadius: 9,
  padding: "10px 12px",
  minHeight: 120,
  whiteSpace: "pre-wrap",
};

type Tone = "ok" | "warn" | "muted";
const CHIP_STYLE: Record<Tone, CSSProperties> = {
  ok: { background: "#eaf6ef", border: "1px solid #cce9da", color: "#1f7a52" },
  warn: { background: "#fbf3dd", border: "1px solid #f0e2bd", color: "#8a6d1f" },
  muted: { background: "#f1f2f5", border: "1px solid #e4e7ec", color: "#5b616e" },
};

/** Reads `part` directly (never local state) so a save + router.refresh()
 *  brings this current without remounting the rest of the panel. */
function stateChip(part: SpecPanelPart): { text: string; tone: Tone } {
  const sameAs = (part.specSameAs || "").trim();
  if (sameAs) return { text: `Same spec as ${sameAs}`, tone: "muted" };
  if (!(part.specBody || "").trim()) return { text: "No spec language", tone: "warn" };
  if (part.specState === "draft") return { text: "Draft — not printing yet", tone: "warn" };
  return { text: "Authored", tone: "ok" };
}

function noEnter(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.preventDefault();
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {warnings.map((w, i) => (
        <div key={i} style={MUTED}>
          {w}
        </div>
      ))}
    </div>
  );
}

export default function SpecPanel({
  part,
  articles,
  templates,
  defaultArticleId,
}: {
  part: SpecPanelPart;
  articles: SpecPanelArticle[];
  templates: SpecPanelTemplate[];
  /** Server-computed: what the part resolves to with no explicit article
   *  (category default, else an adopted legacy Displays pointer, else D94's
   *  section). null = nothing resolves. */
  defaultArticleId: string | null;
}) {
  const router = useRouter();

  const [articleId, setArticleId] = useState(part.specArticleId || "");
  const [title, setTitle] = useState(part.specTitle || "");
  const [sameAs, setSameAs] = useState(part.specSameAs || "");
  const [body, setBody] = useState(part.specBody || "");
  const [sortText, setSortText] = useState(part.specSort != null ? String(part.specSort) : "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const chip = stateChip(part);

  const defaultArticle = defaultArticleId ? articles.find((a) => a.id === defaultArticleId) || null : null;
  const effectiveArticle = articleId ? articles.find((a) => a.id === articleId) || null : defaultArticle;

  const preview = useMemo(
    () =>
      renderBody(body, {
        context: "entry",
        placeholders: { manufacturers: effectiveArticle?.manufacturers ?? [] },
      }),
    [body, effectiveArticle]
  );

  const headingText = (title.trim() || part.desc || "").trim() || "—";

  const matchingTemplateId = useMemo(() => {
    const cat = (part.category || "").trim().toLowerCase();
    if (!cat) return null;
    return templates.find((t) => t.key.trim().toLowerCase() === cat)?.id ?? null;
  }, [part.category, templates]);

  const sameAsTrimmed = sameAs.trim();
  const showInsertTemplate = !body.trim() && !sameAsTrimmed && templates.length > 0;

  const save = () => {
    setErr("");
    setSaved(false);
    start(async () => {
      const n = sortText.trim() === "" ? NaN : Number(sortText);
      const res = await writePartSpecFieldsAction({
        sku: part.sku,
        specArticleId: articleId || undefined,
        specTitle: title,
        // When same-as is set the textarea is disabled and `body` is stale
        // (it still holds whatever was typed before same-as was set, or the
        // last-loaded stored body) — omit the key entirely so
        // writePartSpecFieldsAction leaves the stored specBody untouched
        // rather than overwriting it with this stale value.
        ...(sameAsTrimmed ? {} : { specBody: body }),
        specSameAs: sameAs,
        specSort: Number.isFinite(n) ? n : undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: "#9aa0ab",
          textTransform: "uppercase",
          letterSpacing: ".05em",
          marginBottom: 10,
        }}
      >
        Spec language
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: part.specState === "draft" ? 5 : 14 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 20,
            padding: "2px 9px",
            ...CHIP_STYLE[chip.tone],
          }}
        >
          {chip.text}
        </span>
        {part.specSource && <span style={MUTED}>{part.specSource}</span>}
        {(part.specUpdatedBy || part.specUpdatedAt) && (
          <span style={MUTED}>
            {[part.specUpdatedBy, part.specUpdatedAt ? timeAgo(part.specUpdatedAt) : ""].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      {part.specState === "draft" && (
        <div style={{ ...EXPLAIN, marginBottom: 14 }}>
          A draft prints as missing on the match report until it&apos;s saved here.
        </div>
      )}

      <div style={{ marginBottom: 13 }}>
        <label style={LBL}>Article</label>
        <select className="pk-input" value={articleId} onChange={(e) => setArticleId(e.target.value)}>
          <option value="">— default from category —</option>
          {articles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.sectionNumber} · {a.title}
            </option>
          ))}
        </select>
        {!articleId && (
          <div style={EXPLAIN}>
            {defaultArticle
              ? `No explicit article — this part currently resolves to ${defaultArticle.sectionNumber} · ${defaultArticle.title} (the category default, or an adopted legacy pointer, whichever resolves).`
              : "Nothing resolves — pick one."}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 13 }}>
        <label style={LBL}>Entry title</label>
        <input
          className="pk-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={noEnter}
          placeholder="COLOR MIXING LIGHT EMITTING DIODE PROFILE FIXTURE"
        />
      </div>

      <div style={{ marginBottom: 13 }}>
        <label style={LBL}>Same spec as</label>
        <input
          className="pk-input"
          value={sameAs}
          onChange={(e) => setSameAs(e.target.value)}
          onKeyDown={noEnter}
          placeholder="e.g. CL-HB3"
        />
        {sameAsTrimmed && (
          <div style={EXPLAIN}>
            Recorded — in Phase A this part still prints its own body below; the same-as link takes effect once
            Phase B&apos;s assembly reads it.
          </div>
        )}
      </div>

      <div style={{ marginBottom: 13 }}>
        <label style={LBL}>Body</label>
        {showInsertTemplate && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            <span style={MUTED}>Insert template:</span>
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === matchingTemplateId ? "pk-btn-accent" : "pk-btn-outline"}
                // scaffoldFrom only reads `.headings`; the other SpecTemplate
                // fields (title/rules/example/updatedAt/updatedBy) are the
                // template editor's, not this trimmed server payload's, so
                // fill them with structurally-valid placeholders.
                onClick={() => setBody(scaffoldFrom({ ...t, title: "", rules: "", example: "", updatedAt: 0, updatedBy: "" }))}
              >
                {t.key}
              </button>
            ))}
          </div>
        )}
        <textarea
          className="pk-input pk-mono"
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={!!sameAsTrimmed}
          style={{ resize: "vertical" }}
        />
      </div>

      <div style={{ marginBottom: 16, maxWidth: 140 }}>
        <label style={LBL}>Sort</label>
        <input
          className="pk-input mono"
          inputMode="numeric"
          value={sortText}
          onChange={(e) => setSortText(e.target.value)}
          onKeyDown={noEnter}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>Live preview</label>
        <div style={{ ...MUTED, marginBottom: 6 }}>B. {headingText}</div>
        <pre style={PREVIEW}>{outlineToText(preview.lines, "  ")}</pre>
        <Warnings warnings={preview.warnings} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save spec"}
        </button>
        {saved && <span style={SAVED}>Saved</span>}
        {err && <span style={ERR}>{err}</span>}
      </div>
    </div>
  );
}
