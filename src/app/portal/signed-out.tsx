/**
 * The portal's signed-out / bad-link card (IDEAS #47), shared by `/portal`
 * and `/portal/catalog` (#242). Server component, no data.
 */
export function PortalSignedOut({ companyName, denied = false }: { companyName: string; denied?: boolean }) {
  return (
    <div
      style={{
        maxWidth: 460,
        margin: "48px auto 0",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 14,
        padding: "30px 28px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 17, fontWeight: 600 }}>
        {denied ? "That access link didn’t work" : "Sign in with your access link"}
      </div>
      <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.65, marginTop: 10 }}>
        {denied
          ? "The link may have expired or been replaced. Ask your " +
            companyName +
            " contact to send you a fresh one — it only takes them a moment."
          : "This portal uses personal access links instead of passwords. Open the link " +
            companyName +
            " sent you and you’ll land right here, signed in. Don’t have one? Ask your " +
            companyName +
            " contact."}
      </div>
    </div>
  );
}
