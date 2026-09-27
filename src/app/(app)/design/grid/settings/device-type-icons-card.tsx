"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GENERIC_ICON_ID, symbolLook, type SymbolContext } from "@/lib/design/grid-icons";
import { DEFAULT_TYPE_ICONS, type DeviceType } from "@/lib/design/device-types";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { saveDeviceTypeIconsAction } from "./actions";

/**
 * "Device type icons" (#226, spec §Screens 3) — the primary icon editor:
 * one row per active device type (~25) instead of one per raw catalog
 * category. Preview colour is what the plan draws for that type (#206
 * colour rules, via its scope). Only types whose icon differs from the
 * shipped default are stored; ↺ returns a row to the default.
 */

const defaultFor = (key: string) => (Object.hasOwn(DEFAULT_TYPE_ICONS, key) ? DEFAULT_TYPE_ICONS[key] : GENERIC_ICON_ID);

export function DeviceTypeIconsCard({ types, ctx }: { types: DeviceType[]; ctx: SymbolContext }) {
  const router = useRouter();
  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of types) if (t.icon && t.icon !== defaultFor(t.key)) out[t.key] = t.icon;
    return out;
  }, [types]);
  const [icons, setIcons] = useState<Record<string, string>>(saved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(icons) !== JSON.stringify(saved);
  const canSave = dirty && !pending;

  const setRow = (key: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setIcons((m) => {
      const next = { ...m };
      if (!iconId || iconId === defaultFor(key)) delete next[key];
      else next[key] = iconId;
      return next;
    });
  };
  const save = () => {
    const payload: Record<string, string | null> = {};
    for (const t of types) payload[t.key] = Object.hasOwn(icons, t.key) ? icons[t.key] : null;
    setError(null);
    startTransition(async () => {
      try {
        await saveDeviceTypeIconsAction(payload);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "visible", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Device type icons</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The glyph The Grid draws for each device type, on the plan, the riser and the legends. A per-category override
            (Advanced, below) or an icon set on a single Grid entry wins.
          </div>
        </div>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
      )}
      {justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}
      <div style={{ padding: "12px 18px 16px" }}>
        {types.map((t) => {
          const custom = Object.hasOwn(icons, t.key);
          const iconId = custom ? icons[t.key] : defaultFor(t.key);
          const color = symbolLook({ deviceType: t.key, gridScope: t.scope }, ctx).color;
          return (
            <div key={t.key} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 30px", gap: 9, alignItems: "center", marginBottom: 7 }}>
              <SymbolIcon iconId={iconId} color={color} size={20} />
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.label}
                <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: "#9aa0ab" }}>{t.scope === "Unscoped" ? "General" : t.scope}</span>
                {custom && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
              </span>
              <IconPicker value={iconId} color={color} label={`Icon for ${t.label}`} onChange={(id) => setRow(t.key, id)} />
              <button
                type="button"
                onClick={() => setRow(t.key, null)}
                disabled={!custom}
                title="Back to the shipped default"
                aria-label={`Reset ${t.label} to its default icon`}
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: custom ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: custom ? "pointer" : "default" }}
              >
                ↺
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
