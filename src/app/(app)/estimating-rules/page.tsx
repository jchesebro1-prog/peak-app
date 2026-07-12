import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { GROUPS, value } from "@/lib/stores/pricing";
import { RulesActions, RulesEditor, type GroupVM, type ItemVM } from "./controls";

export const metadata = { title: "Estimating Rules — Peak Backend" };

/**
 * Estimating Rules — port of app/Estimating Rules.dc.html. The master registry
 * of every estimating rate & formula (pricing.ts GROUPS). Admin-only, like the
 * prototype, but gated server-side. The current value + default of each rate is
 * read here; editing / reset / export happen through server actions in the
 * client islands (controls.tsx).
 */

const PRINT_CSS = `
@media print {
  .er-noprint { display: none !important; }
}
@media (max-width: 720px) {
  .er-rate { flex-direction: column !important; align-items: stretch !important; gap: 8px !important; }
  .er-rate-ctl { justify-content: flex-start !important; }
}
`;

export default async function EstimatingRulesPage() {
  const user = await requireUser();
  const isAdmin = can("manage_users", user.roles);

  const groups: GroupVM[] = isAdmin
    ? await Promise.all(
        GROUPS.map(async (g) => ({
          key: g.key,
          label: g.label,
          live: g.live,
          sub: g.sub,
          note: g.note,
          items: await Promise.all(
            g.items.map(async (it): Promise<ItemVM> => {
              if (it.kind === "formula") {
                return { kind: "formula", id: it.id, label: it.label, expr: it.expr };
              }
              const v = await value(it);
              return {
                kind: "rate",
                id: it.id,
                label: it.label,
                unit: it.unit,
                value: v == null ? it.def : v,
                def: it.def,
                min: it.min,
                max: it.max,
                step: it.step,
                help: it.help,
                ref: it.ref,
              };
            })
          ),
        }))
      )
    : [];

  return (
    <div className="pk-content" style={{ maxWidth: 960 }}>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* header */}
      <div
        className="er-head"
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          rowGap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>
              Estimating rules
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            Every rate &amp; equation the estimators run on — edit the numbers, export the whole
            set.
          </div>
        </div>
        {isAdmin && (
          <div className="er-noprint">
            <RulesActions />
          </div>
        )}
      </div>

      {!isAdmin ? (
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "#f1f2f5",
              color: "#8c919c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 14px",
            }}
          >
            🔒
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            These rates drive every quote, so editing them is limited to admins.
          </div>
        </div>
      ) : (
        <RulesEditor groups={groups} />
      )}
    </div>
  );
}
