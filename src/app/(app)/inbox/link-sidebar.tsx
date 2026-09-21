"use client";

/**
 * #96 §2 — the reader's link sidebar. One card per resolution state
 * (linked / suggested / ambiguous / unknown), a quick-add card for
 * contacts + venues once a customer is in play, and the reader's existing
 * "+ Link to work" picker passed in as `children` (it lives in
 * thread-reader.tsx so its state stays with the reader).
 *
 * Everything here is display + server-action calls on a server-built
 * ReaderVM: no fetching, no env, no store imports.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { INPUT, type QuickAddValues } from "@/components/entity-quick-add";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { ReaderVM } from "./types";
import {
  dismissSuggestionAction,
  linkThreadToCustomerAction,
  quickAddContactAction,
  quickAddCustomerAction,
  quickAddVenueAction,
} from "./link-actions";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

const CARD: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  padding: "12px 13px",
  background: "#fff",
};
const H: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#aab0bb",
  marginBottom: 8,
};
const MUTED: React.CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.45 };
const BODY: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.5, color: "#3a3f4a" };
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11.5 };
/** matches the reader's ghost action buttons */
const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
};
/** matches the reader's accent-tinted "+ Link to work" button */
const ACCENT_BTN: React.CSSProperties = {
  ...BTN,
  color: ACCENT_INK,
  background: ACCENT_SOFT,
  border: `1px solid ${ACCENT_SOFT}`,
};
const PRIMARY: React.CSSProperties = {
  ...BTN,
  color: "#fff",
  background: "var(--accent)",
  border: "1px solid transparent",
};
const SELECT: React.CSSProperties = { ...INPUT, padding: "8px 10px", fontSize: 12.5, cursor: "pointer" };
const CHECK_ROW: React.CSSProperties = {
  display: "flex",
  gap: 7,
  alignItems: "flex-start",
  fontSize: 12,
  color: "#3a3f4a",
  marginTop: 10,
  lineHeight: 1.4,
  cursor: "pointer",
};

type ActionResult = { ok: boolean; error?: string };

