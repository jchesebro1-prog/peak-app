import Link from "next/link";
import { CardHeadTitle } from "./home-shared";

/**
 * Inbox dashboard card — customer messages waiting on a reply, plus the
 * by-mailbox waiting counts in the aside. Port of Home.dc.html's inbox
 * glance widget.
 */

const ACCENT_SOFT = "var(--accent-soft)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 70%, #000)";
const ACCENT_BORDER_LT = "color-mix(in srgb, var(--accent) 30%, #fff)";

/** Renamed from the prototype's `ChanIcon` — collides by name with the
 *  `ChanIcon` *type* exported from inbox/types.ts. */
function ChannelGlyph({ channel }: { channel: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "#b4543a",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (channel === "call")
    return (
      <svg {...common}>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
      </svg>
    );
  if (channel === "meeting")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m2 7 10 6 10-6" />
    </svg>
  );
}

export default function HomeInbox({
  inboxNeedsCount,
  inboxUnread,
  inboxItems,
  inboxBoxes,
}: {
  inboxNeedsCount: number;
  inboxUnread: number;
  inboxItems: Array<{
    id: string;
    href: string;
    customer: string;
    subject: string;
    wait: string;
    unread: boolean;
    channel: string;
    boxTag: string;
    boxColor: string;
  }>;
  inboxBoxes: Array<{
    id: string;
    label: string;
    color: string;
    href: string;
    waiting: number;
  }>;
}) {
  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 22 }}>
      <div
        className="pkh-greet"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "15px 18px 13px",
          borderBottom: "1px solid #f0f1f4",
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <CardHeadTitle>Inbox</CardHeadTitle>
          {inboxNeedsCount > 0 && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                color: "#b4543a",
                background: "#f8ece7",
                border: "1px solid #eccfc4",
                padding: "2px 8px",
                borderRadius: 20,
              }}
            >
              {inboxNeedsCount} need reply
            </span>
          )}
          <span style={{ fontSize: 12.5, color: "#9aa0ab" }}>
            Customer messages waiting on a reply
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          <Link
            href="/inbox?compose=1"
            className="pkh-softbtn"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              fontSize: 12.5,
              fontWeight: 600,
              color: ACCENT_INK,
              background: ACCENT_SOFT,
              border: `1px solid ${ACCENT_BORDER_LT}`,
              padding: "8px 13px",
              borderRadius: 8,
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Compose
          </Link>
          <Link
            href="/inbox"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--accent)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Open inbox →
          </Link>
        </div>
      </div>

      <div className="pkh-inbox">
        <div style={{ minWidth: 0 }}>
          {inboxItems.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className="pkh-hover"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 18px",
                borderBottom: "1px solid #f5f6f8",
                textDecoration: "none",
                color: "inherit",
                position: "relative",
              }}
            >
              {m.unread && (
                <span
                  style={{
                    position: "absolute",
                    left: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                  }}
                />
              )}
              <span
                style={{
                  width: 30,
                  height: 30,
                  flexShrink: 0,
                  borderRadius: 9,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#f8ece7",
                }}
              >
                <ChannelGlyph channel={m.channel} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      color: "#16181d",
                    }}
                  >
                    {m.customer}
                  </span>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: m.boxColor,
                      background: `color-mix(in srgb, ${m.boxColor} 12%, #fff)`,
                      border: `1px solid color-mix(in srgb, ${m.boxColor} 24%, #fff)`,
                      padding: "1px 7px",
                      borderRadius: 20,
                      flexShrink: 0,
                    }}
                  >
                    {m.boxTag}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#5b616e",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {m.subject}
                </div>
              </div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#b4543a",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                {m.wait} waiting
              </span>
              <span style={{ color: "#c4c9d2", fontSize: 18, flexShrink: 0 }}>›</span>
            </Link>
          ))}
          {inboxItems.length === 0 && (
            <div
              style={{
                padding: "30px 18px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Inbox zero — no customers are waiting on a reply.
            </div>
          )}
        </div>

        <div className="pkh-inbox-aside">
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #ececf0",
                borderRadius: 10,
                padding: "9px 11px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 20,
                  fontWeight: 600,
                  color: "#b4543a",
                  letterSpacing: "-.01em",
                }}
              >
                {inboxNeedsCount}
              </div>
              <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 2 }}>Need reply</div>
            </div>
            <div
              style={{
                flex: 1,
                background: "#fff",
                border: "1px solid #ececf0",
                borderRadius: 10,
                padding: "9px 11px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                }}
              >
                {inboxUnread}
              </div>
              <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 2 }}>Unread</div>
            </div>
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#aab0bb",
              marginBottom: 6,
            }}
          >
            By mailbox
          </div>
          {inboxBoxes.map((b) => (
            <Link
              key={b.id}
              href={b.href}
              className="pkh-hoverbox"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 6px",
                borderRadius: 8,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: b.color,
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "#3a3f4a",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {b.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                  color: b.waiting > 0 ? "#b4543a" : "#c4c9d2",
                }}
              >
                {b.waiting}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
