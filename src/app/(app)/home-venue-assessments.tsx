import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * Venue assessments card — port of Home.dc.html's field survey glance widget.
 */

export type SurveyCard = {
  id: string;
  mono: string;
  customer: string;
  sub: string;
  href: string;
  stage: { label: string; ink: string; soft: string; bd: string };
};

export default function HomeVenueAssessments({
  surveyCards,
  surveyPendingCount,
}: {
  surveyCards: SurveyCard[];
  surveyPendingCount: number;
}) {
  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "15px 17px 12px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <CardHeadTitle>Venue assessments</CardHeadTitle>
          {surveyPendingCount > 0 && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                color: "#9a6a1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {surveyPendingCount} to sync
            </span>
          )}
        </div>
        <Link
          href="/venue-assessments"
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          Open →
        </Link>
      </div>
      {surveyCards.map((s) => (
        <Link
          key={s.id}
          href={s.href}
          className="pkh-hover"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "12px 17px",
            borderBottom: "1px solid #f5f6f8",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: "#eef3f0",
              color: "#1f7a52",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {s.mono}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.customer}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "#9aa0ab",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.sub}
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: s.stage.ink,
              background: s.stage.soft,
              border: `1px solid ${s.stage.bd}`,
              padding: "2px 9px",
              borderRadius: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {s.stage.label}
          </span>
        </Link>
      ))}
      {surveyCards.length === 0 && (
        <div
          style={{
            padding: "20px 17px",
            textAlign: "center",
            color: "#9aa0ab",
            fontSize: 12.5,
          }}
        >
          No venue assessments yet.
        </div>
      )}
      <div style={{ padding: "11px 17px" }}>
        <Link
          href="/venue-assessments?new=1"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          + Request survey
        </Link>
      </div>
    </div>
  );
}
