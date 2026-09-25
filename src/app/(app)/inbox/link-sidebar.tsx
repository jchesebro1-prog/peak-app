"use client";

/**
 * #96 §2 / #123 / #124 / #125 — the reader's link sidebar, top to bottom:
 *   1. Work         — WorkLinkCard (#123): link chip + picker + "+ New quote"
 *   2. Customer     — one card per resolution state (linked / suggested /
 *                     ambiguous / unknown), unchanged from #96
 *   3. Venue        — (#124) only once linked: the customer's venues + quick-add
 *   4. Linking from — (#125) which message's addresses drive linking
 *   5. Quick add    — contacts + venues once a customer is in play
 *
 * Everything here is display + server-action calls on a server-built
 * ReaderVM: no fetching, no env, no store imports. The sender shown and
 * remembered (senderName/senderEmail) is the picked identity message's
 * address (vm.identity), else the thread contact.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import EntityQuickAdd, { type QuickAddValues } from "@/components/entity-quick-add";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import type { ReaderVM } from "./types";
import {
  dismissSuggestionAction,
  linkThreadToCustomerAction,
  quickAddContactAction,
  releaseDomainAction,
  quickAddCustomerAction,
  quickAddVenueAction,
  setIdentityMessageAction,
  setThreadSiteAction,
} from "./link-actions";
import WorkLinkCard from "./work-link-card";
import { ACCENT_BTN, BODY, BTN, CARD, CHECK_ROW, H, MONO, MUTED, PRIMARY, SELECT } from "./sidebar-styles";

type ActionResult = { ok: boolean; error?: string };

export default function LinkSidebar({
  vm,
  variant,
}: {
  vm: ReaderVM;
  /** pane → 300px column beside the reader; overlay → full-width block
   *  under the reader header (the 540px overlay can't fit a column) */
  variant: "pane" | "overlay";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<"contact" | "venue" | null>(null);
  // Venue card's "+ New venue…" (separate from the quick-add card's + Venue)
  const [venueAdding, setVenueAdding] = useState(false);
  // "Wrong customer?" re-pick on the linked card
  const [changing, setChanging] = useState(false);
  // customer picker value on the unknown card ("__new" opens the quick-add)
  const [pickId, setPickId] = useState("");
  const [remember, setRemember] = useState(true);
  // "on contact" pick for the remembered address — "" = new contact; a
  // value is an existing contact's display name (vm.contactOptions)
  const [contactName, setContactName] = useState("");

  // #125 — the party this thread links from: the picked message's address,
  // else the thread contact. vm.senderDomain already follows the same rule.
  const senderName = vm.identity?.name || vm.contactName;
  const senderEmail = vm.identity?.email || vm.contactEmail;
  const identityMsg = vm.identityMessageId
    ? vm.messages.find((m) => m.id === vm.identityMessageId) || null
    : null;

  const [newCustomer, setNewCustomer] = useState<QuickAddValues["customer"]>({
    name: "",
    type: CUSTOMER_TYPES[0] || "",
  });
  const [newContact, setNewContact] = useState<QuickAddValues["contact"]>({
    name: senderName,
    role: "",
    email: senderEmail,
    phone: "",
  });
  const [newVenue, setNewVenue] = useState<QuickAddValues["venue"]>({
    label: "",
    city: "",
    state: "",
  });

  const run = (fn: () => Promise<ActionResult>, onSuccess?: () => void) =>
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
      setContactName("");
      onSuccess?.();
      router.refresh();
    });

  const linkTo = (customerId: string, claim: boolean, rememberAddr: boolean) =>
    run(() =>
      linkThreadToCustomerAction(vm.id, customerId, {
        remember: rememberAddr,
        claimDomain: claim,
        contactName: rememberAddr && contactName ? contactName : undefined,
      })
    );

  // the id a quick-add contact/venue lands on; in the ambiguous state the
  // user picks which candidate first (quickAddTarget)
  const [quickAddTarget, setQuickAddTarget] = useState("");
  const targetCustomerId =
    vm.customerCard?.id ||
    vm.suggested?.customerId ||
    (vm.resolution === "ambiguous" && vm.candidates.some((c) => c.customerId === quickAddTarget)
      ? quickAddTarget
      : "");
  const canClaim = !vm.senderIsPublicDomain;
  const domainTag = <span style={MONO}>@{vm.senderDomain}</span>;
  const emailTag = <span style={MONO}>{senderEmail}</span>;

  // withPicker=false on the linked card's "Wrong customer?" — its
  // contactOptions belong to the customer being left, not the new one.
  const rememberRow = (label: React.ReactNode, withPicker = true) => (
    <>
      <label style={CHECK_ROW}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>{label}</span>
      </label>
      {withPicker && remember && vm.contactOptions.length > 0 && (
        <label
          style={{
            display: "flex",
            gap: 7,
            alignItems: "center",
            fontSize: 12,
            color: "#8c919c",
            marginTop: 6,
            marginLeft: 20,
          }}
        >
          <span style={{ flexShrink: 0 }}>on contact:</span>
          <select
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            style={{ ...SELECT, padding: "5px 8px", fontSize: 12, minWidth: 0 }}
          >
            <option value="">New contact</option>
            {vm.contactOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );

  const customerPicker = (value: string, onChange: (v: string) => void, withNew: boolean) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={SELECT}>
      <option value="">Pick a customer…</option>
      {vm.customerOptionGroups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
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
      {/* Link-to-work is intentionally first: the primary Inbox action is
          attaching the thread to an existing quote/survey/project, while CRM
          customer resolution remains available below it (#123). */}
      <WorkLinkCard vm={vm} />
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
          {vm.domainClaimedByThisCustomer && !vm.senderIsPublicDomain && (
            <div style={{ ...MUTED, marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span>Emails from {domainTag} link here automatically ·</span>
              <button
                type="button"
                disabled={pending}
                title={`Stop linking @${vm.senderDomain} to ${vm.customerCard.name}`}
                onClick={() => run(() => releaseDomainAction(vm.senderDomain, vm.customerCard!.id))}
                style={{
                  ...BTN,
                  padding: "1px 6px",
                  fontSize: 11,
                  color: "#8c919c",
                }}
              >
                Stop
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {vm.needsAdopt && (
              <button
                style={PRIMARY}
                disabled={pending}
                onClick={() => linkTo(vm.customerCard!.id, false, false)}
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
              {rememberRow(<>Remember {emailTag} on a contact</>, false)}
              <div style={{ marginTop: 8 }}>
                {customerPicker(
                  pickId,
                  (v) => {
                    setPickId(v);
                    if (v) linkTo(v, false, remember);
                  },
                  false
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- venue (#124) — only once a customer is linked ---- */}
      {vm.resolution === "linked" && vm.customerCard && (
        <div style={CARD}>
          <div style={H}>Venue</div>
          <select
            value={venueAdding ? "__new" : vm.siteId || ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              setError(null);
              if (v === "__new") {
                setVenueAdding(true);
                return;
              }
              setVenueAdding(false);
              run(() => setThreadSiteAction(vm.id, v || null));
            }}
            style={SELECT}
          >
            <option value="">No venue</option>
            {vm.siteOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            <option value="__new">+ New venue…</option>
          </select>
          {venueAdding && (
            <div style={{ marginTop: 8 }}>
              <EntityQuickAdd
                kind="venue"
                value={newVenue}
                onChange={setNewVenue}
                submitting={pending}
                error={error}
                onCancel={() => {
                  setVenueAdding(false);
                  setError(null);
                }}
                onSubmit={() =>
                  run(
                    () =>
                      quickAddVenueAction({
                        customerId: vm.customerCard!.id,
                        ...newVenue,
                        threadId: vm.id,
                      }),
                    () => {
                      setVenueAdding(false);
                      setNewVenue({ label: "", city: "", state: "" });
                    }
                  )
                }
              />
            </div>
          )}
          {vm.siteId && !venueAdding && (
            <div style={{ ...MUTED, marginTop: 6 }}>
              Quotes started from this thread carry this venue.
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
          {rememberRow(<>Remember {emailTag} on a contact</>)}
        </div>
      )}

      {/* ---- unknown ---- */}
      {vm.resolution === "unknown" && (
        <div style={CARD}>
          <div style={H}>Not linked</div>
          {!senderEmail ? (
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
              {senderEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  style={PRIMARY}
                  disabled={pending}
                  onClick={() => linkTo(pickId, canClaim, remember)}
                >
                  {canClaim ? "Link domain + thread" : "Link thread"}
                </button>
                {canClaim && (
                  <button
                    style={BTN}
                    disabled={pending}
                    title={`Link this thread without claiming @${vm.senderDomain}`}
                    onClick={() => linkTo(pickId, false, remember)}
                  >
                    Link thread only
                  </button>
                )}
              </div>
            </>
          )}
          {pickId === "__new" && (
            <div style={{ marginTop: 10 }}>
              {senderEmail && rememberRow(<>Remember {emailTag} on a contact</>)}
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
                        senderName,
                        senderEmail,
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

      {/* ---- linking from (#125) — which message's addresses drive linking ---- */}
      {vm.isEmail && vm.messages.length > 0 && (
        <div style={CARD}>
          <div style={H}>Linking from</div>
          <select
            value={vm.identityMessageId || ""}
            disabled={pending}
            onChange={(e) => {
              setError(null);
              run(() => setIdentityMessageAction(vm.id, e.target.value || null));
            }}
            style={SELECT}
          >
            <option value="">Thread contact — {vm.contactName}</option>
            {[...vm.messages].reverse().map((m) => (
              <option key={m.id} value={m.id}>
                {m.author} · {m.out ? "out" : "in"} · {m.time}
              </option>
            ))}
          </select>
          {identityMsg && vm.identity && (
            <div style={{ ...MUTED, marginTop: 6 }}>
              Linking from: <b>{vm.identity.name || vm.identity.email}</b>,{" "}
              {identityMsg.out ? "out" : "in"}, {identityMsg.time}
              {vm.identity.name ? (
                <>
                  {" "}· <span style={MONO}>{vm.identity.email}</span>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ---- work link on a thread that has no customer (rare: the link
           predates the customer, or the customer was removed) — keeps the
           chip + remove reachable ---- */}
      {/* ---- quick add (once a customer is in play; ambiguous picks one first) ---- */}
      {(targetCustomerId || vm.resolution === "ambiguous") &&
        vm.resolution !== "unknown" && (
        <div style={CARD}>
          <div style={H}>Quick add</div>
          {vm.resolution === "ambiguous" && (
            <div style={{ marginBottom: 8 }}>
              <select
                value={quickAddTarget}
                onChange={(e) => {
                  setQuickAddTarget(e.target.value);
                  setAdding(null);
                  setError(null);
                }}
                style={SELECT}
              >
                <option value="">Add to which customer…</option>
                {vm.candidates.map((c) => (
                  <option key={c.customerId} value={c.customerId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              style={adding === "contact" ? ACCENT_BTN : BTN}
              disabled={pending || !targetCustomerId}
              onClick={() => {
                setAdding(adding === "contact" ? null : "contact");
                setError(null);
              }}
            >
              + Contact
            </button>
            <button
              style={adding === "venue" ? ACCENT_BTN : BTN}
              disabled={pending || !targetCustomerId}
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
                  run(
                    () => quickAddContactAction({ customerId: targetCustomerId, ...newContact }),
                    () =>
                      setNewContact({
                        name: senderName,
                        role: "",
                        email: senderEmail,
                        phone: "",
                      })
                  )
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
                  run(
                    () => quickAddVenueAction({ customerId: targetCustomerId, ...newVenue }),
                    () => setNewVenue({ label: "", city: "", state: "" })
                  )
                }
              />
            </div>
          )}
        </div>
      )}

      {/* EntityQuickAdd renders the error inside an open form — don't repeat it */}
      {error && !adding && !venueAdding && pickId !== "__new" && (
        <div style={{ fontSize: 12, color: "#b4543a" }}>{error}</div>
      )}
    </aside>
  );
}
