"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { REWARD_LEVEL_LABEL, THRESHOLD_LEVELS, type PurchasePerk, type ThresholdLevel } from "@/lib/rewards/program";
import { purchasePerkDraftErrors, type PurchasePerkDraft } from "@/lib/rewards/purchase-perks";
import { savePurchasePerksAction } from "./actions";

/**
 * Settings → Rewards → Perks → Purchase perks (#282 perks+points, Jeff
 * 2026-10-01): standing benefits on every purchase at a level, grouped by
 * tier — add / edit / remove / reorder within a tier, one Save for all
 * tiers. New rows carry a temporary `new:<n>` id; the server mints the real
 * one and keeps removed ones as tombstones. A customer gets every active
 * purchase perk at their earned level and below. Informational in v1 —
 * nothing here changes a price.
 */

type Row = PurchasePerkDraft & { key: string; level: ThresholdLevel };

function rowsOf(list: PurchasePerk[]): Row[] {
  return list
    .filter((p) => !p.removed)
    .map((p) => ({ key: p.id, id: p.id, level: p.level, name: p.name, description: p.description, active: p.active }));
}

/** Rows in save order: grouped by tier, list order within a tier. */
function ordered(rows: Row[]): Row[] {
  return THRESHOLD_LEVELS.flatMap((l) => rows.filter((r) => r.level === l));
}

const strip = (rows: Row[]): PurchasePerkDraft[] =>
  ordered(rows).map((r) => ({ id: r.id, level: r.level, name: r.name, description: r.description, active: r.active }));

const field: CSSProperties = {
  fontSize: 12.5,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "7px 9px",
  background: "#fff",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const tiny: CSSProperties = { fontSize: 11.5, padding: "4px 9px" };
const tierHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "9px 18px 7px",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#8c919c",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  background: "#fafbfc",
  borderTop: "1px solid #f0f1f4",
  borderBottom: "1px solid #f0f1f4",
};

let seq = 0;

export function PurchasePerksEditor({ purchasePerks }: { purchasePerks: PurchasePerk[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Row[]>(() => rowsOf(purchasePerks));
  const [rows, setRows] = useState<Row[]>(() => rowsOf(purchasePerks));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(strip(rows)) !== JSON.stringify(strip(saved));

  const touch = () => {
    setJustSaved(false);
    setError(null);
  };
  const patch = (key: string, p: Partial<Row>) => {
    touch();
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)));
  };
  /** Swap a row with its neighbour in the same tier. */
  const move = (key: string, d: -1 | 1) => {
    touch();
    setRows((cur) => {
      const list = ordered(cur);
      const i = list.findIndex((r) => r.key === key);
      const j = i + d;
      if (i < 0 || j < 0 || j >= list.length || list[j].level !== list[i].level) return cur;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (key: string) => {
    touch();
    setRows((cur) => cur.filter((r) => r.key !== key));
  };
  const add = (level: ThresholdLevel) => {
    touch();
    seq += 1;
    const key = `new:${Date.now().toString(36)}${seq}`;
    setRows((cur) => [...ordered(cur), { key, id: key, level, name: "", description: "", active: true }]);
  };

  const onSave = () => {
    const drafts = strip(rows);
    const errs = purchasePerkDraftErrors(drafts);
    if (errs.length) {
      setError(errs.join(" "));
      return;
    }
    startTransition(async () => {
      const res = await savePurchasePerksAction(drafts);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const next = rowsOf(res.program.purchasePerks);
      setSaved(next);
      setRows(next);
      setJustSaved(true);
      router.refresh();
    });
  };

  const list = ordered(rows);
  return (
    <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginTop: 22 }} id="purchase-perks" data-testid="purchase-perks-editor">
      <div style={{ padding: "14px 18px 12px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Purchase perks</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3, lineHeight: 1.5 }}>
          Standing benefits on every purchase at a level — e.g. free freight at Gold. A customer gets every active purchase
          perk at their earned level and below. Staff see them as a banner in the Estimator and the service quote builders;
          the customer sees them in the portal and on their quotes and letters. They don&apos;t change prices — apply them
          by hand.
        </div>
      </div>
      {THRESHOLD_LEVELS.map((level) => {
        const tier = list.filter((r) => r.level === level);
        return (
          <div key={level} data-testid={`purchase-perks-${level}`}>
            <div style={tierHead}>
              <span>
                {REWARD_LEVEL_LABEL[level]} · {tier.length}
              </span>
              <button type="button" className="pk-btn-outline" style={tiny} onClick={() => add(level)}>
                + Add {REWARD_LEVEL_LABEL[level]} perk
              </button>
            </div>
            {tier.length === 0 ? (
              <div style={{ padding: "10px 18px", color: "#aab0bb", fontSize: 12 }}>None.</div>
            ) : (
              tier.map((r, i) => (
                <div
                  key={r.key}
                  data-testid="purchase-perk-row"
                  style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,2fr) auto", gap: 10, alignItems: "center", padding: "10px 18px", borderBottom: "1px solid #f5f6f8", opacity: r.active ? 1 : 0.7 }}
                >
                  <input
                    style={field}
                    value={r.name}
                    maxLength={120}
                    placeholder="e.g. Free freight"
                    aria-label={`${REWARD_LEVEL_LABEL[level]} purchase perk ${i + 1} name`}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                  />
                  <input
                    style={field}
                    value={r.description}
                    maxLength={1000}
                    placeholder="Details the customer sees (optional)"
                    aria-label={`${REWARD_LEVEL_LABEL[level]} purchase perk ${i + 1} description`}
                    onChange={(e) => patch(r.key, { description: e.target.value })}
                  />
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={r.active}
                        aria-label={`${REWARD_LEVEL_LABEL[level]} purchase perk ${i + 1} active`}
                        onChange={(e) => patch(r.key, { active: e.target.checked })}
                      />
                      Active
                    </label>
                    <button type="button" className="pk-btn-outline" style={tiny} disabled={i === 0} onClick={() => move(r.key, -1)} aria-label={`Move ${r.name || "purchase perk"} up`}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="pk-btn-outline"
                      style={tiny}
                      disabled={i === tier.length - 1}
                      onClick={() => move(r.key, 1)}
                      aria-label={`Move ${r.name || "purchase perk"} down`}
                    >
                      ↓
                    </button>
                    <button type="button" className="pk-btn-outline" style={{ ...tiny, color: "#b4543a" }} onClick={() => remove(r.key)}>
                      Remove
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", flexWrap: "wrap", borderTop: "1px solid #f0f1f4" }}>
        <button
          type="button"
          className="pk-btn-accent"
          disabled={!dirty || pending}
          onClick={onSave}
          style={{ opacity: !dirty || pending ? 0.55 : 1 }}
        >
          {pending ? "Saving…" : "Save purchase perks"}
        </button>
        {dirty && !pending && (
          <button
            type="button"
            className="pk-btn-outline"
            onClick={() => {
              touch();
              setRows(saved);
            }}
          >
            Reset
          </button>
        )}
        {justSaved && !dirty && <span style={{ fontSize: 12, color: "#1f7a52" }}>Saved.</span>}
        {error && <span style={{ fontSize: 12, color: "#b4543a" }}>{error}</span>}
      </div>
    </div>
  );
}
