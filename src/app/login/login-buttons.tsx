"use client";

import { signIn } from "next-auth/react";

export default function LoginButtons({
  google,
  devLogin,
  roster,
}: {
  google: boolean;
  devLogin: boolean;
  roster: Array<{
    id: string;
    name: string;
    initials: string;
    color: string;
    roleLabel: string;
  }>;
}) {
  return (
    <div>
      {google && (
        <button
          className="pk-google-btn"
          onClick={() =>
            signIn("google", { callbackUrl: window.location.origin + "/" })
          }
        >
          <svg width="17" height="17" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>
      )}

      {!google && !devLogin && (
        <div
          style={{
            fontSize: 12.5,
            color: "#9aa0ab",
            background: "#f7f8fa",
            border: "1px solid #ececf0",
            borderRadius: 9,
            padding: "12px 14px",
            lineHeight: 1.5,
          }}
        >
          Google sign-in isn’t configured yet. Set AUTH_GOOGLE_ID and
          AUTH_GOOGLE_SECRET (see DEPLOY.md), or enable AUTH_DEV_LOGIN for a
          development sign-in.
        </div>
      )}

      {devLogin && (
        <div style={{ marginTop: google ? 16 : 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#aab0bb",
              marginBottom: 8,
            }}
          >
            Dev sign-in — pick a team member
          </div>
          <div
            style={{
              border: "1px solid #ececf0",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {roster.map((p, i) => (
              <button
                key={p.id}
                onClick={() =>
                  signIn("dev-login", {
                    userId: p.id,
                    callbackUrl: window.location.origin + "/",
                  })
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "10px 12px",
                  background: "#fff",
                  border: "none",
                  borderTop: i ? "1px solid #f5f6f8" : "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: p.color,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10.5,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {p.initials}
                </span>
                <span style={{ flex: 1, textAlign: "left" }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#16181d" }}>
                    {p.name}
                  </span>
                  <span style={{ display: "block", fontSize: 11, color: "#9aa0ab" }}>
                    {p.roleLabel}
                  </span>
                </span>
                <span style={{ color: "#c4c9d2", fontSize: 15 }}>›</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
