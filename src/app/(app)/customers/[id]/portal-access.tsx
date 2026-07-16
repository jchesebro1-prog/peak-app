"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortalGrantAction, revokePortalGrantAction } from "../actions";

/**
 * Portal access card (IDEAS #47) — the team side of the customer portal.
 * Each contact gets their OWN link (Jeff's per-person login call); the
 * office copies it into an email until magic-link sending rides the Gmail
 * integration. Revoking kills the link + any signed-in session immediately.
 */

export type GrantVM = {
  id: string;
  name: string;
  email: string;
  path: string;
  createdAt: number;
  revoked: boolean;
  lastSeenAt: number | null;
};

export function PortalAccessCard({
  customerId,
  contacts,
  grants,
}: {
  customerId: string;
  contacts: Array<{ name: string; email: string }>;
  grants: GrantVM[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");

  const activeGrants = grants.filter((g) => !g.revoked);
  const options = contacts.filter((c) => c.email);
  const manual = sel === options.length;

  async function copy(path: string, key: string) {
    try {
      await navigator.clipboard.writeText(window.location.origin + path);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Couldn’t copy — the link is: " + window.location.origin + path);
    }
  }

  function createLink() {
    const who = manual
      ? { name: manualName, email: manualEmail }
      : options[sel] || { name: "", email: "" };
    setError(null);
    startTransition(async () => {
      const res = await createPortalGrantAction({
        customerId,
        name: who.name,
        email: who.email,
      });
      if (!res.ok) {
        setError(res.error || "Couldn’t create the link.");
        return;
      }
      await copy(res.path, "new");
      setManualName("");
      setManualEmail("");
      router.refresh();
    });
  }

  function revoke(grantId: string) {
    setError(null);
    startTransition(async () => {
      await revokePortalGrantAction({ customerId, grantId });
      router.refresh();
    });
  }

  const fmt = (ms: number | null) =>
    ms
      ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "never";

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #ececf0",
        borderRadius: 12,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        padding: "15px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#9aa0ab",
            letterSpacing: ".05em",
            textTransform: "uppercase",
          }}
        >
          Customer portal
        </div>
        <a
          href={`/portal?preview=${encodeURIComponent(customerId)}`}
          target="_blank"
          rel="noopener noreferrer"
          title="Open this customer's portal exactly as they see it"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#5b616e",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "6px 11px",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          👁 Preview portal
        </a>
      </div>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5, marginBottom: 12 }}>
        Personal access links — each person gets their own; copy it into an email. They&#39;ll see
        published quotes, venue compliance, and can request quotes.
      </div>

      {activeGrants.map((g) => (
        <div
          key={g.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 0",
            borderTop: "1px solid #f3f4f7",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{g.name}</div>
            <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 1 }}>
              {g.email} · last visit {fmt(g.lastSeenAt)}
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => copy(g.path, g.id)}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: copied === g.id ? "#1f7a52" : "#5b616e",
              background: copied === g.id ? "#eaf6ef" : "#fff",
              border: "1px solid " + (copied === g.id ? "#cce9da" : "#e4e7ec"),
              borderRadius: 8,
              padding: "7px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {copied === g.id ? "Copied ✓" : "Copy link"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => revoke(g.id)}
            title="Revoke this person's access immediately"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "#b4543a",
              background: "#fff",
              border: "1px solid #e4e7ec",
              borderRadius: 8,
              padding: "7px 10px",
              cursor: "pointer",
            }}
          >
            Revoke
          </button>
        </div>
      ))}
      {activeGrants.length === 0 && (
        <div style={{ fontSize: 12, color: "#9aa0ab", padding: "2px 0 10px" }}>
          No portal access yet.
        </div>
      )}

      {/* create */}
      <div style={{ borderTop: "1px solid #f3f4f7", paddingTop: 12, marginTop: 4 }}>
        <select
          value={sel}
          onChange={(e) => setSel(Number(e.target.value))}
          style={{
            width: "100%",
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "9px 10px",
            background: "#fff",
            cursor: "pointer",
            boxSizing: "border-box",
          }}
        >
          {options.map((c, i) => (
            <option key={c.email} value={i}>
              {c.name + " — " + c.email}
            </option>
          ))}
          <option value={options.length}>Someone else…</option>
        </select>
        {manual && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Name"
              style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", boxSizing: "border-box" }}
            />
            <input
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              placeholder="Email"
              style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", boxSizing: "border-box" }}
            />
          </div>
        )}
        <button
          type="button"
          disabled={pending || (manual && (!manualName.trim() || !manualEmail.trim()))}
          onClick={createLink}
          style={{
            marginTop: 8,
            width: "100%",
            fontFamily: "var(--font-ui)",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#fff",
            background: pending ? "#c8ccd3" : "var(--accent)",
            border: "none",
            borderRadius: 9,
            padding: "10px 12px",
            cursor: pending ? "wait" : "pointer",
          }}
        >
          {copied === "new" ? "Link created & copied ✓" : "Create access link"}
        </button>
        {error && (
          <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 8, lineHeight: 1.5, wordBreak: "break-all" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
