"use client";

import type { CSSProperties } from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimLeadAction, snoozeLeadAction } from "./actions";
import { OwnerDot } from "./avatar";
import type { WorklistRowVM } from "./types";

const chipBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#5b616e",
  background: "#f1f2f5",
  border: "1px solid #e4e7ec",
  padding: "6px 10px",
  borderRadius: 7,
  cursor: "pointer",
};

/**
 * 1b — a follow-up worklist row (Leads Explorations.dc.html). The whole row
 * opens the drawer; Claim / Snooze act inline without opening it.
 */
export default function WorklistRow({ row }: { row: WorklistRowVM }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div
      className="lv-hoverrow"
      onClick={() => router.push(row.href)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        padding: "13px 16px",
        borderBottom: "1px solid #f4f5f8",
        cursor: "pointer",
      }}
    >
      <OwnerDot owner={row.owner} title={row.ownerTitle} size={30} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "#16181d",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.org}
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: row.src.ink,
              background: row.src.soft,
              border: `1px solid ${row.src.bd}`,
              padding: "1px 7px",
              borderRadius: 20,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {row.src.label}
          </span>
          <span
            style={{
              display: "inline-block",
              fontSize: 9.5,
              fontWeight: 600,
              color: row.stage.ink,
              background: row.stage.soft,
              border: `1px solid ${row.stage.bd}`,
              padding: "2px 8px",
              borderRadius: 20,
              whiteSpace: "nowrap",
            }}
          >
            {row.stage.label}
          </span>
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "#8c919c",
            marginTop: 3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {row.sub}
        </div>
      </div>
      <span
        style={{
          display: "inline-block",
          fontSize: 10,
          fontWeight: 600,
          color: row.reason.ink,
          background: row.reason.soft,
          border: `1px solid ${row.reason.bd}`,
          padding: "2px 8px",
          borderRadius: 20,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {row.reason.label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: "#3a3f4a",
          flexShrink: 0,
          width: 64,
          textAlign: "right",
        }}
      >
        {row.valueLabel}
      </span>
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {row.canClaim && (
          <button onClick={() => run(() => claimLeadAction(row.id))} disabled={isPending} style={chipBtn}>
            Claim
          </button>
        )}
        <button onClick={() => run(() => snoozeLeadAction(row.id))} disabled={isPending} style={chipBtn}>
          Snooze
        </button>
      </div>
    </div>
  );
}
