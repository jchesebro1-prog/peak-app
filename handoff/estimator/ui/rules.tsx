/**
 * Estimator handoff — `#/rules` and `#/rules/<page>`: the app's real Estimating Rules editors (RulesActions +
 * RulesEditor from controls.tsx, TrackSeriesClient, CurtainMountsClient, SystemCategoriesClient), each under the markup
 * its server page renders (src/app/(app)/estimating-rules/page.tsx and …/{track-series,curtain-mounts,
 * system-categories}/page.tsx). Props come from the store (runtime/props/rules.ts); the editors' server actions are the
 * browser ones in runtime/actions/rules-actions.ts, which write the `blobs` / `settings` collections — the Estimator,
 * the catalog-add pricing and the assemblies read the same store, so an edit prices the next estimate opened.
 * `router.refresh()` re-reads the props, as a server re-render would. The Conduit sizes card links to
 * /estimating-rules/conduit-sizes, which is "Not part of the prototype" (a Grid concern). Plan: PR 2 Task 10.
 */
import { useCallback, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { RulesActions, RulesEditor } from "@/app/(app)/estimating-rules/controls";
import TrackSeriesClient from "@/app/(app)/estimating-rules/track-series/track-series-client";
import CurtainMountsClient from "@/app/(app)/estimating-rules/curtain-mounts/curtain-mounts-client";
import SystemCategoriesClient from "@/app/(app)/estimating-rules/system-categories/system-categories-client";
import type { RulesPage } from "../runtime/routes";
import type { HandoffStore } from "../runtime/store";
import { buildCurtainMountsProps, buildRulesProps, buildSystemCategoriesProps, buildTrackSeriesProps } from "../runtime/props/rules";
import { LoadError } from "./load-error";
import { useRefreshedProps } from "./use-refreshed-props";

const FILL: CSSProperties = { position: "absolute", inset: 0, overflow: "auto" };

/** page.tsx PRINT_CSS. */
const PRINT_CSS = `
@media print {
  .er-noprint { display: none !important; }
}
@media (max-width: 720px) {
  .er-rate { flex-direction: column !important; align-items: stretch !important; gap: 8px !important; }
  .er-rate-ctl { justify-content: flex-start !important; }
}
`;

const ADMIN_BADGE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".06em",
  color: "#8a6d1f",
  background: "#fbf3dd",
  border: "1px solid #f0e2bd",
  padding: "3px 9px",
  borderRadius: 6,
};

const CARD_LINK: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "13px 17px", marginBottom: 14, textDecoration: "none", color: "inherit" };

/** The page's own sub-page cards, in its order. */
const CARDS: ReadonlyArray<{ href: string; title: string; blurb: string }> = [
  { href: "/estimating-rules/track-series", title: "Track series", blurb: "The catalog part for each piece of a track system (track, carriers, clamps, pulleys…) — what the track configurator prices from." },
  { href: "/estimating-rules/curtain-mounts", title: "Curtain mounts", blurb: "The hardware each curtain mount uses when a curtain has no track." },
  { href: "/estimating-rules/conduit-sizes", title: "Conduit sizes", blurb: "What a priced conduit run buys, by size." },
  { href: "/estimating-rules/system-categories", title: "System categories", blurb: "Typical parts that pre-fill a new system on the Estimator." },
];

function Loading() {
  return <div style={FILL} data-handoff-loading="" />;
}

/** EstimatingRulesPage, in the browser. */
export function RulesScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const load = useCallback(() => buildRulesProps(store), [store]);
  const loaded = useRefreshedProps(load, onReady, "estimating rules");
  if (!loaded) return <Loading />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const { isAdmin, groups, venueDoctrine } = loaded.value;
  return (
    <div style={FILL} data-handoff-rules="">
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

        {/* header */}
        <div className="er-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", rowGap: 12, marginBottom: 20 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Estimating rules</div>
              <span style={ADMIN_BADGE}>ADMIN</span>
            </div>
            <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>Every rate &amp; equation the estimators run on — edit the numbers, export the whole set.</div>
          </div>
          {isAdmin && (
            <div className="er-noprint">
              <RulesActions />
            </div>
          )}
        </div>

        {!isAdmin ? (
          <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "#f1f2f5", color: "#8c919c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, margin: "0 auto 14px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
            <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>These rates drive every quote, so editing them is limited to admins.</div>
          </div>
        ) : (
          <>
            {CARDS.map((c) => (
              <Link key={c.href} href={c.href} className="pk-card er-noprint" style={CARD_LINK}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.title}</div>
                  <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 2 }}>{c.blurb}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>Open →</span>
              </Link>
            ))}
            <RulesEditor groups={groups} venueDoctrine={venueDoctrine} />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the sub-pages */

