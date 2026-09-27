"use client";

/**
 * #96 §2 / #123 / #124 / #125 / #214 — the reader's link sidebar, now a
 * SUMMARY of what the thread is linked to, with "Edit links" opening the
 * Link popup (link-popup.tsx) where every editor lives. Top to bottom:
 *   1. Edit links   — opens the popup on the identity message
 *   2. Work         — WorkLinkCard in summary mode (chip, ×, + New quote)
 *   3. Customer     — linked card / one-click suggested + ambiguous cards /
 *                     "Not linked" (the pickers moved into the popup)
 *   4. People       — (#214) chips for every linked person, primary first
 *   5. Venue        — the linked venue, read-only
 *   6. Linking from — which message's addresses drive linking, read-only
 *
 * Display + server-action calls on a server-built ReaderVM: no fetching, no
 * env, no store imports.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import {
  dismissSuggestionAction,
  linkThreadToCustomerAction,
  releaseDomainAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import ThreadTasksCard from "./thread-tasks-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY } from "./sidebar-styles";

type ActionResult = { ok: boolean; error?: string };

export default function LinkSidebar({
  vm,
  variant,
  onEditLinks,
}: {
  vm: ReaderVM;
  /** pane → 300px column beside the reader; overlay → full-width block
   *  under the reader header (the 540px overlay can't fit a column) */
  variant: "pane" | "overlay";
  /** #214 — opens the Link popup */
  onEditLinks: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  // #125 — the party this thread links from: the picked message's address,
  // else the thread contact. vm.senderDomain already follows the same rule.
  const senderEmail = vm.identity?.email || vm.contactEmail;
  const identityMsg = vm.identityMessageId
    ? vm.messages.find((m) => m.id === vm.identityMessageId) || null
    : null;
  const venueLabel = vm.siteId
    ? vm.siteOptions.find((o) => o.value === vm.siteId)?.label || "Venue"
    : "";

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      router.refresh();
    });

  const linkTo = (customerId: string, claim: boolean, rememberAddr: boolean) =>
    run(() =>
      linkThreadToCustomerAction(vm.id, customerId, {
        remember: rememberAddr,
        claimDomain: claim,
      })
    );

  const canClaim = !vm.senderIsPublicDomain;
  const domainTag = <span style={MONO}>@{vm.senderDomain}</span>;
  const emailTag = <span style={MONO}>{senderEmail}</span>;

  const rememberRow = (
    <label style={CHECK_ROW}>
      <input
        type="checkbox"
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>Remember {emailTag} on a contact</span>
    </label>
  );

  const asideStyle: React.CSSProperties =
    variant === "pane"
      ? {
          width: 300,
          flexShrink: 0,
          borderLeft: "1px solid #ececf0",
          background: "#fafbfc",
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }
      : {
          flexShrink: 0,
          maxHeight: "42%",
          borderBottom: "1px solid #ececf0",
          background: "#fafbfc",
          overflowY: "auto",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        };

  return (
    <aside
      className="ib-scroll"
      style={{ ...asideStyle, fontFamily: "var(--font-ui)", color: "#16181d" }}
    >
      <button
        type="button"
        onClick={onEditLinks}
        disabled={vm.messages.length === 0}
        style={{ ...PRIMARY, padding: "8px 12px", fontSize: 12.5 }}
      >
        Edit links
      </button>

      <WorkLinkCard vm={vm} mode="summary" />

      {/* ---- linked ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Customer</div>
          <a
            href={`/companies/${encodeURIComponent(vm.customerCard.id)}`}
            style={{ fontSize: 14, fontWeight: 600, color: "#16181d", textDecoration: "none" }}
          >
            {vm.customerCard.name}
          </a>
          <div style={MUTED}>
            {vm.customerCard.tier} tier · {vm.customerCard.openQuotes} open quote
            {vm.customerCard.openQuotes === 1 ? "" : "s"} · {vm.customerCard.openProjects} open
            project{vm.customerCard.openProjects === 1 ? "" : "s"}
          </div>
          {vm.needsAdopt && (
            <div style={{ ...MUTED, marginTop: 8 }}>
              Matched by {emailTag} — not saved on this thread yet.
            </div>
          )}
          {vm.domainClaimedByThisCustomer && !vm.senderIsPublicDomain && (
            <div style={{ ...MUTED, marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span>Emails from {domainTag} link here automatically ·</span>
              <button
                type="button"
                disabled={pending}
                title={`Stop linking @${vm.senderDomain} to ${vm.customerCard.name}`}
                onClick={() => run(() => releaseDomainAction(vm.senderDomain, vm.customerCard!.id))}
                style={{ ...BTN, padding: "1px 6px", fontSize: 11, color: "#8c919c" }}
              >
                Stop
              </button>
            </div>
          )}
          {vm.needsAdopt && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              <button
                style={PRIMARY}
                disabled={pending}
                onClick={() => linkTo(vm.customerCard!.id, false, false)}
              >
                Save link
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- suggested — one click, no picker ---- */}
      {vm.resolution === "suggested" && vm.suggested && (
        <div style={CARD}>
          <div style={H}>Looks like</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.suggested.name}</div>
          <div style={MUTED}>
            {vm.suggested.contactsAtDomain} contact
            {vm.suggested.contactsAtDomain === 1 ? "" : "s"} at {domainTag}
          </div>
          {rememberRow}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={PRIMARY}
              disabled={pending}
              onClick={() => linkTo(vm.suggested!.customerId, false, remember)}
            >
              Link
            </button>
            {canClaim && (
              <button
                style={ACCENT_BTN}
                disabled={pending}
                title={`Always link @${vm.senderDomain} to ${vm.suggested.name}`}
                onClick={() => linkTo(vm.suggested!.customerId, true, remember)}
              >
                Always
              </button>
            )}
            <button
              style={BTN}
              disabled={pending}
              onClick={() => run(() => dismissSuggestionAction(vm.id))}
            >
              Not them
            </button>
          </div>
        </div>
      )}

      {/* ---- ambiguous — one click per candidate ---- */}
      {vm.resolution === "ambiguous" && (
        <div style={CARD}>
          <div style={H}>Which customer?</div>
          <div style={BODY}>
            {domainTag} is shared by {vm.candidates.length} customers.
          </div>
          {vm.candidates.map((c) => (
            <div
              key={c.customerId}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 8 }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </span>
              <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  style={BTN}
                  disabled={pending}
                  title="Link just this thread"
                  onClick={() => linkTo(c.customerId, false, remember)}
                >
                  This thread
                </button>
                {canClaim && (
                  <button
                    style={ACCENT_BTN}
                    disabled={pending}
                    title={`Always link @${vm.senderDomain} to ${c.name}`}
                    onClick={() => linkTo(c.customerId, true, remember)}
                  >
                    Always
                  </button>
                )}
              </span>
            </div>
          ))}
          {rememberRow}
        </div>
      )}

      {/* ---- unknown — the search lives in the popup ---- */}
      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          <div style={BODY}>
            {!senderEmail ? (
              <>No sender address — link this thread to a customer.</>
            ) : canClaim ? (
              <>{domainTag} isn&apos;t linked to a customer yet.</>
            ) : (
              <>Personal address — link this thread to a customer.</>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <button type="button" style={ACCENT_BTN} onClick={onEditLinks} disabled={vm.messages.length === 0}>
              Find a company, venue or person…
            </button>
          </div>
        </div>
      )}

      {/* ---- people (#214) ---- */}
      <div style={CARD}>
        <div style={H}>People</div>
        {vm.linkedPeople.length === 0 ? (
          <div style={MUTED}>No one linked yet.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {vm.linkedPeople.map((p) => (
              <a
                key={p.id}
                href={`/people/${encodeURIComponent(p.id)}`}
                title={p.primary ? "Primary contact on this thread" : undefined}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#3a3f4a",
                  background: p.primary ? "#f4f0e6" : "#f4f5f7",
                  border: "1px solid #e8eaee",
                  borderRadius: 999,
                  padding: "3px 10px",
                  textDecoration: "none",
                }}
              >
                {p.name}
                {p.primary ? " · primary" : ""}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ---- venue (#124) — read-only; changed in the popup ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Venue</div>
          <div style={BODY}>{venueLabel || "No venue"}</div>
          {vm.siteId && (
            <div style={{ ...MUTED, marginTop: 6 }}>Quotes started from this thread carry this venue.</div>
          )}
        </div>
      )}

      {/* ---- linking from (#125) — read-only; the popup's message sets it ---- */}
      {identityMsg && vm.identity && (
        <div style={CARD}>
          <div style={H}>Linking from</div>
          <div style={MUTED}>
            <b>{vm.identity.name || vm.identity.email}</b>, {identityMsg.out ? "out" : "in"},{" "}
            {identityMsg.time}
            {vm.identity.name ? (
              <>
                {" "}· <span style={MONO}>{vm.identity.email}</span>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* #215 — open tasks created from this thread */}
      <ThreadTasksCard tasks={vm.threadTasks} />

      {error && <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </aside>
  );
}
