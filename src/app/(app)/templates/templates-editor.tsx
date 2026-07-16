"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  renderTemplate,
  type TemplateDef,
  type TemplateGroup,
  type TemplateOverrides,
} from "@/lib/templates";
import {
  saveTemplateAction,
  resetTemplateAction,
  importTemplatesAction,
} from "./actions";

type Meta = Record<string, { by: string; at: number }>;

const GROUP_ORDER: TemplateGroup[] = [
  "Proposal letters",
  "Renewal emails",
  "Reports",
];

/** Current values for every field of every template (override-or-default). */
function buildDraft(
  templates: TemplateDef[],
  overrides: TemplateOverrides
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const t of templates) {
    out[t.id] = {};
    for (const f of t.fields) {
      const ov = overrides[t.id]?.[f.id];
      out[t.id][f.id] = typeof ov === "string" ? ov : f.default;
    }
  }
  return out;
}

function fmtWhen(at: number): string {
  try {
    return new Date(at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function TemplatesEditor({
  templates,
  overrides,
  meta,
  canEdit,
}: {
  templates: TemplateDef[];
  overrides: TemplateOverrides;
  meta: Meta;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selId, setSelId] = useState(templates[0]?.id || "");
  const [draft, setDraft] = useState(() => buildDraft(templates, overrides));
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );

  const sel = templates.find((t) => t.id === selId) || templates[0];

  // Which templates differ from the saved state (unsaved edits) — for the dot.
  const dirty = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) {
      for (const f of t.fields) {
        const saved = overrides[t.id]?.[f.id];
        const savedVal = typeof saved === "string" ? saved : f.default;
        if ((draft[t.id]?.[f.id] ?? f.default) !== savedVal) {
          set.add(t.id);
          break;
        }
      }
    }
    return set;
  }, [draft, overrides, templates]);

  const grouped = useMemo(() => {
    const m = new Map<TemplateGroup, TemplateDef[]>();
    for (const g of GROUP_ORDER) m.set(g, []);
    for (const t of templates) m.get(t.group)?.push(t);
    return m;
  }, [templates]);

  function setField(fieldId: string, value: string) {
    setDraft((d) => ({ ...d, [sel.id]: { ...d[sel.id], [fieldId]: value } }));
    setBanner(null);
  }

  function save() {
    startTransition(async () => {
      const res = await saveTemplateAction(sel.id, draft[sel.id]);
      if (res.ok) {
        setBanner({ kind: "ok", msg: "Saved. Generated documents will use this wording." });
        router.refresh();
      } else {
        setBanner({ kind: "err", msg: res.error });
      }
    });
  }

  function resetTemplate() {
    startTransition(async () => {
      const res = await resetTemplateAction(sel.id);
      if (res.ok) {
        setDraft((d) => ({
          ...d,
          [sel.id]: Object.fromEntries(sel.fields.map((f) => [f.id, f.default])),
        }));
        setBanner({ kind: "ok", msg: "Reset to the built-in defaults." });
        router.refresh();
      } else {
        setBanner({ kind: "err", msg: res.error });
      }
    });
  }

  function resetField(fieldId: string) {
    const f = sel.fields.find((x) => x.id === fieldId);
    if (f) setField(fieldId, f.default);
  }

  function downloadJson(obj: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadOne() {
    downloadJson({ [sel.id]: draft[sel.id] }, `peak-template-${sel.id}.json`);
  }

  function downloadAll() {
    const all: Record<string, Record<string, string>> = {};
    for (const t of templates) all[t.id] = draft[t.id];
    downloadJson(all, "peak-templates-all.json");
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result || ""));
      } catch {
        setBanner({ kind: "err", msg: "That file isn't valid JSON." });
        return;
      }
      startTransition(async () => {
        const res = await importTemplatesAction(parsed);
        if (res.ok) {
          setBanner({
            kind: "ok",
            msg: `Uploaded — ${res.count} template${res.count === 1 ? "" : "s"} updated.`,
          });
          router.refresh();
          // Re-seed the local draft from the uploaded values so the editor
          // reflects what was just saved without a full reload.
          const src = parsed as Record<string, Record<string, string>>;
          setDraft((d) => {
            const next = { ...d };
            for (const t of templates) {
              if (src[t.id]) {
                next[t.id] = { ...next[t.id] };
                for (const f of t.fields) {
                  if (typeof src[t.id][f.id] === "string")
                    next[t.id][f.id] = src[t.id][f.id];
                }
              }
            }
            return next;
          });
        } else {
          setBanner({ kind: "err", msg: res.error });
        }
      });
    };
    reader.readAsText(file);
  }

  const selMeta = meta[sel.id];
  const isDirty = dirty.has(sel.id);

  return (
    <div className="tpl-wrap">
      <style>{CSS}</style>

      <div className="tpl-head">
        <div>
          <h1 className="tpl-title">Templates</h1>
          <p className="tpl-sub">
            The wording of every document Peak generates. Edit it here — the
            on-screen letters, the emailed PDFs, and the reports all use these,
            with <code>{"{{merge fields}}"}</code> filled in automatically.
          </p>
        </div>
        <div className="tpl-head-actions">
          <button className="tpl-btn" onClick={downloadAll} disabled={pending}>
            ⭳ Download all
          </button>
          {canEdit && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                onChange={onUpload}
                style={{ display: "none" }}
              />
              <button
                className="tpl-btn"
                onClick={() => fileRef.current?.click()}
                disabled={pending}
              >
                ⭱ Upload
              </button>
            </>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="tpl-note">
          You can view and download templates. Editing is limited to Admins and
          Managers.
        </div>
      )}
      {banner && (
        <div className={`tpl-banner ${banner.kind}`}>{banner.msg}</div>
      )}

      <div className="tpl-body">
        {/* rail */}
        <aside className="tpl-rail">
          {GROUP_ORDER.map((g) => {
            const items = grouped.get(g) || [];
            if (!items.length) return null;
            return (
              <div key={g} className="tpl-railgroup">
                <div className="tpl-railhead">{g}</div>
                {items.map((t) => (
                  <button
                    key={t.id}
                    className={`tpl-railitem${t.id === sel.id ? " on" : ""}`}
                    onClick={() => {
                      setSelId(t.id);
                      setBanner(null);
                    }}
                  >
                    <span>{t.label}</span>
                    {dirty.has(t.id) && <span className="tpl-dot" title="Unsaved changes" />}
                  </button>
                ))}
              </div>
            );
          })}
        </aside>

        {/* editor */}
        <section className="tpl-main">
          <div className="tpl-mainhead">
            <div>
              <h2 className="tpl-h2">{sel.label}</h2>
              <p className="tpl-desc">{sel.description}</p>
            </div>
            <button className="tpl-btn small" onClick={downloadOne} disabled={pending}>
              ⭳ Download
            </button>
          </div>

          {/* merge-field reference */}
          <div className="tpl-merge">
            <div className="tpl-merge-h">Merge fields you can use</div>
            <div className="tpl-chips">
              {sel.placeholders.map((p) => (
                <span key={p.token} className="tpl-chip" title={p.desc}>
                  {`{{${p.token}}}`}
                </span>
              ))}
            </div>
          </div>

          {/* fields */}
          {sel.fields.map((f) => {
            const val = draft[sel.id]?.[f.id] ?? f.default;
            const changed = val !== f.default;
            const preview = renderTemplate(val, sel.sample);
            return (
              <div key={f.id} className="tpl-field">
                <div className="tpl-field-head">
                  <label className="tpl-label">{f.label}</label>
                  {changed && canEdit && (
                    <button
                      className="tpl-reset"
                      onClick={() => resetField(f.id)}
                      disabled={pending}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                {f.help && <div className="tpl-help">{f.help}</div>}
                {f.multiline ? (
                  <textarea
                    className="tpl-textarea"
                    value={val}
                    onChange={(e) => setField(f.id, e.target.value)}
                    readOnly={!canEdit}
                    rows={Math.min(10, Math.max(2, Math.ceil(val.length / 70)))}
                  />
                ) : (
                  <input
                    className="tpl-input"
                    value={val}
                    onChange={(e) => setField(f.id, e.target.value)}
                    readOnly={!canEdit}
                  />
                )}
                <div className="tpl-preview">
                  <span className="tpl-preview-tag">Preview</span>
                  {preview || <span className="tpl-preview-empty">(empty)</span>}
                </div>
              </div>
            );
          })}

          {/* footer actions */}
          <div className="tpl-foot">
            <div className="tpl-stamp">
              {selMeta
                ? `Last edited by ${selMeta.by} · ${fmtWhen(selMeta.at)}`
                : "Using built-in defaults"}
            </div>
            {canEdit && (
              <div className="tpl-foot-actions">
                <button
                  className="tpl-btn"
                  onClick={resetTemplate}
                  disabled={pending}
                >
                  Reset to defaults
                </button>
                <button
                  className="tpl-btn primary"
                  onClick={save}
                  disabled={pending || !isDirty}
                >
                  {pending ? "Saving…" : "Save changes"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const CSS = `
  .tpl-wrap { max-width: 1180px; }
  .tpl-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 4px; }
  .tpl-title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .tpl-sub { color: #6b7079; font-size: 13.5px; margin-top: 4px; max-width: 640px; line-height: 1.5; }
  .tpl-sub code { background: #f0f1f4; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  .tpl-head-actions { display: flex; gap: 8px; flex-shrink: 0; }
  .tpl-note { margin: 12px 0 0; background: #fff8ec; border: 1px solid #f0e3c6; color: #7a5a1f; border-radius: 8px; padding: 9px 12px; font-size: 13px; }
  .tpl-banner { margin: 12px 0 0; border-radius: 8px; padding: 9px 12px; font-size: 13px; }
  .tpl-banner.ok { background: #eaf7ef; border: 1px solid #bfe6cd; color: #1f7a52; }
  .tpl-banner.err { background: #fdecea; border: 1px solid #f3c6c2; color: #a5352a; }
  .tpl-body { display: grid; grid-template-columns: 230px minmax(0,1fr); gap: 22px; align-items: start; margin-top: 18px; }
  @media (max-width: 900px) { .tpl-body { grid-template-columns: 1fr; } }
  .tpl-railgroup { margin-bottom: 14px; }
  .tpl-railhead { font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #9aa0ab; margin: 0 0 6px 8px; }
  .tpl-railitem { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; background: none; border: none; border-radius: 8px; padding: 8px 10px; font-size: 13.5px; color: #3a3e46; cursor: pointer; }
  .tpl-railitem:hover { background: #f5f6f8; }
  .tpl-railitem.on { background: #f0ecf6; color: #4a2f7a; font-weight: 600; }
  .tpl-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent, #7b3f8a); flex-shrink: 0; }
  .tpl-main { background: #fff; border: 1px solid #ececf0; border-radius: 12px; padding: 20px 22px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  .tpl-mainhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .tpl-h2 { font-size: 17px; font-weight: 700; }
  .tpl-desc { color: #6b7079; font-size: 13px; margin-top: 3px; line-height: 1.5; max-width: 620px; }
  .tpl-merge { background: #fafbfc; border: 1px solid #eef0f3; border-radius: 9px; padding: 10px 12px; margin-bottom: 18px; }
  .tpl-merge-h { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #9aa0ab; margin-bottom: 7px; }
  .tpl-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .tpl-chip { font-family: var(--font-mono, monospace); font-size: 11.5px; background: #eef0f3; color: #4a5560; border-radius: 5px; padding: 2px 7px; cursor: help; }
  .tpl-field { margin-bottom: 20px; }
  .tpl-field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .tpl-label { font-size: 13.5px; font-weight: 600; color: #2a2e36; }
  .tpl-reset { background: none; border: none; color: var(--accent, #7b3f8a); font-size: 12px; cursor: pointer; padding: 0; }
  .tpl-reset:hover { text-decoration: underline; }
  .tpl-help { font-size: 12px; color: #8c919c; margin: 2px 0 6px; }
  .tpl-textarea, .tpl-input { width: 100%; border: 1px solid #dfe2e8; border-radius: 8px; padding: 9px 11px; font-size: 13.5px; font-family: inherit; line-height: 1.5; color: #23262d; resize: vertical; background: #fff; }
  .tpl-textarea:focus, .tpl-input:focus { outline: none; border-color: var(--accent, #7b3f8a); box-shadow: 0 0 0 3px rgba(123,63,138,.12); }
  .tpl-textarea[readonly], .tpl-input[readonly] { background: #f7f8fa; color: #5b616e; }
  .tpl-preview { margin-top: 8px; background: #fbfaff; border: 1px dashed #e2ddef; border-radius: 8px; padding: 9px 11px; font-size: 13px; color: #3a3e46; line-height: 1.55; white-space: pre-wrap; }
  .tpl-preview-tag { display: inline-block; font-size: 10px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: #a99ec4; margin-right: 8px; }
  .tpl-preview-empty { color: #b6bac2; font-style: italic; }
  .tpl-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #eef0f3; padding-top: 16px; margin-top: 4px; }
  .tpl-stamp { font-size: 12.5px; color: #8c919c; }
  .tpl-foot-actions { display: flex; gap: 8px; }
  .tpl-btn { background: #fff; border: 1px solid #dfe2e8; border-radius: 8px; padding: 8px 13px; font-size: 13px; font-weight: 500; color: #3a3e46; cursor: pointer; white-space: nowrap; }
  .tpl-btn:hover:not(:disabled) { background: #f6f7f9; }
  .tpl-btn.small { padding: 6px 11px; font-size: 12.5px; }
  .tpl-btn.primary { background: var(--accent, #7b3f8a); border-color: var(--accent, #7b3f8a); color: #fff; }
  .tpl-btn.primary:hover:not(:disabled) { filter: brightness(1.05); background: var(--accent, #7b3f8a); }
  .tpl-btn:disabled { opacity: 0.5; cursor: default; }
`;
