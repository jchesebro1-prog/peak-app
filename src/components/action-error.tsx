export default function ActionError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        borderRadius: 10,
        background: "#f9ece8",
        border: "1px solid #f0d6cd",
        color: "#a0442b",
        fontSize: 12.5,
        lineHeight: 1.45,
      }}
    >
      {message}
    </div>
  );
}
