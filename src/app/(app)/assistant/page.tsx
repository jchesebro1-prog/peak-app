import { requireUser } from "@/lib/session";
import { aiEnabled } from "@/lib/ai/config";
import AssistantClient from "./assistant-client";

export const metadata = { title: "Assistant — Peak Backend" };

/**
 * The AI assistant page (Phase 8, D5). Env-gated: when ANTHROPIC_API_KEY is
 * absent the whole feature is off — the nav link is hidden (layout) and this
 * page shows a "not enabled" note instead of the chat surface. A human can
 * always reach it by URL, so the gate is enforced here too, not just in nav.
 */
export default async function AssistantPage() {
  const me = await requireUser();

  if (!aiEnabled()) {
    return (
      <div className="pk-content" style={{ maxWidth: 640, padding: "48px 30px" }}>
        <div
          className="pk-card"
          style={{ padding: "40px 26px", textAlign: "center" }}
        >
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
            ✨
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            The Assistant isn&#39;t enabled yet
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#9aa0ab",
              marginTop: 8,
              lineHeight: 1.6,
              maxWidth: 440,
              margin: "8px auto 0",
            }}
          >
            AI features turn on once an Anthropic API key is configured — set{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>
              ANTHROPIC_API_KEY
            </b>{" "}
            on the deployment (see <b style={{ color: "#5b616e" }}>MASTER-HOWTO §AI</b>).
            Until then, the rest of the app works exactly as before.
          </div>
        </div>
      </div>
    );
  }

  return <AssistantClient meName={me.name} />;
}
