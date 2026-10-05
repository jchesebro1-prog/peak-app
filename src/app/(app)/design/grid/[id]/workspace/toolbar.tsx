"use client";

import Link from "next/link";
import { EquipmentMapLink } from "@/components/design/equipment-map-link";
import { SHORT } from "@/app/(app)/design/quick/engine";
import { cutSheetsUnreadableNote } from "@/lib/curtain-cut-sheets/estimator-curtains";
import type { GridTool } from "@/lib/design/grid-tools";
import DesignIdentity from "../design-identity";
import OptionSwitcher from "../option-switcher";
import { refillableScopes, ScopeRefillDialog } from "../scope-panel";
import type { GridEditor } from "../use-grid-editor";
import Menu from "./menu";
import {
  IconAlignBottom,
  IconAlignCenter,
  IconAlignLeft,
  IconAlignMiddle,
  IconAlignRight,
  IconAlignTop,
  IconCalibrate,
  IconCopy,
  IconCut,
  IconDistributeH,
  IconDistributeV,
  IconDuplicate,
  IconFit,
  IconPan,
  IconPaste,
  IconPlace,
  IconRedo,
  IconSelect,
  IconSpace,
  IconTrash,
  IconUndo,
  IconWire,
  IconZoomIn,
  IconZoomOut,
} from "./icons";

/**
 * The Grid workspace toolbar (#299): one 34px row — the design's name and
 * customer, the tools (one active at a time), Edit and Arrange (later
 * slices wire these; Delete works now), View (zoom, Fit), then Change
 * equipment, Design ▾, Outputs ▾ and the primary Add to quotes. Every control
 * the old header row held lives here, in a menu, or in the sheet tabs.
 */

const SOON = "coming in this release";

const BTN: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "0 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
  textDecoration: "none",
};

const FIELD_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
  margin: "2px 0 6px",
};

function IconButton({
  title,
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  /** The accessible name when it differs from the tooltip. */
  label?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        padding: 0,
        border: "1px solid transparent",
        borderRadius: 6,
        background: active ? "#16181d" : "transparent",
        color: disabled ? "#c3c7cf" : active ? "#fff" : "#3d424e",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** A not-yet-wired Edit / Arrange control: its real name + shortcut, disabled. */
function SoonButton({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <IconButton title={`${name} — ${SOON}`} label={name} disabled>
      {children}
    </IconButton>
  );
}

function Divider() {
  return <span aria-hidden style={{ width: 1, height: 20, background: "#dfe2e8", margin: "0 4px", flex: "0 0 auto" }} />;
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 1, flex: "0 0 auto" }}>
      {children}
    </div>
  );
}

