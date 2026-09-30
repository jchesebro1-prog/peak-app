/**
 * #282 phase 3 — the flame-test and inspection proposal letters' Rewards
 * credit rows, inside the engagement-fee box: the quoted price, "Rewards
 * credit −$X" and the net total. Renders nothing without a credit, so a
 * letter with no credit is unchanged. The headless-Chrome PDF renders the
 * same letter view, so it follows. Server component — no state.
 */
export function LetterCreditRows({
  gross,
  credit,
  net,
  mono,
}: {
  gross: number;
  credit: number;
  net: number;
  mono: string;
}) {
  if (!(credit > 0)) return null;
  const money = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const row = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: "9.5pt", lineHeight: 1.6 } as const;
  return (
    <div data-testid="letter-reward-credit" style={{ marginTop: 9, paddingTop: 7, borderTop: "1px solid #e4e6ea", maxWidth: 300 }}>
      <div style={{ ...row, color: "#5b616e" }}>
        <span>Quoted price</span>
        <span style={{ fontFamily: mono }}>{money(gross)}</span>
      </div>
      <div style={{ ...row, color: "#1f7a52", fontWeight: 600 }}>
        <span>Rewards credit</span>
        <span style={{ fontFamily: mono }}>−{money(credit)}</span>
      </div>
      <div style={{ ...row, color: "#111", fontWeight: 700 }}>
        <span>Total</span>
        <span style={{ fontFamily: mono }}>{money(net)}</span>
      </div>
    </div>
  );
}
