"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { outlineToText, parseOutline } from "@/lib/specs/outline";
import { fillCurtainTemplate } from "@/lib/specs/curtains";
import type { SpecTemplate, SpecTemplateHeading } from "@/lib/stores/spec-templates";
import type { CurtainFullnessKey, SpecCurtainTemplate } from "@/lib/stores/spec-curtain-templates";
import type { GridCurtain } from "@/lib/design/grid-bom";
import {
  deleteTemplateAction,
  saveCurtainTemplateAction,
  saveTemplateAction,
  seedTemplatesAction,
} from "../actions";

/**
 * Task 10 — the template editors. `TemplateEditor` edits one authoring
 * formula (headings/rules/example); `CurtainTemplateEditor` edits one of the
 * four Grid curtain templates. `RestoreStarterTemplatesButton` is the
 * go-live-reset recovery path, mounted on the templates index (page.tsx).
 *
 * Follows the section editor's idiom (../library/[sectionId]/editor.tsx):
 * useTransition, a local error/saved line, router.refresh() on save. State
 * is seeded from props ONCE per component instance (PUNCHLIST #141) — never
 * re-derived from props after mount.
 */

const CARD: CSSProperties = { padding: "16px 18px", marginBottom: 18 };
const LBL: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const EXPLAIN: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 5, lineHeight: 1.4 };
const MUTED: CSSProperties = { fontSize: 11.5, color: "#9aa0ab" };
const SAVED: CSSProperties = { fontSize: 12, color: "#1f7a52", fontWeight: 600 };
const ERR: CSSProperties = { fontSize: 12, color: "#b4543a" };
const PREVIEW: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  background: "#fafbfc",
  border: "1px solid #f0f1f4",
  borderRadius: 9,
  padding: "10px 12px",
  minHeight: 160,
  whiteSpace: "pre-wrap",
};

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

