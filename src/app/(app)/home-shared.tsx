/**
 * Small presentational bits shared across the Home dashboard cards.
 */

export function CardHeadTitle({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 15, fontWeight: 600 }}>{children}</span>;
}
