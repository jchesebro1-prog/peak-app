"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginButtons({
  google,
  previewLogin,
}: {
  google: boolean;
  previewLogin: boolean;
}) {
  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [emailError, setEmailError] = useState("");

  async function signInWithEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEmailError("");
    const result = await signIn("preview-login", {
      email,
      accessCode,
      redirect: false,
      callbackUrl: window.location.origin + "/",
    });
    if (result?.error) {
      setEmailError("The email or access code was not accepted.");
      return;
    }
    window.location.assign(result?.url || "/");
  }

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

      {!google && !previewLogin && (
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
          AUTH_GOOGLE_SECRET (see DEPLOY.md), or configure the local preview
          sign-in with AUTH_DEV_LOGIN and AUTH_DEV_ACCESS_CODE.
        </div>
      )}

      {previewLogin && (
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
            Preview sign-in
          </div>
          <form onSubmit={signInWithEmail} style={{ display: "grid", gap: 8 }}>
            <input
              aria-label="Team email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              style={{
                minWidth: 0,
                flex: 1,
                border: "1px solid #d9dde5",
                borderRadius: 8,
                padding: "10px 11px",
                color: "#16181d",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
              }}
            />
            <input
              aria-label="Access code"
              type="password"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Access code"
              required
              autoComplete="current-password"
              style={{
                minWidth: 0,
                border: "1px solid #d9dde5",
                borderRadius: 8,
                padding: "10px 11px",
                color: "#16181d",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
              }}
            />
            <button className="pk-google-btn" type="submit">Continue</button>
          </form>
          {emailError && <div style={{ color: "#b42318", fontSize: 12, marginTop: 8 }}>{emailError}</div>}
        </div>
      )}
    </div>
  );
}
