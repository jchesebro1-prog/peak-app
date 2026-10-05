"use client";

import Link from "next/link";
import { SHORT } from "@/app/(app)/design/quick/engine";
import { feetLabel, SNAP_SPACINGS_FT } from "@/lib/design/grid-snap";
import type { GridTool } from "@/lib/design/grid-tools";
import DesignIdentity from "../design-identity";
import OptionSwitcher from "../option-switcher";
import { refillableScopes, ScopeRefillDialog } from "../scope-panel";
import type { GridEditor } from "../use-grid-editor";
import Menu from "./menu";
import OutputsMenu from "./outputs-menu";
import QuoteButton from "./quote-button";
import { BTN, FIELD_LABEL } from "./toolbar-style";
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
 * customer, the tools (one active at a time), Edit (Delete works; the rest
 * arrive in later slices), Arrange (align ×6 at 2+ selected, distribute ×2
 * at 3+), View (zoom, Fit), then Change equipment, Design ▾, Outputs ▾
 * (outputs-menu.tsx) and the primary Add to quotes (quote-button.tsx). Every
 * control the old header row held lives here, in a menu, or in the sheet tabs.
 */

const SOON = "coming in this release";

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

/** A not-yet-wired Edit control: its real name + shortcut, disabled. */
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
    activeOptionId,
    activeOption,
    optionCounts,
    switchOption,
    packageUrl,
    setVenue,
    busy,
    tool,
    enterTool,
    armedPartId,
    armedCurtainType,
    selectedPlacements,
    removeSelected,
    alignSelected,
    distributeSelected,
    view,
    setView,
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
    cal,
    snapOn,
    setSnapOn,
    snapFt,
    setSnapFt,
    snap,
  } = ed;

  const scopes = refillableScopes(project.scopeInputs, auto);
  const pct = Math.round(zoom * 100);
  /** Why an Arrange control is off (its tooltip), or null when it works. */
  const arrangeBlocked = (min: 2 | 3): string | null =>
    view === "sheet"
      ? "Switch to Plan view to arrange"
      : selectedPlacements.length < min
        ? `Select ${min} or more devices`
        : busy
          ? "Saving…"
          : null;

  const toolButton = (t: GridTool, title: string, icon: React.ReactNode, opts?: { disabled?: boolean; active?: boolean }) => (
    <IconButton
      title={title}
      active={opts?.active ?? tool === t}
      disabled={opts?.disabled}
      onClick={() => {
        // #299: the tools act on the plan — leave Spreadsheet view first.
        setView("plan");
        if (t === "place") {
          if (armedPartId) enterTool("place", { partId: armedPartId });
        } else enterTool(t);
      }}
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
          title={
            view === "sheet"
              ? "Switch to Plan view to delete"
              : selectedPlacements.length > 1
                ? `Delete ${selectedPlacements.length} (Del)`
                : selectedPlacements.length
                  ? "Delete (Del)"
                  : "Delete (Del) — select a device first"
          }
          label="Delete (Del)"
          disabled={!selectedPlacements.length || busy || view === "sheet"}
          onClick={() => void removeSelected()}
        >
          <IconTrash />
        </IconButton>
      </Group>

      <Divider />
      <Group label="Arrange">
        {(
          [
            ["Align left", IconAlignLeft, "left"],
            ["Align center", IconAlignCenter, "center"],
            ["Align right", IconAlignRight, "right"],
            ["Align top", IconAlignTop, "top"],
            ["Align middle", IconAlignMiddle, "middle"],
            ["Align bottom", IconAlignBottom, "bottom"],
          ] as const
        ).map(([name, I, mode]) => {
          const blocked = arrangeBlocked(2);
          return (
            <IconButton key={name} title={blocked ?? name} label={name} disabled={!!blocked} onClick={() => void alignSelected(mode)}>
              <I />
            </IconButton>
          );
        })}
        {(
          [
            ["Distribute horizontally", IconDistributeH, "x"],
            ["Distribute vertically", IconDistributeV, "y"],
          ] as const
        ).map(([name, I, axis]) => {
          const blocked = arrangeBlocked(3);
          return (
            <IconButton key={name} title={blocked ?? name} label={name} disabled={!!blocked} onClick={() => void distributeSelected(axis)}>
              <I />
            </IconButton>
          );
        })}
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

      <Divider />
      {/* Snap to grid (#299 slice 5) — per viewer, off by default. */}
      <Group label="Snap">
        <button
          type="button"
          aria-pressed={snapOn}
          title={
            !snapOn
              ? "Snap to grid — place, drag and nudge land on the grid"
              : snap
                ? `Snap to grid is on (${snap.label}) — click to turn it off`
                : "Snap to grid is on, but too fine at this scale — pick a larger spacing"
          }
          onClick={() => setSnapOn(!snapOn)}
          style={{
            ...BTN,
            height: 24,
            padding: "0 8px",
            borderColor: snapOn ? "#16181d" : "#dfe2e8",
            background: snapOn ? "#16181d" : "#fff",
            color: snapOn ? "#fff" : "#3d424e",
          }}
        >
          Snap
        </button>
        <select
          value={String(snapFt)}
          onChange={(e) => setSnapFt(Number(e.target.value))}
          disabled={!cal}
          aria-label="Snap spacing"
          title={cal ? "Snap spacing" : "Calibrate the page to snap in feet"}
          style={{ ...BTN, height: 24, padding: "0 4px", marginLeft: 3, fontWeight: 500, cursor: cal ? "pointer" : "default" }}
        >
          {SNAP_SPACINGS_FT.map((ft) => (
            <option key={ft} value={String(ft)}>
              {feetLabel(ft)}
            </option>
          ))}
        </select>
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

      <OutputsMenu ed={ed} />

      {packageUrl && (
        <a href={packageUrl} style={{ ...BTN, color: "#1f7a52" }} title="The client package you just built">
          Download package
        </a>
      )}

      <QuoteButton ed={ed} />
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
