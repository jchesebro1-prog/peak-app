import type { CSSProperties } from "react";
import { REWARD_LEVEL_LABEL, type Perk } from "@/lib/rewards/program";
import { PERK_FREQUENCY_LABEL, type PerkStatus, type PerkUse } from "@/lib/rewards/perks";
import { yearAwareDate } from "@/lib/format";
import { LevelBadge } from "@/components/rewards/rewards-ui";
import { MarkPerkUsed, UndoPerkUse, type PerkQuoteOption } from "@/components/rewards/perk-actions";

/**
 * Company record → Rewards card → Perks (#282 phase 4, spec §6): every
 * active perk with its availability for this company (Mark used when
 * available; "Unlocks at Gold", "Used …" or "Next available …" when not)
 * and the perk-use history (Undo for admins). Server component.
 */

const head: CSSProperties = {
  padding: "9px 18px 7px",
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  background: "#fafbfc",
  borderTop: "1px solid #f0f1f4",
  borderBottom: "1px solid #f0f1f4",
};
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: "1px solid #f5f6f8" };

function blockText(s: PerkStatus): string {
  if (s.block === "level") return `Unlocks at ${REWARD_LEVEL_LABEL[s.perk.level]}`;
  if (s.block === "used") return s.lastUsedAt ? `Used ${yearAwareDate(s.lastUsedAt)}` : "Used";
  if (s.block === "cooldown") return s.nextAt ? `Next available ${yearAwareDate(s.nextAt)}` : "Used this year";
  return "Off";
}

export function PerksSection({
  companyId,
  statuses,
  uses,
  allPerks,
  quotes,
  quoteRefs,
  canMark,
  canUndo,
}: {
  companyId: string;
  statuses: PerkStatus[];
  uses: PerkUse[];
  /** Every stored perk, tombstones included — names for past uses. */
  allPerks: Perk[];
  quotes: PerkQuoteOption[];
  quoteRefs?: Record<string, string>;
  canMark: boolean;
  canUndo: boolean;
}) {
  const shown = statuses.filter((s) => s.perk.active);
  const available = shown.filter((s) => s.available).length;
  const nameOf = (id?: string) => allPerks.find((p) => p.id === id)?.name ?? id ?? "Perk";
  return (
    <div data-testid="rewards-perks">
      <div style={head}>
        Perks · {available} available{shown.length > available ? ` of ${shown.length}` : ""}
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: "16px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No perks set up — an admin adds them in Settings → Rewards.
        </div>
      ) : (
        shown.map((s) => (
          <div key={s.perk.id} data-testid="perk-status" data-available={s.available ? "1" : "0"} style={row}>
            <span style={{ flex: 1, minWidth: 0, opacity: s.available ? 1 : 0.72 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.perk.name}</span>
                <LevelBadge level={s.perk.level} />
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>{PERK_FREQUENCY_LABEL[s.perk.frequency]}</span>
              </span>
              {s.perk.description && (
                <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.45 }}>{s.perk.description}</span>
              )}
            </span>
            {s.available ? (
              <MarkPerkUsed
                companyId={companyId}
                perkId={s.perk.id}
                perkName={s.perk.name}
                quotes={quotes}
                disabled={!canMark}
                disabledReason="Needs create permission"
              />
            ) : (
              <span style={{ fontSize: 12, color: "#8c919c", whiteSpace: "nowrap" }}>{blockText(s)}</span>
            )}
          </div>
        ))
      )}
      {uses.length > 0 && (
        <>
          <div style={head}>Perk history · {uses.length}</div>
          {uses.map((u) => (
            <div key={u.entry.id} data-testid="perk-use" style={row}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, textDecoration: u.undone ? "line-through" : "none", color: u.undone ? "#9aa0ab" : "inherit" }}>
                  {nameOf(u.entry.perkId)}
                  {u.entry.quoteId ? ` · ${quoteRefs?.[u.entry.quoteId] || u.entry.quoteId}` : ""}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                  {yearAwareDate(u.entry.at)}
                  {u.entry.by ? ` · ${u.entry.by}` : ""}
                  {u.entry.note ? ` · ${u.entry.note}` : ""}
                  {u.undone ? ` · undone ${yearAwareDate(u.undone.at)}${u.undone.by ? ` by ${u.undone.by}` : ""}` : ""}
                </span>
              </span>
              {!u.undone && canUndo && <UndoPerkUse companyId={companyId} useId={u.entry.id} perkName={nameOf(u.entry.perkId)} />}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
