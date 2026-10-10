"use client";

import { cutSheetsUnreadableNote } from "@/lib/curtain-cut-sheets/estimator-curtains";
import type { GridEditor } from "../use-grid-editor";
import { GRID_LINK_COPY, specFromDesignHref } from "@/lib/design/estimate-grid-link";
import Menu from "./menu";
import { BTN, FIELD_LABEL } from "./toolbar-style";

/**
 * The toolbar's Outputs ▾ menu (#299): links to the riser, schedule,
 * drawing set and linesets, the Lineset link, the client package, and the
 * two-step Delete design. Split out of toolbar.tsx unchanged.
 */
export default function OutputsMenu({ ed }: { ed: GridEditor }) {
  const {
    project,
    activeOptionId,
    activeOption,
    linesetDesigns,
    linkLineset,
    linesetBusy,
    buildClientPackage,
    packageBusy,
    packageUrl,
    packageGapCount,
    packageUnreadable,
    canCreate,
    armDelete,
    setArmDelete,
    deleteDesign,
    busy,
  } = ed;
  const id = encodeURIComponent(project.id);
  const opt = encodeURIComponent(activeOptionId);
  return (
    <Menu
      label="Outputs"
      title="Riser, schedule, drawing set, lineset, client package"
      onOpenChange={(open) => {
        if (!open) setArmDelete(false);
      }}
      align="right"
      width={300}
      items={[
        { label: "System riser →", href: `/design/grid/${id}/riser?option=${opt}` },
        { label: "Lighting control riser →", href: `/design/grid/${id}/conduit-riser?option=${opt}` },
        { label: "Schedule →", href: `/design/grid/${id}/schedule?option=${opt}` },
        { label: "Drawing set →", href: `/design/grid/${id}/set?option=${opt}` },
        ...(project.linesetDesignId ? [{ label: "Linesets →", href: `/design/grid/${id}/lineset` }] : []),
        // Same links the BOM panel shows under the quote button (#299).
        ...(activeOption.quoteId
          ? [
              // #314: an estimate-linked design names its estimate instead of the hub.
              ed.estimateLink ? { label: GRID_LINK_COPY.openEstimate, href: ed.estimateLink.href } : { label: "View in Quotes →", href: "/quotes" },
              {
                label: "Spec from this design →",
                href: specFromDesignHref(project.id, activeOption.quoteId, !!ed.estimateLink),
              },
            ]
          : []),
      ]}
    >
      <div style={FIELD_LABEL}>Lineset</div>
      <select
        value={project.linesetDesignId || ""}
        disabled={linesetBusy}
        onChange={(e) => linkLineset(e.target.value)}
        aria-label="Lineset Builder design for this Grid"
        title="Link a saved Lineset Builder design; the schedule derives from its current inputs"
        style={{ ...BTN, fontWeight: 500, width: "100%" }}
      >
        <option value="">No lineset linked</option>
        {linesetDesigns.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>

      <div style={{ ...FIELD_LABEL, marginTop: 12 }}>Client package</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={BTN} disabled={packageBusy || busy} onClick={buildClientPackage} title="Build a ZIP with the specification, datasheets, plan sheets, and rough riser drawings">
          {packageBusy ? "Building…" : packageUrl ? "Rebuild" : "Build client package"}
        </button>
        {packageUrl && (
          <a href={packageUrl} style={{ ...BTN, color: "#1f7a52" }}>
            Download{packageGapCount ? ` · ${packageGapCount} gaps` : ""}
          </a>
        )}
      </div>
      {packageUrl && packageUnreadable.length > 0 && (
        <div
          style={{ fontSize: 11.5, color: "#8a6d1f", marginTop: 6, lineHeight: 1.4 }}
          title={packageUnreadable.map((u) => `${u.where} — ${u.desc}: ${u.reason}`).join("\n")}
        >
          {cutSheetsUnreadableNote(packageUnreadable.length)}
        </div>
      )}

      {canCreate && (
        <div style={{ borderTop: "1px solid #edeff3", marginTop: 12, paddingTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
          {armDelete ? (
            <>
              <button
                type="button"
                style={{ ...BTN, background: "#a0442b", color: "#fff", borderColor: "#a0442b" }}
                disabled={busy}
                onClick={deleteDesign}
              >
                {busy ? "Deleting…" : "Really delete"}
              </button>
              <button type="button" style={BTN} disabled={busy} onClick={() => setArmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              style={{ ...BTN, color: "#a0442b" }}
              disabled={busy}
              onClick={() => setArmDelete(true)}
              title="Deletes this design and its plan sheets"
            >
              Delete design
            </button>
          )}
        </div>
      )}
    </Menu>
  );
}
