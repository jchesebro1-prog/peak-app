import Link from "next/link";
import { requireUser } from "@/lib/session";
import { get as getJob } from "@/lib/stores/flame-jobs";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { PrintButton } from "./controls";
import {
  buildReportModel,
  ReportBody,
  type ReportVariant,
  type OrgCtx,
} from "./report-doc";

export const metadata = { title: "Field Flame Inspection report — Quartzite-6" };

/**
 * Field Flame Inspection RESULTS REPORT — printable results document for a
 * completed inspection, in three variants (letter / summary / certificate).
 * Pixel port of Flame Test Report.dc.html on the .pk-doc-page foundation.
 * Deep-linked as
 * /flame-tests/report?job=<flameJobId>&variant=<letter|summary|certificate>.
 * Variant is URL state (the toolbar tabs are <Link>s); default is the
 * certificate (the prototype's noted default).
 */

const VARIANTS: ReportVariant[] = ["letter", "summary", "certificate"];
const VARIANT_LABEL: Record<ReportVariant, string> = {
  letter: "Letter",
  summary: "Summary",
  certificate: "Certificate",
};

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const TOOLBAR_CSS = `
  .ftr-toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; background: rgba(247,248,250,.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e4e7ec; }
`;

function NotFoundCard({
  accent,
  title,
  body,
  href,
  cta,
  solid,
}: {
  accent: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  solid?: boolean;
}) {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: "60px auto",
        padding: 32,
        textAlign: "center",
        background: "#fff",
        border: "1px solid #ececf0",
        borderRadius: 14,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.6 }}>{body}</div>
      <Link
        href={href}
        style={{
          display: "inline-block",
          marginTop: 16,
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          ...(solid
            ? { color: "#fff", background: accent, borderRadius: 9, padding: "10px 16px" }
            : { color: accent }),
        }}
      >
        {cta}
      </Link>
    </div>
  );
}

export default async function FlameTestReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, settings, users] = await Promise.all([
    requireUser(),
    searchParams,
    getSettings(),
    allUsers(),
  ]);
  const accent = settings.accent || "#7b3f8a";
  const jobId = one(sp.job);
  const variantParam = one(sp.variant) as ReportVariant;
  const variant: ReportVariant = VARIANTS.includes(variantParam)
    ? variantParam
    : "certificate";

  const job = jobId ? await getJob(jobId) : null;
  const backHref = jobId ? "/flame-tests/results?job=" + encodeURIComponent(jobId) : "/flame-tests";
  const backLabel = jobId ? "← Results" : "← Flame tests";

  const Frame = ({ children, showTabs }: { children: React.ReactNode; showTabs: boolean }) => (
    <div style={{ minHeight: "100vh", fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <style>{TOOLBAR_CSS}</style>
      <div className="ftr-toolbar pk-no-print">
        <Link
          href={backHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: "#8c919c",
            textDecoration: "none",
          }}
        >
          {backLabel}
        </Link>
        {showTabs && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: 3,
                background: "#eceef1",
                borderRadius: 10,
              }}
            >
              {VARIANTS.map((v) => {
                const on = v === variant;
                const qs = new URLSearchParams();
                if (jobId) qs.set("job", jobId);
                qs.set("variant", v);
                return (
                  <Link
                    key={v}
                    href={"/flame-tests/report?" + qs.toString()}
                    scroll={false}
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "7px 13px",
                      borderRadius: 8,
                      textDecoration: "none",
                      background: on ? "#fff" : "transparent",
                      color: on ? "#16181d" : "#8c919c",
                      boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
                    }}
                  >
                    {VARIANT_LABEL[v]}
                  </Link>
                );
              })}
            </div>
            <PrintButton accent={accent} />
          </div>
        )}
      </div>
      {children}
    </div>
  );

  /* -------- not found -------- */
  if (!job) {
    return (
      <Frame showTabs={false}>
        <NotFoundCard
          accent={accent}
          title="Flame test not found"
          body="Open a completed flame test to generate its results report."
          href="/flame-tests"
          cta="Go to flame tests →"
        />
      </Frame>
    );
  }

  /* -------- results not logged yet -------- */
  const logged = job.stage === "completed" && job.results;
  if (!logged) {
    return (
      <Frame showTabs={false}>
        <NotFoundCard
          accent={accent}
          title="Results not logged yet"
          body={`${job.customer || "This flame test"} doesn’t have logged results yet. Record the field results to generate this report.`}
          href={"/flame-tests/results?job=" + encodeURIComponent(job.id)}
          cta="Log results →"
          solid
        />
      </Frame>
    );
  }

  const org: OrgCtx = {
    accent,
    companyName: settings.companyName || "Peak Systems Group",
    offices: Array.isArray(settings.offices) ? settings.offices : [],
    users: users.map((u) => ({ name: u.name, roles: u.roles, email: u.email, officeId: u.officeId })),
    letterhead: settings.logoDark || null,
    templates: settings.templates,
  };
  const model = buildReportModel(job, org);

  return (
    <Frame showTabs>
      <div style={{ padding: "26px 16px 60px" }}>
        <ReportBody m={model} variant={variant} />
      </div>
    </Frame>
  );
}
