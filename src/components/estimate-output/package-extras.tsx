import type { CSSProperties } from "react";
import { downloadsSummary, type DatasheetLinkView, type PackageDownloadsView } from "@/lib/estimate-output/package-extras-model";

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

export function PackageDownloads({ view }: { view: PackageDownloadsView }) {
  return (
    <div className="pkg-card">
      <h2>Downloads</h2>
      <p className="pkg-p">
        <a href={view.zipHref} download style={{ ...PKG_LINK, display: "inline-block", border: "1px solid var(--accent)", borderRadius: 8, padding: "8px 14px" }}>
          Download all (.zip)
        </a>
      </p>
      <p className="pkg-muted" style={{ margin: "0 0 8px" }}>
        {downloadsSummary(view)}
      </p>
      {view.files.length > 0 && (
        <details>
          <summary className="pkg-muted" style={{ cursor: "pointer" }}>{`Individual files (${view.files.length})`}</summary>
          <ul className="pkg-ul" style={{ marginTop: 8 }}>
            {view.files.map((f) => (
              <li key={f.href}>
                <a href={f.href} download style={PKG_LINK}>
                  {f.name}
                </a>{" "}
                <span className="pkg-muted">{f.kindLabel}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
