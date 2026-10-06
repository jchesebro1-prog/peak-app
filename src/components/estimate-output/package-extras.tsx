import type { CSSProperties } from "react";
import type { DatasheetLinkView } from "@/lib/estimate-output/package-extras-model";

/**
 * #301 slice C — the package page's extra cards (server components, pure
 * props). They render inside PackageView's mount points and use its
 * PACKAGE_WEB_CSS classes (pkg-card, pkg-p, pkg-muted, pkg-ul).
 */

export const PKG_LINK: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };

export function DatasheetLink({ link }: { link: DatasheetLinkView }) {
  return (
    <p className="pkg-p pkg-muted" style={{ marginTop: 6 }}>
      <a href={link.href} download style={PKG_LINK}>
        {`Datasheet — ${link.name}`}
      </a>
    </p>
  );
}
