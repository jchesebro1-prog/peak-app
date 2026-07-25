/**
 * Q-6 brand mark (D117) — flat vector stand-in for the photographic logo:
 * ring-Q with the angled tail slash + geometric 6. Crisp at 30px.
 */
const PALETTES = {
  steel: { q: "#9aa0ab", six: "#c6c9ce" },
  gold: { q: "#8a6c34", six: "#b08d4a" },
  mono: { q: "currentColor", six: "currentColor" },
} as const;

export type Q6Variant = keyof typeof PALETTES;

export default function Q6Mark({
  variant = "steel",
  size = 30,
  title = "Quartzite-6",
}: {
  variant?: Q6Variant;
  size?: number;
  title?: string;
}) {
  const c = PALETTES[variant];
  return (
    <svg
      viewBox="0 0 66 44"
      width={size * 1.5}
      height={size}
      role="img"
      aria-label={title}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="20" cy="22" r="16" fill="none" stroke={c.q} strokeWidth="7" />
      <path d="M23 25 L39 41" stroke={c.q} strokeWidth="7" fill="none" />
      <path d="M58 3 C 50 10, 45 17, 43.5 25.5" stroke={c.six} strokeWidth="7" fill="none" />
      <circle cx="50" cy="30.5" r="9.5" fill="none" stroke={c.six} strokeWidth="7" />
    </svg>
  );
}