export default function Toolbar({ ed }: { ed: GridEditor }) {
  const {
    router,
    project,
    sheet,
    venues,
    customerOptions,
    canCreate,
    quoteNumbers,
    activeOptionId,
    activeOption,
    optionCounts,
    switchOption,
    linesetDesigns,
    linkLineset,
    linesetBusy,
    buildClientPackage,
    packageBusy,
    packageUrl,
    packageGapCount,
    packageUnreadable,
    armDelete,
    setArmDelete,
    deleteDesign,
    setVenue,
    busy,
    bomEmpty,
    runQuote,
    incompleteQuote,
    setIncompleteQuote,
    tool,
    enterTool,
    armedPartId,
    armedCurtainType,
    selectedPlacement,
    removePlacement,
    zoom,
    zoomIn,
    zoomOut,
    applyZoom,
    fit,
    auto,
    placements,
    refillScope,
    setRefillScope,
    setErr,
  } = ed;

  const id = encodeURIComponent(project.id);
  const opt = encodeURIComponent(activeOptionId);
  const scopes = refillableScopes(project.scopeInputs, auto);
  const pct = Math.round(zoom * 100);

  const toolButton = (t: GridTool, title: string, icon: React.ReactNode, opts?: { disabled?: boolean; active?: boolean }) => (
    <IconButton
      title={title}
      active={opts?.active ?? tool === t}
      disabled={opts?.disabled}
      onClick={() => (t === "place" ? armedPartId && enterTool("place", { partId: armedPartId }) : enterTool(t))}
    >
      {icon}
    </IconButton>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        rowGap: 4,
        minHeight: 34,
        padding: "3px 10px",
        background: "#fff",
        borderBottom: "1px solid #dfe2e8",
      }}
    >
      <Link href="/design/designs" title="Back to The Grid" aria-label="Back to The Grid" style={{ ...BTN, padding: "0 8px" }}>
        ←
      </Link>
      {/* #244 — the title renames in place; the customer can be linked or changed. */}
      <div style={{ flex: "0 1 auto", minWidth: 0, fontSize: 12.5 }}>
        <DesignIdentity
          projectId={project.id}
          name={project.name}
          customer={project.customer}
          customerId={project.customerId}
          customerOptions={customerOptions}
          canEdit={canCreate}
          onError={setErr}
        />
      </div>

      <Divider />
      <Group label="Tools">
        {toolButton("select", "Select (V)", <IconSelect />)}
        {toolButton("place", armedPartId || armedCurtainType ? "Place (P)" : "Place (P) — pick a part in the Library", <IconPlace />, {
          disabled: !armedPartId,
          active: tool === "place" || tool === "curtain",
        })}
        {toolButton("wire", "Wire (W)", <IconWire />, { disabled: !sheet })}
        {toolButton("space", "Space (S)", <IconSpace />, { disabled: !sheet })}
        {toolButton("calibrate", "Calibrate this page", <IconCalibrate />, { disabled: !sheet })}
        {toolButton("pan", "Pan (H, or hold Space)", <IconPan />, { disabled: !sheet })}
      </Group>

      <Divider />
      <Group label="Edit">
        <SoonButton name="Undo (⌘Z)">
          <IconUndo />
        </SoonButton>
        <SoonButton name="Redo (⇧⌘Z)">
          <IconRedo />
        </SoonButton>
        <SoonButton name="Cut (⌘X)">
          <IconCut />
        </SoonButton>
        <SoonButton name="Copy (⌘C)">
          <IconCopy />
        </SoonButton>
        <SoonButton name="Paste (⌘V)">
          <IconPaste />
        </SoonButton>
        <SoonButton name="Duplicate (⌘D)">
          <IconDuplicate />
        </SoonButton>
        <IconButton
          title={selectedPlacement ? "Delete (Del)" : "Delete (Del) — select a device first"}
          disabled={!selectedPlacement || busy}
          onClick={() => selectedPlacement && removePlacement(selectedPlacement.id)}
        >
          <IconTrash />
        </IconButton>
      </Group>

      <Divider />
      <Group label="Arrange">
        {(
          [
            ["Align left", IconAlignLeft],
            ["Align center", IconAlignCenter],
            ["Align right", IconAlignRight],
            ["Align top", IconAlignTop],
            ["Align middle", IconAlignMiddle],
            ["Align bottom", IconAlignBottom],
            ["Distribute horizontally", IconDistributeH],
            ["Distribute vertically", IconDistributeV],
          ] as const
        ).map(([name, I]) => (
          <SoonButton key={name} name={name}>
            <I />
          </SoonButton>
        ))}
      </Group>

      <Divider />
      <Group label="View">
        <IconButton title="Zoom out" onClick={zoomOut}>
          <IconZoomOut />
        </IconButton>
        <input
          key={pct}
          defaultValue={`${pct}%`}
          aria-label="Zoom percent"
          title="Zoom — type a percent and press Enter"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = parseFloat(e.currentTarget.value);
              if (Number.isFinite(n) && n > 0) applyZoom(n / 100);
              else e.currentTarget.value = `${pct}%`;
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.currentTarget.value = `${pct}%`;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            e.currentTarget.value = `${pct}%`;
          }}
          style={{
            width: 52,
            height: 24,
            border: "1px solid #dfe2e8",
            borderRadius: 6,
            fontSize: 12,
            fontFamily: "inherit",
            textAlign: "center",
            color: "#3d424e",
          }}
        />
        <IconButton title="Zoom in" onClick={zoomIn}>
          <IconZoomIn />
        </IconButton>
        <IconButton title="Fit sheet" disabled={!sheet} onClick={fit}>
          <IconFit />
        </IconButton>
      </Group>

      {/* One non-wrapping unit, pushed to the right: the toolbar only wraps
          between whole groups, and only when the window is genuinely narrow. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto", flexWrap: "nowrap", marginLeft: "auto" }}>
      {/* Change equipment (#211) — the Scope panel's dialog, Auto scopes only. */}
      {scopes.length === 1 && (
        <button type="button" style={BTN} onClick={() => setRefillScope(scopes[0])} title={`Re-fill ${SHORT[scopes[0]]} with different equipment`}>
          Change equipment…
        </button>
      )}
      {scopes.length > 1 && (
        <Menu
          label="Change equipment"
          title="Re-fill one Auto scope with different equipment"
          align="right"
          items={scopes.map((k) => ({ label: `${SHORT[k]}…`, onSelect: () => setRefillScope(k) }))}
        />
      )}

      <Menu label={`Design · ${activeOption.name}`} title="Options and venue" align="right" width={380}>
        <div style={FIELD_LABEL}>Options</div>
        <OptionSwitcher
          projectId={project.id}
          options={project.options}
          activeId={activeOptionId}
          counts={optionCounts}
          busy={busy}
          onSwitch={switchOption}
          onChanged={() => router.refresh()}
          onError={(m) => setErr(m)}
        />
        {venues.length > 0 && (
          <>
            <div style={{ ...FIELD_LABEL, marginTop: 12 }}>Venue</div>
            <select
              value={project.siteId || ""}
              onChange={(e) => setVenue(e.target.value)}
              disabled={busy}
              title="Venue — stamped onto the quote"
              style={{ ...BTN, fontWeight: 500, width: "100%" }}
            >
              <option value="">No venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </>
        )}
      </Menu>

      <Menu
        label="Outputs"
        title="Riser, schedule, drawing set, lineset, client package"
        onOpenChange={(open) => {
          if (!open) setArmDelete(false);
        }}
        align="right"
        width={300}
        items={[
          { label: "Riser →", href: `/design/grid/${id}/riser?option=${opt}` },
          { label: "Schedule →", href: `/design/grid/${id}/schedule?option=${opt}` },
          { label: "Drawing set →", href: `/design/grid/${id}/set?option=${opt}` },
          ...(project.linesetDesignId ? [{ label: "Linesets →", href: `/design/grid/${id}/lineset` }] : []),
          // Same links the BOM panel shows under the quote button (#299).
          ...(activeOption.quoteId
            ? [
                { label: "View in Quotes →", href: "/quotes" },
                {
                  label: "Spec from this design →",
                  href: `/design/specs/new?grid=${encodeURIComponent(project.id)}&quote=${encodeURIComponent(activeOption.quoteId)}`,
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

      {packageUrl && (
        <a href={packageUrl} style={{ ...BTN, color: "#1f7a52" }} title="The client package you just built">
          Download package
        </a>
      )}

      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d", opacity: busy || bomEmpty ? 0.55 : 1 }}
          disabled={busy || bomEmpty}
          onClick={() => runQuote(false)}
          title={bomEmpty ? "Place something first — the BOM is empty" : "Create or update this option's draft quote"}
        >
          {activeOption.quoteId ? `Update quote ${quoteNumbers[activeOption.quoteId] ?? activeOption.quoteId}` : "Add to quotes"}
        </button>
        {/* D322 — the same confirm the BOM card shows, where this click can see it. */}
        {incompleteQuote && (
          <div
            role="alertdialog"
            data-no-nudge
            aria-label="Quote an incomplete design?"
            style={{
              position: "absolute",
              top: "calc(100% + 6px)",
              right: 0,
              zIndex: 60,
              width: 300,
              background: "#fbf0ea",
              border: "1px solid #f0d6cd",
              borderRadius: 9,
              padding: "9px 11px",
              fontSize: 11.5,
              color: "#a0442b",
              lineHeight: 1.45,
              boxShadow: "0 10px 28px rgba(0,0,0,.14)",
            }}
          >
            <div>{incompleteQuote}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ ...BTN, height: 26, fontSize: 11.5 }} disabled={busy} onClick={() => runQuote(true)}>
                Quote anyway
              </button>
              <button type="button" style={{ ...BTN, height: 26, fontSize: 11.5 }} onClick={() => setIncompleteQuote(null)}>
                Cancel
              </button>
              <EquipmentMapLink style={{ fontWeight: 600, color: "#a0442b" }} fallback="Ask an admin to map them in the Equipment map.">
                Equipment map →
              </EquipmentMapLink>
            </div>
          </div>
        )}
      </div>
      </div>

      {refillScope && auto && project.scopeInputs && (
        <ScopeRefillDialog
          projectId={project.id}
          optionId={activeOptionId}
          scope={refillScope}
          scopeInputs={project.scopeInputs}
          auto={auto}
          placements={placements}
          onClose={() => setRefillScope(null)}
          onChanged={() => {
            ed.noteAction(`Changed ${SHORT[refillScope]} equipment`);
            router.refresh();
          }}
          onError={(m) => setErr(m)}
        />
      )}
    </div>
  );
}
