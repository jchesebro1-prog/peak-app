/**
 * #282 phase 3 — the service builders' notice when a save's Rewards credit
 * was reduced or removed on the server (the `?credit=` redirect param). A
 * notice, not an error: the quote itself saved.
 */
export function RewardCreditNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="status"
      data-testid="reward-credit-notice"
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        borderRadius: 10,
        background: "#fdf6e7",
        border: "1px solid #f0e0b8",
        color: "#7a5a12",
        fontSize: 12.5,
        lineHeight: 1.45,
      }}
    >
      {message}
    </div>
  );
}
