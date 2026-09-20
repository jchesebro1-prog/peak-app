import { inpStyle, labelStyle } from "./styles";

export type SignoffValue = {
  repName: string;
  repSignedAt: string;
  contactName: string;
  contactSignedAt: string;
  reviewerName: string;
  reviewerRole: string;
  reviewerSignedAt: string;
};

export function SignoffSection({
  value,
  templateRev,
  onChange,
}: {
  value: SignoffValue;
  templateRev: string;
  onChange: (value: SignoffValue) => void;
}) {
  const set = (key: keyof SignoffValue, next: string) => onChange({ ...value, [key]: next });
  const reviewerOpen = !!(value.reviewerName || value.reviewerRole || value.reviewerSignedAt);

  return (
    <div>
      <div className="sv-grid">
        <label style={labelStyle}>Peak representative<input value={value.repName} onChange={(event) => set("repName", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <label style={labelStyle}>Date<input type="date" value={value.repSignedAt} onChange={(event) => set("repSignedAt", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <label style={labelStyle}>Site contact<input value={value.contactName} onChange={(event) => set("contactName", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <label style={labelStyle}>Date<input type="date" value={value.contactSignedAt} onChange={(event) => set("contactSignedAt", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
      </div>

      <details open={reviewerOpen || undefined} style={{ marginTop: 12 }}>
        <summary style={{ minHeight: 38, display: "inline-flex", alignItems: "center", border: "1px solid #e4e7ec", borderRadius: 8, background: "#fff", color: "#5b616e", padding: "0 12px", cursor: "pointer", fontWeight: 600, fontSize: 12.5 }}>Optional technical reviewer</summary>
        <div className="sv-grid" style={{ marginTop: 12 }}>
          <label style={labelStyle}>Technical reviewer<input value={value.reviewerName} onChange={(event) => set("reviewerName", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
          <label style={labelStyle}>Role<input value={value.reviewerRole} onChange={(event) => set("reviewerRole", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
          <label style={labelStyle}>Date<input type="date" value={value.reviewerSignedAt} onChange={(event) => set("reviewerSignedAt", event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>
          <button type="button" onClick={() => onChange({ ...value, reviewerName: "", reviewerRole: "", reviewerSignedAt: "" })} style={{ alignSelf: "end", minHeight: 42, border: "1px solid #ead4cf", borderRadius: 8, background: "#fff", color: "#a64b3c", cursor: "pointer" }}>Remove reviewer</button>
        </div>
      </details>

      <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid #ececf0", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#9aa0ab" }}>Venue Assessment Rev. {templateRev}</div>
    </div>
  );
}
