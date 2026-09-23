import Link from "next/link";
import type { ReactNode } from "react";
import type { SessionUser } from "@/lib/session";
import { layoutFor } from "@/lib/dashboard/layout-store";
import { makeDashboardData, type DashboardData } from "@/lib/dashboard/data";
import type { WidgetCtx } from "@/lib/dashboard/context";
import { dashHref, galleryFor, layoutNeedsRange, resolveRange, widgetDef, type Surface } from "@/lib/dashboard/registry";
import { RENDERERS } from "./renderers";
import FrameControls from "./frame-controls";
import Gallery from "./gallery";
import RangeChips from "./range-chips";

/**
 * #43 — the widget host. Resolves the user's layout for a surface, renders
 * each widget through its registry renderer inside a size-classed grid
 * cell, and in ?customize=1 shows the gallery and per-widget controls.
 * A renderer that throws is logged and replaced by a small error card — one
 * bad widget never takes the page down (decision 15).
 */
export default async function WidgetHost({
  user, surface, sp, data,
}: {
  user: SessionUser;
  surface: Surface;
  sp: Record<string, string | string[] | undefined>;
  data?: DashboardData;
}) {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v[0] : v;
  const customize = flat.customize === "1";
  const range = resolveRange(flat.range);
  const base = surface === "home" ? "/" : "/reports";
  const keep = { range: flat.range, customize: flat.customize };

  const { ids, customized } = await layoutFor(user.id, surface, user.roles);
  const ctx: WidgetCtx = { user, surface, range, now: Date.now(), sp: flat, data: data ?? makeDashboardData(user) };

  const rendered = await Promise.all(
    ids.map(async (id) => {
      let body: ReactNode;
      try {
        body = await RENDERERS[id](ctx);
      } catch (err) {
        console.error("[dashboard] widget failed:", id, err);
        body = <Note text="Couldn't load this widget." />;
      }
      return { id, body };
    })
  );
  const available = galleryFor(surface, user.roles).filter((w) => !ids.includes(w.id as (typeof ids)[number]));

  return (
    <>
      <div className="pk-dash-bar">
        <div>{layoutNeedsRange(ids) && <RangeChips base={base} range={range} keep={keep} />}</div>
        <Link
          href={dashHref(base, { ...keep, customize: customize ? undefined : "1" })}
          className={customize ? "pk-btn-accent" : "pk-dash-customize"}
        >
          {customize ? "Done" : "Customize"}
        </Link>
      </div>
      {customize && (
        <Gallery
          surface={surface}
          ids={ids}
          customized={customized}
          available={available.map((w) => ({ id: w.id, title: w.title, desc: w.desc }))}
        />
      )}
      <div className="pk-dash">
        {rendered.map(({ id, body }, i) => {
          const def = widgetDef(id)!;
          return (
            <section key={id} className={`pk-dash-${def.size}`} data-widget={id}>
              {customize && <FrameControls surface={surface} ids={ids} id={id} title={def.title} index={i} />}
              {body}
            </section>
          );
        })}
        {ids.length === 0 && (
          <div className="pk-dash-full">
            <Note text={customize ? "Add a widget from the list above." : "Nothing here yet. Choose Customize to add widgets."} />
          </div>
        )}
      </div>
    </>
  );
}

function Note({ text }: { text: string }) {
  return (
    <div className="pk-card" style={{ padding: "18px 16px", fontSize: 12.5, color: "var(--muted)", textAlign: "center" }}>
      {text}
    </div>
  );
}
