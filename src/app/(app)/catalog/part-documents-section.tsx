"use client";

import { useState } from "react";
import { dateYear } from "@/lib/format";
import { collapseList } from "@/lib/part-docs/coverage";
import { PART_DOC_KINDS, PART_DOC_KIND_LABEL } from "@/lib/part-docs/types";
import type { PartDocsView } from "@/lib/part-docs/views";
import AlsoCovers from "./documents/also-covers";
import SlotCell, { docHref } from "./documents/slot-cell";

/**
 * The part editor's Documents section (#DOC, spec §3): the two slots (same
 * cell as the Datasheets page), every document linked to the part with its
 * replaced versions, and the computed "Covered by" / "Covers" context from
 * the accessory graph. Any signed-in user (spec §2.4).
 *
 * Lives inside `<form action={upsertPart}>`: every button is type="button"
 * and nothing here has a `name`, so none of it reaches upsertPart.
 */

const H: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };

export default function PartDocumentsSection({ view }: { view: PartDocsView }) {
  const [justUploaded, setJustUploaded] = useState<{ sku: string; documentId: string; fileName: string } | null>(null);
  const [showAllAcc, setShowAllAcc] = useState(false);
  const acc = collapseList(view.accessories);

  return (
    <div>
      <div style={H}>Documents</div>
      {justUploaded && <AlsoCovers {...justUploaded} onDone={() => setJustUploaded(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {PART_DOC_KINDS.map((k) => (
          <div key={k}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>{PART_DOC_KIND_LABEL[k]}</div>
            <SlotCell sku={view.sku} kind={k} view={view.slots[k]} onUploaded={(sku, documentId, fileName) => setJustUploaded({ sku, documentId, fileName })} />
          </div>
        ))}
      </div>

      {!!view.documents.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>This part&apos;s documents</div>
          {view.documents.map((d) => (
            <div key={d.id} style={{ fontSize: 12, marginBottom: 4 }}>
              <a href={docHref(d.id)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{d.title}</a>
              <span style={{ color: "#8c919c" }}>
                {" "}· {PART_DOC_KIND_LABEL[d.kind]} · {d.hasFile ? `${d.source === "upload" ? "uploaded" : d.source} by ${d.uploadedBy} ${dateYear(d.uploadedAt)}` : "link only"}
              </span>
              {d.history.map((h) => (
                <div key={h.index} style={{ marginLeft: 12, fontSize: 11, color: "#8c919c" }}>
                  replaced {dateYear(h.replacedAt)} by {h.replacedBy}:{" "}
                  <a href={`${docHref(d.id)}?history=${h.index}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6b7079" }}>{h.fileName}</a>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!!view.coveredBy.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covered by</div>
          {view.coveredBy.map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <a href={`/catalog?edit=${encodeURIComponent(p.sku)}`} style={{ color: "#16181d", fontWeight: 600 }}>{p.sku}</a> {p.desc}
              <span style={{ color: "#8c919c" }}> · {p.kinds.map((k) => PART_DOC_KIND_LABEL[k].toLowerCase()).join(" + ")}</span>
            </div>
          ))}
        </div>
      )}

      {!!view.accessories.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covers {view.accessories.length} accessor{view.accessories.length === 1 ? "y" : "ies"}</div>
          {(showAllAcc ? view.accessories : acc.shown).map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <b>{p.sku}</b> <span style={{ color: "#6b7079" }}>{p.desc}</span>
            </div>
          ))}
          {acc.more > 0 && !showAllAcc && (
            <button type="button" onClick={() => setShowAllAcc(true)} style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontSize: 11.5, cursor: "pointer" }}>
              +{acc.more} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
