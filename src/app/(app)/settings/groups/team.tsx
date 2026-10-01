"use client";

import { useState } from "react";
import { ROLES, ROLE_DESC, ROLE_PERMS, PERM_LABEL, firstName, type Role } from "@/lib/team";
import { addUserAction, setRolesAction, setUserStatusAction, updateMemberAction } from "../actions";
import { inputStyle, labelStyle, type Run } from "./shared";
import type { OfficeVM, UserVM } from "./types";

/**
 * Settings → Team & Access (settings cleanup): Team members + Roles &
 * permissions, and the add/edit team-member modal. Moved verbatim from the
 * old settings-client.tsx Admin section; `?section=admin` now lands here.
 */

const ROLE_COLORS: Record<string, string> = {
  Admin: "#5b4b8a",
  Manager: "#3155a8",
  Estimator: "#5b616e",
  Reviewer: "#1f7a52",
};

export function TeamGroup({
  meId,
  meName,
  users,
  offices,
  run,
}: {
  meId: string;
  meName: string;
  users: UserVM[];
  offices: OfficeVM[];
  run: Run;
}) {
  // modal: null | 'new' | userId
  const [modal, setModal] = useState<string | null>(null);
  // Row-level remove uses a two-step inline confirm — window.confirm() throws
  // silently in this app (D96), and the modal-footer Remove was so buried that
  // ⏻ (deactivate) read as "remove" and rows "never went away" (D127).
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // Removed members are hidden from the list by default (decision C) — this
  // is the escape hatch so an accidental Remove isn't a dead end.
  const [showRemoved, setShowRemoved] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    email: string;
    googleEmail: string;
    roles: string[];
    title: string;
    phone: string;
    mobile: string;
    officeId: string;
    certifications: string;
  }>({
    name: "",
    email: "",
    googleEmail: "",
    roles: ["Estimator"],
    title: "",
    phone: "",
    mobile: "",
    officeId: "",
    certifications: "",
  });

  const openNew = () => {
    setDraft({
      name: "",
      email: "",
      googleEmail: "",
      roles: ["Estimator"],
      title: "",
      phone: "",
      mobile: "",
      officeId: "",
      certifications: "",
    });
    setModal("new");
  };
  const openEdit = (u: UserVM) => {
    setDraft({
      name: u.name,
      email: u.email,
      googleEmail: u.googleEmail || "",
      roles: u.roles.slice(),
      title: u.title,
      phone: u.phone,
      mobile: u.mobile,
      officeId: u.officeId,
      certifications: u.certifications,
    });
    setModal(u.id);
  };
  const toggleDraftRole = (r: string) =>
    setDraft((d) => ({
      ...d,
      roles: d.roles.includes(r)
        ? d.roles.filter((x) => x !== r)
        : [...d.roles, r],
    }));

  const saveModal = () => {
    if (!draft.roles.length) return; // silent no-op, per prototype
    if (modal === "new") {
      if (!draft.name.trim()) return;
      run(() => addUserAction(draft));
    } else if (modal) {
      const id = modal;
      // identity edits ride along with roles (PUNCHLIST #9 — email was
      // uneditable anywhere, and a wrong email means the member can't sign in)
      run(async () => {
        await updateMemberAction(id, {
          name: draft.name,
          email: draft.email,
          googleEmail: draft.googleEmail,
          title: draft.title,
          phone: draft.phone,
          mobile: draft.mobile,
          officeId: draft.officeId,
          certifications: draft.certifications,
        });
        return setRolesAction(id, draft.roles);
      });
    }
    setModal(null);
  };

  const isNew = modal === "new";
  const editingUser = modal && !isNew ? users.find((u) => u.id === modal) : null;
  const canDelete = !!editingUser && editingUser.name !== meName;

  // Removed members are hidden by default (decision C) — showRemoved is the
  // escape hatch so an accidental Remove isn't a dead end.
  const removedCount = users.filter((u) => u.status === "removed").length;
  const visibleUsers = showRemoved ? users : users.filter((u) => u.status !== "removed");

  return (
    <>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 320px",
            gap: 20,
            alignItems: "start",
          }}
          className="st-grid"
        >
        {/* ---- Team + Roles ---- */}
        <section className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "15px 18px",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Team members</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab" }}>
                {visibleUsers.length}
              </span>
              {removedCount > 0 && (
                <button
                  onClick={() => setShowRemoved((s) => !s)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: showRemoved ? "var(--accent)" : "#9aa0ab",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {showRemoved ? "Hide" : "Show"} {removedCount} removed
                </button>
              )}
            </div>
            <button className="pk-btn-accent" onClick={openNew}>
              + Add user
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 175px",
              gap: 12,
              padding: "10px 18px",
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              textTransform: "uppercase",
              letterSpacing: ".05em",
              background: "#fbfbfc",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <span />
            <span>Name</span>
            <span>Roles</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>

          {visibleUsers.map((u) => (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 175px",
                gap: 12,
                padding: "13px 18px",
                alignItems: "center",
                borderBottom: "1px solid #f5f6f8",
                opacity: u.status === "active" ? 1 : 0.55,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: u.color,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {u.initials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13.5,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                  {u.id === meId && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--accent)",
                        background: "var(--accent-soft)",
                        padding: "1px 6px",
                        borderRadius: 5,
                        flexShrink: 0,
                      }}
                    >
                      You
                    </span>
                  )}
                </span>
                <span
                  className="st-email"
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "#aab0bb",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {u.email}
                </span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {u.roles.map((r) => (
                  <RolePill key={r} role={r} />
                ))}
                {u.status !== "active" && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 20,
                      color: u.status === "removed" ? "#b4543a" : "#8c919c",
                      background: u.status === "removed" ? "#fbf0ed" : "#f1f2f5",
                      border: u.status === "removed" ? "1px solid #f0ddd6" : "1px solid #e4e7ec",
                    }}
                  >
                    {u.status === "removed" ? "Removed" : "Archived"}
                  </span>
                )}
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                {confirmRemove === u.id ? (
                  <>
                    <button
                      className="pk-btn-danger"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => {
                        setConfirmRemove(null);
                        run(() => setUserStatusAction(u.id, "removed"));
                      }}
                    >
                      Remove {firstName(u.name)}?
                    </button>
                    <button
                      className="pk-btn-outline"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => setConfirmRemove(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : u.status === "removed" ? (
                  <button
                    className="pk-btn-outline"
                    title="Restore to the active roster"
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => run(() => setUserStatusAction(u.id, "active"))}
                  >
                    ↺ Restore
                  </button>
                ) : (
                  <>
                    <button className="pk-btn-outline" title="Edit roles & contact card" onClick={() => openEdit(u)}>
                      Roles
                    </button>
                    <button
                      className="pk-btn-outline"
                      title={
                        u.status === "active"
                          ? "Deactivate — keeps the row, blocks sign-in"
                          : "Reactivate"
                      }
                      style={{ color: "#8c919c", padding: "6px 9px", fontSize: 13 }}
                      onClick={() =>
                        run(() => setUserStatusAction(u.id, u.status === "active" ? "archived" : "active"))
                      }
                    >
                      {u.status === "active" ? "⏻" : "↺"}
                    </button>
                    {u.id !== meId && (
                      <button
                        className="pk-btn-outline"
                        title="Remove from team"
                        style={{ color: "#b4543a", padding: "6px 9px", fontSize: 13 }}
                        onClick={() => setConfirmRemove(u.id)}
                      >
                        ✕
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </section>

        <section className="pk-card" style={{ padding: "17px 18px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
            Roles & permissions
          </div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 14 }}>
            Permissions are preset by role. A user can hold more than one.
          </div>
          {ROLES.map((r) => (
            <div key={r} style={{ padding: "11px 0", borderTop: "1px solid #f3f4f7" }}>
              <RolePill role={r} />
              <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
                {ROLE_DESC[r as Role]}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                {ROLE_PERMS[r as Role].map((p) => (
                  <span
                    key={p}
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: "#5b616e",
                      background: "#f7f8fa",
                      border: "1px solid #eceef1",
                      padding: "2px 8px",
                      borderRadius: 5,
                    }}
                  >
                    {PERM_LABEL[p]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
        </div>

      {/* ---- Add / edit modal ---- */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
          onClick={() => setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {isNew ? "Add team member" : "Edit team member"}
              </span>
              <button
                onClick={() => setModal(null)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f1f2f5",
                  color: "#5b616e",
                  fontSize: 17,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px" }}>
              <label style={{ ...labelStyle, marginBottom: 6 }}>Full name</label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                placeholder="e.g. Dana Reyes"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoFocus={isNew}
              />
              <label style={{ ...labelStyle, marginBottom: 6 }}>Email (sign-in & roster)</label>
              <input
                style={{
                  ...inputStyle,
                  marginBottom: 14,
                  fontFamily: "var(--font-mono)",
                }}
                placeholder="name@peaksystemsgroup.com"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
              <label style={{ ...labelStyle, marginBottom: 6 }}>
                Google sign-in email (if different)
              </label>
              <input
                style={{
                  ...inputStyle,
                  marginBottom: 16,
                  fontFamily: "var(--font-mono)",
                }}
                placeholder="optional — e.g. their @gmail.com"
                value={draft.googleEmail}
                onChange={(e) => setDraft({ ...draft, googleEmail: e.target.value })}
              />

              {/* Contact card (PUNCHLIST #9, decision A) — feeds outbound
                  service-document signatures: title replaces the roles[0]
                  hack where set, office assignment drives the signature
                  phone (decision D) rather than always offices[0]. */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Title</label>
                  <input
                    style={inputStyle}
                    placeholder="e.g. Senior Estimator"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Office</label>
                  <select
                    style={{ ...inputStyle, cursor: "pointer" }}
                    value={draft.officeId}
                    onChange={(e) => setDraft({ ...draft, officeId: e.target.value })}
                  >
                    <option value="">— unassigned —</option>
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Direct phone</label>
                  <input
                    style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    placeholder="optional"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Mobile</label>
                  <input
                    style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    placeholder="optional"
                    value={draft.mobile}
                    onChange={(e) => setDraft({ ...draft, mobile: e.target.value })}
                  />
                </div>
              </div>
              <label style={{ ...labelStyle, marginBottom: 6 }}>Certifications / license numbers</label>
              <input
                style={{ ...inputStyle, marginBottom: 16 }}
                placeholder="optional — e.g. NETA Level II #12345"
                value={draft.certifications}
                onChange={(e) => setDraft({ ...draft, certifications: e.target.value })}
              />

              <label style={{ ...labelStyle, marginBottom: 6 }}>Roles</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ROLES.map((r) => {
                  const on = draft.roles.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleDraftRole(r)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "11px 13px",
                        borderRadius: 10,
                        background: on ? "var(--accent-soft)" : "#fff",
                        border: on
                          ? "1px solid color-mix(in srgb, var(--accent) 45%, #fff)"
                          : "1px solid #e8eaee",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: on ? "var(--accent)" : "#fff",
                            border: on
                              ? "1.5px solid var(--accent)"
                              : "1.5px solid #d6d9e0",
                            color: on ? "var(--accent-contrast)" : "#fff", // D117: adapts to active accent
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                            {r}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#8c919c",
                              lineHeight: 1.35,
                              marginTop: 1,
                            }}
                          >
                            {ROLE_DESC[r as Role]}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              {canDelete ? (
                <button
                  className="pk-btn-danger"
                  onClick={() => {
                    if (modal && modal !== "new") run(() => setUserStatusAction(modal, "removed"));
                    setModal(null);
                  }}
                >
                  Remove user
                </button>
              ) : (
                <span />
              )}
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setModal(null)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveModal}
                  style={{
                    color: "var(--accent-contrast)", // D117: adapts to active accent
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {isNew ? "Add user" : "Save changes"}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] || "#5b616e";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        color: c,
        background: `color-mix(in srgb, ${c} 11%, #fff)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, #fff)`,
      }}
    >
      {role}
    </span>
  );
}
