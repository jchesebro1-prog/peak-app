"use client";

import Link from "next/link";
import { Card, PageHeader, Pill } from "@/components/ui";

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
  engagementId,
  projectName,
  createdBy,
  createdAt,
  sectionCount,
  waived,
  html,
  filename,
}: {
  engagementId: string;
  projectName: string;
  createdBy: string;
  createdAt: number;
  sectionCount: number;
  waived: Array<{ sku: string; desc: string; reason: string }>;
  html: string;
  filename: string;
}) {
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

  function download() {
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
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/consulting/spec?id=${engagementId}`} style={BTN}>
              ← Generator
            </Link>
            <button style={BTN} onClick={print}>
              Print / PDF
            </button>
            <button style={{ ...BTN, background: "#16181d", borderColor: "#16181d", color: "#fff" }} onClick={download}>
              Download for Word
            </button>
          </div>
        }
      />

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
