import Link from "next/link";
import { requireUser } from "@/lib/session";
import { SteelCalculator } from "./steel-calc";

export const metadata = { title: "Steel Calculator — Peak Backend" };

export default async function SteelCalculatorPage() {
  await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/design" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>
          ← Design
        </Link>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Steel Calculator</h1>
        <p style={{ color: "#6b7079", fontSize: 13.5, marginTop: 3 }}>
          AISC beam capacity &amp; member sizing, rigging loads, and a 848-section property database + takeoff.
        </p>
      </div>
      <SteelCalculator />
    </div>
  );
}