/** Each sub-page's heading, intro and "Admin access required" line (verbatim from its page.tsx). */
const PAGE_COPY: Record<RulesPage, { title: string; badge: boolean; intro: string; locked: string; maxWidth: number }> = {
  "track-series": {
    title: "Track series",
    badge: true,
    intro: "The catalog part for each piece of a track system. The track configurator works out the quantities; every price comes from these parts in the live catalog.",
    locked: "Track series decide which catalog parts price a track, so editing them is limited to admins.",
    maxWidth: 1000,
  },
  "curtain-mounts": {
    title: "Curtain mounts",
    badge: false,
    intro: "The hardware each curtain mount uses when a curtain has no track. A tracked curtain lists its track's own parts instead.",
    locked: "Curtain mounts decide the hardware every cut sheet lists, so editing them is limited to admins.",
    maxWidth: 1000,
  },
  "system-categories": {
    title: "System categories",
    badge: true,
    intro: "The typical parts that pre-fill a new system on the Estimator. Pick a category when adding a system and its parts come in priced from the live catalog; the person adding can untick or change any of them.",
    locked: "System categories decide which catalog parts pre-fill a new system, so editing them is limited to admins.",
    maxWidth: 1000,
  },
};

function PageFrame({ page, isAdmin, children }: { page: RulesPage; isAdmin: boolean; children?: ReactNode }) {
  const copy = PAGE_COPY[page];
  const back = (
    <Link href="/estimating-rules" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>
      ← Estimating rules
    </Link>
  );
  if (!isAdmin) {
    return (
      <div style={FILL} data-handoff-rules-page={page}>
        <div className="pk-content" style={{ maxWidth: 960 }}>
          {back}
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 20px" }}>{copy.title}</div>
          <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
            <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>{copy.locked}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div style={FILL} data-handoff-rules-page={page}>
      <div className="pk-content" style={{ maxWidth: copy.maxWidth }}>
        {back}
        {copy.badge ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 6 }}>
              <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>{copy.title}</div>
              <span style={ADMIN_BADGE}>ADMIN</span>
            </div>
            <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 18px", lineHeight: 1.5 }}>{copy.intro}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", margin: "6px 0 6px" }}>{copy.title}</div>
            <div style={{ fontSize: 13, color: "#8c919c", marginBottom: 18, lineHeight: 1.55 }}>{copy.intro}</div>
          </>
        )}
        {children}
      </div>
    </div>
  );
}

function TrackSeriesScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const load = useCallback(() => buildTrackSeriesProps(store), [store]);
  const loaded = useRefreshedProps(load, onReady, "track series");
  if (!loaded) return <Loading />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const p = loaded.value;
  return (
    <PageFrame page="track-series" isAdmin={p.isAdmin}>
      <TrackSeriesClient series={p.series} parts={p.parts} />
    </PageFrame>
  );
}

function CurtainMountsScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const load = useCallback(() => buildCurtainMountsProps(store), [store]);
  const loaded = useRefreshedProps(load, onReady, "curtain mounts");
  if (!loaded) return <Loading />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const p = loaded.value;
  return (
    <PageFrame page="curtain-mounts" isAdmin={p.isAdmin}>
      <CurtainMountsClient mounts={p.mounts} parts={p.parts} />
    </PageFrame>
  );
}

function SystemCategoriesScreen({ store, onReady }: { store: HandoffStore; onReady: () => void }) {
  const load = useCallback(() => buildSystemCategoriesProps(store), [store]);
  const loaded = useRefreshedProps(load, onReady, "system categories");
  if (!loaded) return <Loading />;
  if ("error" in loaded) return <LoadError message={loaded.error} onReady={onReady} />;
  const p = loaded.value;
  return (
    <PageFrame page="system-categories" isAdmin={p.isAdmin}>
      <SystemCategoriesClient initial={p.categories} parts={p.parts} />
    </PageFrame>
  );
}

/** One Estimating Rules sub-page (#/rules/<page>). */
export function RulesPageScreen({ store, page, onReady }: { store: HandoffStore; page: RulesPage; onReady: () => void }) {
  switch (page) {
    case "track-series":
      return <TrackSeriesScreen store={store} onReady={onReady} />;
    case "curtain-mounts":
      return <CurtainMountsScreen store={store} onReady={onReady} />;
    case "system-categories":
      return <SystemCategoriesScreen store={store} onReady={onReady} />;
  }
}
