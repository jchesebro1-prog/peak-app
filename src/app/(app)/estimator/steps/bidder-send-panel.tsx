"use client";

import { useState, type CSSProperties } from "react";
import { BID_SEND_COPY } from "@/lib/parties/bid-send";
import { SEND_UI_COPY } from "@/lib/estimate-email/send-ui";
import { BTN } from "./bidder-row";

const FIELD: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dcdfe5",
  borderRadius: 6,
  padding: "6px 8px",
};
const SMALL: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };

export type BidderEmailDefaults = { subject: string; body: string; gmailConnected: boolean; fromAddress: string };
export type BidderCompose = { subject: string; body: string };

/**
 * #348 2b-ii — the Bidders card's inline email panel (like the Add-bidder block): who it goes to, the sender's
 * Gmail line, one subject + body for every targeted bidder (`{link}` becomes each bidder's own link), and the
 * revised-subject hint when a targeted bidder missed an addendum. Emits the composed fields; the card walks.
 */
export function BidderSendPanel({
  names,
  revisedSubject,
  defaults,
  loadError,
  disabled,
  onSend,
  onCancel,
}: {
  names: string[];
  /** The first targeted row's revised subject ("" when none missed an addendum). */
  revisedSubject: string;
  /** null while loading. */
  defaults: BidderEmailDefaults | null;
  loadError: string | null;
  disabled: boolean;
  onSend: (c: BidderCompose) => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "grid", gap: 8, border: "1px solid #ececf0", borderRadius: 9, padding: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>{BID_SEND_COPY.composeTitle}</div>
      <div style={SMALL}>{BID_SEND_COPY.recipients(names)}</div>
      {loadError && (
        <div role="alert" style={{ ...SMALL, color: "#8a2f22" }}>
          {loadError}
        </div>
      )}
      {!defaults && !loadError && <div style={SMALL}>{SEND_UI_COPY.loading}</div>}
      {defaults && (
        // Keyed by the loaded defaults so the fields start from them (and only them).
        <ComposeFields key={`${defaults.subject}\n${defaults.body}`} defaults={defaults} revisedSubject={revisedSubject} count={names.length} disabled={disabled} onSend={onSend} onCancel={onCancel} />
      )}
      {!defaults && (
        <div>
          <button type="button" onClick={onCancel} style={BTN}>
            {BID_SEND_COPY.cancel}
          </button>
        </div>
      )}
    </div>
  );
}

function ComposeFields({
  defaults,
  revisedSubject,
  count,
  disabled,
  onSend,
  onCancel,
}: {
  defaults: BidderEmailDefaults;
  revisedSubject: string;
  count: number;
  disabled: boolean;
  onSend: (c: BidderCompose) => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);
  const off = disabled || count === 0;
  return (
    <>
      <div style={SMALL}>{defaults.gmailConnected ? SEND_UI_COPY.from(defaults.fromAddress) : SEND_UI_COPY.gmailOff}</div>
      <input type="text" aria-label="Bidder email subject" value={subject} disabled={disabled} onChange={(e) => setSubject(e.target.value)} style={FIELD} />
      <textarea
        aria-label="Bidder email message"
        value={body}
        disabled={disabled}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        style={{ ...FIELD, resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={SMALL}>{BID_SEND_COPY.linkHint}</div>
      {revisedSubject && <div style={{ ...SMALL, color: "#9a6a00" }}>{BID_SEND_COPY.revisedHint(revisedSubject)}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={off}
          onClick={() => onSend({ subject, body })}
          style={{ ...BTN, background: "var(--accent)", color: "#fff", opacity: off ? 0.55 : 1, cursor: off ? "not-allowed" : "pointer" }}
        >
          {BID_SEND_COPY.sendN(count)}
        </button>
        <button type="button" disabled={disabled} onClick={onCancel} style={BTN}>
          {BID_SEND_COPY.cancel}
        </button>
      </div>
    </>
  );
}