export default function LinkSidebar({
  vm,
  variant,
  children,
}: {
  vm: ReaderVM;
  /** pane → 300px column beside the reader; overlay → full-width block
   *  under the reader header (the 540px overlay can't fit a column) */
  variant: "pane" | "overlay";
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"contact" | "venue" | null>(null);
  // "Wrong customer?" re-pick on the linked card
  const [changing, setChanging] = useState(false);
  // customer picker value on the unknown card ("__new" opens the quick-add)
  const [pickId, setPickId] = useState("");
  const [remember, setRemember] = useState(true);
  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: vm.contactName,
    role: "",
    email: vm.contactEmail,
    phone: "",
  });
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setError(r.error || "Something went wrong.");
        return;
      }
      setAdding(null);
      setChanging(false);
      setPickId("");
      router.refresh();
    });

  const linkTo = (customerId: string, claim: boolean) =>
    run(() => linkThreadToCustomerAction(vm.id, customerId, { remember, claimDomain: claim }));

  // the id a quick-add contact/venue lands on
  const targetCustomerId = vm.customerCard?.id || vm.suggested?.customerId || "";
  // a quick-add form shows the error itself — don't repeat it below
  const quickAddOpen = adding !== null || pickId === "__new";
  const canClaim = !vm.senderIsPublicDomain;
  const domainTag = <span style={MONO}>@{vm.senderDomain}</span>;
  const emailTag = <span style={MONO}>{vm.contactEmail}</span>;

  const rememberRow = (label: React.ReactNode) => (
    <label style={CHECK_ROW}>
      <input
        type="checkbox"
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
        style={{ marginTop: 2 }}
      />
      <span>{label}</span>
    </label>
  );

  const customerPicker = (value: string, onChange: (v: string) => void, withNew: boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={SELECT}>
      <option value="">Pick a customer…</option>
      {vm.customerOptions.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {withNew && <option value="__new">+ New customer…</option>}
    </select>
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
          {vm.customerCard.contactName && (
            <div style={{ ...BODY, marginTop: 8 }}>
              Contact: <b>{vm.customerCard.contactName}</b>
            </div>
          )}
          {vm.needsAdopt && (
            <div style={{ ...MUTED, marginTop: 8 }}>
              Matched by {emailTag} — not saved on this thread yet.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {vm.needsAdopt && (
              <button
                style={PRIMARY}
                disabled={pending}
                onClick={() => linkTo(vm.customerCard!.id, false)}
              >
                Save link
              </button>
            )}
            <button
              style={BTN}
              disabled={pending}
              onClick={() => {
                setChanging((v) => !v);
                setPickId("");
                setError(null);
              }}
            >
              {changing ? "Keep customer" : "Wrong customer?"}
            </button>
          </div>
          {changing && (
            <div style={{ marginTop: 8 }}>
              {customerPicker(
                pickId,
                (v) => {
                  setPickId(v);
                  if (v) linkTo(v, false);
                },
                false
              )}
            </div>
          )}
          {children && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eef0f3" }}>
              <div style={H}>Work</div>
              {children}
            </div>
          )}
        </div>
      )}

      {/* ---- suggested ---- */}
      {vm.resolution === "suggested" && vm.suggested && (
        <div style={CARD}>
          <div style={H}>Looks like</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{vm.suggested.name}</div>
          <div style={MUTED}>
            {vm.suggested.contactsAtDomain} contact
            {vm.suggested.contactsAtDomain === 1 ? "" : "s"} at {domainTag}
          </div>
          {rememberRow(<>Remember {emailTag} on a contact</>)}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={PRIMARY}
              disabled={pending}
              onClick={() => linkTo(vm.suggested!.customerId, false)}
            >
              Link
            </button>
            {canClaim && (
              <button
                style={ACCENT_BTN}
                disabled={pending}
                title={`Always link @${vm.senderDomain} to ${vm.suggested.name}`}
                onClick={() => linkTo(vm.suggested!.customerId, true)}
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

      {/* ---- ambiguous ---- */}
      {vm.resolution === "ambiguous" && (
        <div style={CARD}>
          <div style={H}>Which customer?</div>
          <div style={BODY}>
            {domainTag} is shared by {vm.candidates.length} customers.
          </div>
          {vm.candidates.map((c) => (
            <div
              key={c.customerId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                marginTop: 8,
              }}
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
                  onClick={() => linkTo(c.customerId, false)}
                >
                  This thread
                </button>
                {canClaim && (
                  <button
                    style={ACCENT_BTN}
                    disabled={pending}
                    title={`Always link @${vm.senderDomain} to ${c.name}`}
                    onClick={() => linkTo(c.customerId, true)}
                  >
                    Always
                  </button>
                )}
              </span>
            </div>
          ))}
          {rememberRow(<>Remember {emailTag} on a contact</>)}
        </div>
      )}

      {/* ---- unknown ---- */}
      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          {!vm.contactEmail ? (
            <div style={BODY}>No sender address — link this thread to a customer.</div>
          ) : canClaim ? (
            <div style={BODY}>
              {domainTag} isn&apos;t linked to a customer yet. Link this domain to…
            </div>
          ) : (
            <div style={BODY}>
              Personal address — link this thread to a customer and remember {emailTag} on a
              contact.
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            {customerPicker(
              pickId,
              (v) => {
                setPickId(v);
                setError(null);
              },
              true
            )}
          </div>
          {pickId && pickId !== "__new" && (
            <>
              {vm.contactEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
              <button
                style={{ ...PRIMARY, marginTop: 10 }}
                disabled={pending}
                onClick={() => linkTo(pickId, canClaim)}
              >
                {canClaim ? "Link domain + thread" : "Link thread"}
              </button>
            </>
          )}
          {pickId === "__new" && (
            <div style={{ marginTop: 10 }}>
              {vm.contactEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
              <div style={{ marginTop: 8 }}>
                <EntityQuickAdd
                  kind="customer"
                  value={newCustomer}
                  onChange={setNewCustomer}
                  submitting={pending}
                  error={error}
                  onCancel={() => {
                    setPickId("");
                    setError(null);
                  }}
                  onSubmit={() =>
                    run(() =>
                      quickAddCustomerAction({
                        ...newCustomer,
                        senderName: vm.contactName,
                        senderEmail: vm.contactEmail,
                        remember,
                        threadId: vm.id,
                      })
                    )
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- work link on a thread that has no customer (rare: the link
           predates the customer, or the customer was removed) — keeps the
           chip + remove reachable ---- */}
      {vm.resolution !== "linked" && vm.link && children && (
        <div style={CARD}>
          <div style={H}>Work</div>
          {children}
        </div>
      )}

      {/* ---- quick add (once a customer is in play) ---- */}
      {targetCustomerId && (vm.resolution === "linked" || vm.resolution === "suggested") && (
        <div style={CARD}>
          <div style={H}>Quick add</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              style={adding === "contact" ? ACCENT_BTN : BTN}
              disabled={pending}
              onClick={() => {
                setAdding(adding === "contact" ? null : "contact");
                setError(null);
              }}
            >
              + Contact
            </button>
            <button
              style={adding === "venue" ? ACCENT_BTN : BTN}
              disabled={pending}
              onClick={() => {
                setAdding(adding === "venue" ? null : "venue");
                setError(null);
              }}
            >
              + Venue
            </button>
          </div>
          {adding === "contact" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd
                kind="contact"
                value={newContact}
                onChange={setNewContact}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setAdding(null);
                  setError(null);
                }}
                onSubmit={() =>
                  run(() => quickAddContactAction({ customerId: targetCustomerId, ...newContact }))
                }
              />
            </div>
          )}
          {adding === "venue" && (
            <div style={{ marginTop: 10 }}>
              <EntityQuickAdd
                kind="venue"
                value={newVenue}
                onChange={setNewVenue}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setAdding(null);
                  setError(null);
                }}
                onSubmit={() =>
                  run(() => quickAddVenueAction({ customerId: targetCustomerId, ...newVenue }))
                }
              />
            </div>
          )}
        </div>
      )}

      {error && !quickAddOpen && <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>}
    </aside>
  );
}