export function TemplateEditor({ template }: { template: SpecTemplate }) {
  const router = useRouter();
  const [title, setTitle] = useState(template.title);
  const [headings, setHeadings] = useState<SpecTemplateHeading[]>(() => template.headings);
  const [rules, setRules] = useState(template.rules);
  const [example, setExample] = useState(template.example);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  // An example is a single product entry: its own letter has already
  // consumed the first outline level, so it previews as "1.", "a." — not
  // "A." the way a Part 1/Part 3 article body does.
  const preview = useMemo(() => parseOutline(example, "entry"), [example]);

  const updateHeading = (i: number, patch: Partial<SpecTemplateHeading>) => {
    setSaved(false);
    setHeadings((prev) => prev.map((h, idx) => (idx === i ? { ...h, ...patch } : h)));
  };
  const moveHeading = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= headings.length) return;
    setSaved(false);
    setHeadings((prev) => {
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const removeHeading = (i: number) => {
    setSaved(false);
    setHeadings((prev) => prev.filter((_, idx) => idx !== i));
  };
  const addHeading = () => {
    setSaved(false);
    setHeadings((prev) => [...prev, { label: "", guidance: "" }]);
  };

  const save = () => {
    const t = title.trim();
    if (!t) {
      setErr("A template needs a title.");
      return;
    }
    start(async () => {
      setErr("");
      const res = await saveTemplateAction({
        key: template.key,
        title: t,
        headings: headings.map((h) => ({ label: h.label.trim(), guidance: h.guidance.trim() })).filter((h) => h.label),
        rules,
        example,
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
    <div className="pk-content" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/templates" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec templates
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">{template.title || "Untitled formula"}</div>
        <div className="pk-page-sub">
          The headings, phrasing rules and worked example the part editor&apos;s &quot;Insert template&quot; scaffolds
          from.
        </div>
      </div>

      <div className="pk-card" style={CARD}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL}>Key</label>
            <input className="pk-input mono" value={template.key} disabled readOnly style={{ opacity: 0.65 }} />
            <div style={EXPLAIN}>Locked — the id is a slug of this key and the route depends on it.</div>
          </div>
          <div>
            <label style={LBL}>Title</label>
            <input
              className="pk-input"
              value={title}
              onChange={(e) => {
                setSaved(false);
                setTitle(e.target.value);
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LBL}>Headings</label>
          {headings.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
              <input
                className="pk-input"
                placeholder="Heading label, e.g. Basis of Design"
                value={h.label}
                onChange={(e) => updateHeading(i, { label: e.target.value })}
                style={{ flex: "0 0 220px" }}
              />
              <input
                className="pk-input"
                placeholder="Guidance for what fills this heading"
                value={h.guidance}
                onChange={(e) => updateHeading(i, { guidance: e.target.value })}
                style={{ flex: "1 1 260px" }}
              />
              <button
                type="button"
                className="pk-btn-outline"
                disabled={i === 0}
                onClick={() => moveHeading(i, -1)}
                title="Move up"
                aria-label="Move heading up"
              >
                ↑
              </button>
              <button
                type="button"
                className="pk-btn-outline"
                disabled={i === headings.length - 1}
                onClick={() => moveHeading(i, 1)}
                title="Move down"
                aria-label="Move heading down"
              >
                ↓
              </button>
              <button type="button" className="pk-btn-outline" onClick={() => removeHeading(i)} aria-label="Remove heading">
                Remove
              </button>
            </div>
          ))}
          {headings.length === 0 && <div style={{ ...MUTED, marginBottom: 8 }}>No headings yet.</div>}
          <button type="button" className="pk-btn-outline" onClick={addHeading}>
            + Add heading
          </button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LBL}>Rules</label>
          <textarea
            className="pk-input"
            rows={4}
            value={rules}
            onChange={(e) => {
              setSaved(false);
              setRules(e.target.value);
            }}
            style={{ resize: "vertical" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL}>Example (one product entry)</label>
            <textarea
              className="pk-input pk-mono"
              rows={10}
              value={example}
              onChange={(e) => {
                setSaved(false);
                setExample(e.target.value);
              }}
              style={{ resize: "vertical" }}
            />
          </div>
          <div>
            <label style={LBL}>Preview</label>
            <pre style={PREVIEW}>{outlineToText(preview.lines, "  ")}</pre>
            <Warnings warnings={preview.warnings} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && <span style={SAVED}>Saved</span>}
          {err && <span style={ERR}>{err}</span>}
        </div>

        <div style={{ borderTop: "1px solid #f0f1f4", marginTop: 16, paddingTop: 14 }}>
          <ConfirmButton
            className="pk-btn-danger"
            label="Delete formula"
            confirmLabel="Delete this formula"
            onConfirm={async () => {
              const res = await deleteTemplateAction(template.id);
              if (!res.ok) throw new Error(res.error); // ConfirmButton renders the thrown message inline
              router.push("/design/specs/templates");
            }}
          />
          <div style={EXPLAIN}>
            If this was a starter formula, &quot;Restore starter templates&quot; on the templates screen brings it
            back — it never overwrites an edited formula, only adds back what is missing.
          </div>
        </div>
      </div>
    </div>
  );
}

const FULLNESS_ROWS: Array<{ key: CurtainFullnessKey; label: string }> = [
  { key: "0", label: "0%" },
  { key: "50", label: "50%" },
  { key: "75", label: "75%" },
  { key: "100", label: "100%" },
];

export type CurtainTemplateArticleOption = { id: string; title: string; sectionNumber: string };

export function CurtainTemplateEditor({
  template,
  articles,
}: {
  template: SpecCurtainTemplate;
  articles: CurtainTemplateArticleOption[];
}) {
  const router = useRouter();
  const [articleId, setArticleId] = useState(template.articleId);
  const [sortText, setSortText] = useState(String(template.sort));
  const [title, setTitle] = useState(template.title);
  const [body, setBody] = useState(template.body);
  const [fullnessClauses, setFullnessClauses] = useState<Record<CurtainFullnessKey, string>>(() => ({
    ...template.fullnessClauses,
  }));
  const [hang, setHang] = useState(template.hang);
  const [defaultColor, setDefaultColor] = useState(template.defaultColor);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);

  const sample: GridCurtain = useMemo(
    () => ({
      type: template.id,
      name: `Sample ${template.id}`,
      widthFt: 10,
      heightFt: 24,
      fullnessPct: 50,
      fabricSku: "SAMPLE",
    }),
    [template.id]
  );

  const preview = useMemo(() => {
    const draft: SpecCurtainTemplate = {
      id: template.id,
      articleId,
      sort: Number(sortText) || 0,
      title,
      body,
      fullnessClauses,
      hang,
      defaultColor,
      updatedAt: template.updatedAt,
      updatedBy: template.updatedBy,
    };
    const filled = fillCurtainTemplate(draft, sample, "22oz Velour");
    return parseOutline(filled.body, "entry");
  }, [
    template.id,
    template.updatedAt,
    template.updatedBy,
    articleId,
    sortText,
    title,
    body,
    fullnessClauses,
    hang,
    defaultColor,
    sample,
  ]);

  const save = () => {
    const t = title.trim();
    if (!t) {
      setErr("A curtain template needs a title.");
      return;
    }
    start(async () => {
      setErr("");
      const res = await saveCurtainTemplateAction({
        id: template.id,
        articleId,
        sort: Number(sortText) || 0,
        title: t,
        body,
        fullnessClauses,
        hang,
        defaultColor,
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
    <div className="pk-content" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/design/specs/templates" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Spec templates
        </Link>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div className="pk-page-title">{template.title || template.id} curtains</div>
        <div className="pk-page-sub">
          Every Grid curtain of type {template.id} resolves through this one template — there is no per-curtain
          catalog part, and no delete here by design.
        </div>
      </div>

      <div className="pk-card" style={CARD}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 100px", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL}>Title</label>
            <input
              className="pk-input"
              value={title}
              onChange={(e) => {
                setSaved(false);
                setTitle(e.target.value);
              }}
            />
          </div>
          <div>
            <label style={LBL}>Article</label>
            <select
              className="pk-input"
              style={{ cursor: "pointer" }}
              value={articleId}
              onChange={(e) => {
                setSaved(false);
                setArticleId(e.target.value);
              }}
            >
              <option value="">— none yet —</option>
              {articles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.sectionNumber ? `${a.sectionNumber} · ${a.title}` : a.title}
                </option>
              ))}
            </select>
            <div style={EXPLAIN}>The Part 2 article this curtain type&apos;s entries print under.</div>
          </div>
          <div>
            <label style={LBL}>Sort</label>
            <input
              className="pk-input mono"
              inputMode="numeric"
              value={sortText}
              onChange={(e) => {
                setSaved(false);
                setSortText(e.target.value);
              }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL}>Body</label>
            <textarea
              className="pk-input pk-mono"
              rows={10}
              value={body}
              onChange={(e) => {
                setSaved(false);
                setBody(e.target.value);
              }}
              style={{ resize: "vertical" }}
            />
            <div style={EXPLAIN}>
              Slots: {"{{name}} {{material}} {{color}} {{fullness}} {{fullnessClause}} {{hang}} {{width}} {{height}}"}
            </div>
          </div>
          <div>
            <label style={LBL}>Preview with a sample curtain</label>
            <pre style={PREVIEW}>{outlineToText(preview.lines, "  ")}</pre>
            <Warnings warnings={preview.warnings} />
            <div style={EXPLAIN}>
              Any slot left unfilled shows up as literal {"{{…}}"} above — that is the point.
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={LBL}>Fullness clauses</label>
          {FULLNESS_ROWS.map(({ key, label }) => (
            <div key={key} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ ...MUTED, width: 42, fontFamily: "var(--font-mono)" }}>{label}</span>
              <input
                className="pk-input"
                value={fullnessClauses[key]}
                onChange={(e) => {
                  setSaved(false);
                  setFullnessClauses((prev) => ({ ...prev, [key]: e.target.value }));
                }}
                style={{ flex: 1 }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={LBL}>Hang method</label>
            <textarea
              className="pk-input"
              rows={2}
              value={hang}
              onChange={(e) => {
                setSaved(false);
                setHang(e.target.value);
              }}
              style={{ resize: "vertical" }}
            />
          </div>
          <div>
            <label style={LBL}>Default color</label>
            <input
              className="pk-input"
              value={defaultColor}
              onChange={(e) => {
                setSaved(false);
                setDefaultColor(e.target.value);
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="pk-btn-accent" disabled={pending} onClick={save}>
            {pending ? "Saving…" : "Save"}
          </button>
          {saved && <span style={SAVED}>Saved</span>}
          {err && <span style={ERR}>{err}</span>}
        </div>
      </div>
    </div>
  );
}

export function RestoreStarterTemplatesButton() {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setErr("");
      setMsg("");
      const res = await seedTemplatesAction();
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(res.made > 0 ? `Added ${res.made} formula${res.made === 1 ? "" : "s"}.` : "Everything was already there.");
      router.refresh();
    });

  return (
    <div>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={run}>
        {pending ? "Restoring…" : "Restore starter templates"}
      </button>
      {msg && <span style={{ marginLeft: 8, fontSize: 12, color: "#1f7a52" }}>{msg}</span>}
      {err && <span style={{ marginLeft: 8, fontSize: 12, color: "#b4543a" }}>{err}</span>}
    </div>
  );
}
