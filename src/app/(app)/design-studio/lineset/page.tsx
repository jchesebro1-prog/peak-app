import Link from "next/link";
import { requireUser } from "@/lib/session";
import { LinesetBuilder } from "./lineset-builder";

export const metadata = { title: "Lineset Builder — Peak Backend" };

export default async function LinesetBuilderPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1040 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design-studio" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design Studio
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Lineset Builder</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          Auto-place a lineset schedule on the 8-inch grid from stage width &amp; depth, using the built-in rules.
        </p>
      </div>
      <LinesetBuilder />
    </div>
  );
}
