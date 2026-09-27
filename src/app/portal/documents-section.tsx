import type { CSSProperties } from "react";
import type { PortalDocGroup } from "@/lib/document-rules";
import { formatBytes } from "@/lib/document-files";
import { PortalDocumentUpload } from "./document-upload";

/**
 * Portal Documents card (#218) — server component. `groups` is already
 * scoped by groupForPortal (the session's company; shared files + the
 * customer's own uploads; company-wide, then venue, then category). In the
 * team preview the links go to the team route and upload is off.
 */

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  overflow: "hidden",
  marginBottom: 18,
};

const CARD_HEAD: CSSProperties = {
  padding: "15px 20px 12px",
  borderBottom: "1px solid #f0f1f4",
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};

function fmtDate(ms: number): string {
  return ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function PortalDocumentsSection({
  groups,
  preview,
  customerId,
  venues,
  categories,
  companyName,
}: {
  groups: PortalDocGroup[];
  preview: boolean;
  customerId: string;
  venues: Array<{ id: string; label: string }>;
  categories: Array<{ key: string; label: string }>;
  companyName: string;
}) {
  const count = groups.reduce((n, g) => n + g.categories.reduce((m, c) => m + c.docs.length, 0), 0);
  return (
    <div id="documents" style={CARD}>
      <div style={CARD_HEAD}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Documents</div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>
          {count ? `${count} file${count === 1 ? "" : "s"}` : `files from ${companyName} and files you send us`}
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.venueId ?? "company-wide"} style={{ padding: "12px 20px", borderBottom: "1px solid #f5f6f8" }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{g.venueLabel}</div>
          {g.categories.map((c) => (
            <div key={c.key} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
                {c.label}
              </div>
              {c.docs.map((d) => (
                <div key={d.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "7px 0" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.title}</div>
                    <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                      {[
                        d.fileName,
                        formatBytes(d.size),
                        fmtDate(d.uploadedAt),
                        d.source === "customer" ? "sent by " + (d.uploadedBy || "you") : "from " + companyName,
                      ].join(" · ")}
                    </div>
                  </div>
                  <a
                    href={(preview ? "/api/documents/" : "/portal/documents/") + encodeURIComponent(d.id)}
                    download
                    style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none", whiteSpace: "nowrap" }}
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {groups.length === 0 && (
        <div style={{ padding: "22px 20px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
          No documents yet — anything we share with you, and anything you send us, appears here.
        </div>
      )}
      <PortalDocumentUpload customerId={customerId} venues={venues} categories={categories} disabled={preview} />
    </div>
  );
}
