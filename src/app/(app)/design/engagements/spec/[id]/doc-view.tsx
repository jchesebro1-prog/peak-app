"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, PageHeader, Pill } from "@/components/ui";
import { ConfirmButton } from "@/components/confirm-button";
import { useState, useTransition } from "react";
import { removeGeneratedSpecAction, setGeneratedSpecPeakHeaderAction } from "../generated-actions";

/**
 * Saved-spec viewer (D94). The document is rendered server-side into
 * self-contained HTML; this shell adds the print and download affordances.
 *
 * Download writes a .doc file whose body is that same HTML — Word opens it
 * as a fully editable document, which is what an architect actually needs
 * (sections get pasted into a project manual). See DECISIONS.md D94 for why
 * this rather than a binary .docx on day one.
 */
export default function SpecDocView({
  specId,
  engagementId,
  projectName,
  createdBy,
  createdAt,
  sectionCount,
  waived,
  html,
  filename,
  peakHeader,
  peakHeaderDefault,
  canEditHeader,
}: {
  specId: string;
  engagementId: string;
  projectName: string;
  createdBy: string;
  createdAt: number;
  sectionCount: number;
  waived: Array<{ sku: string; desc: string; reason: string }>;
  html: string;
  filename: string;
  /** Grid notes #9 — whether this spec prints the Peak letterhead (its own choice ?? the company default). */
  peakHeader: boolean;
  peakHeaderDefault: boolean;
  /** The toggle saves through a `create`-gated action. */
  canEditHeader: boolean;
}) {
  const router = useRouter();
  const [headerErr, setHeaderErr] = useState("");
  const [headerPending, startHeader] = useTransition();
  const setHeader = (on: boolean) =>
    startHeader(async () => {
      setHeaderErr("");
      try {
        // Matching the company default stores nothing — the spec keeps following it.
        const r = await setGeneratedSpecPeakHeaderAction(specId, on === peakHeaderDefault ? null : on);
        if (!r.ok) setHeaderErr(r.error);
        else router.refresh();
      } catch {
        setHeaderErr("Couldn’t save that — please try again.");
      }
    });
  const BTN: React.CSSProperties = {
    border: "1px solid #dfe2e8",
    background: "#fff",
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#3d424e",
    cursor: "pointer",
    fontFamily: "inherit",
    textDecoration: "none",
  };

  /** Fallback only — Word opens this HTML, but the real .docx below carries
   *  proper styles and outline structure through a paste into a project
   *  manual, which is what architects actually do with these sections. */
  function downloadHtml() {
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        title={projectName}
        sub={`Specification · ${sectionCount} section${sectionCount === 1 ? "" : "s"} · prepared by ${createdBy} on ${new Date(createdAt).toLocaleDateString()}`}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#3d424e", cursor: canEditHeader ? "pointer" : "default" }} title="The Peak letterhead at the top of the first page (default: Settings → Branding)">
              <input type="checkbox" checked={peakHeader} disabled={headerPending || !canEditHeader} onChange={(e) => setHeader(e.target.checked)} />
              Include Peak header
            </label>
            <Link href={`/design/engagements/spec?id=${engagementId}`} style={BTN}>
              ← Generator
            </Link>
            <button style={BTN} onClick={print}>
              Print / PDF
            </button>
            <button style={BTN} onClick={downloadHtml} title="HTML fallback Word can open">
              .doc
            </button>
            <a
              href={`/api/spec/${specId}/docx`}
              style={{ ...BTN, background: "#16181d", borderColor: "#16181d", color: "#fff", display: "inline-block" }}
            >
              Download .docx
            </a>
            <ConfirmButton
              className="pk-btn-danger"
              label="Delete"
              confirmLabel="Confirm delete"
              onConfirm={async () => {
                const r = await removeGeneratedSpecAction(specId, engagementId);
                if (!r.ok) throw new Error(r.error);
                router.push(`/design/engagements/spec?id=${engagementId}`);
              }}
            />
          </div>
        }
      />

      {headerErr && (
        <div role="alert" style={{ fontSize: 12.5, color: "#b4543a" }}>
          {headerErr}
        </div>
      )}

      {waived.length > 0 && (
        <Card>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <Pill color="#8c919c">{waived.length} not specified</Pill>
            <span style={{ fontSize: 12, color: "#8c919c" }}>
              Recorded in the document so the omission is deliberate and visible.
            </span>
          </div>
          {waived.map((w) => (
            <div key={w.sku + w.desc} style={{ fontSize: 12.5, color: "#5b616e", padding: "3px 0" }}>
              {w.sku} {w.desc} — {w.reason}
            </div>
          ))}
        </Card>
      )}

      <Card>
        <iframe
          title="Specification preview"
          srcDoc={html}
          style={{ width: "100%", height: "70vh", border: "1px solid #edeff3", borderRadius: 8, background: "#fff" }}
        />
      </Card>
    </div>
  );
}
