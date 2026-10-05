"use client";

import type { ReactNode } from "react";
import { useImagesSettled } from "@/components/design/use-images-settled";

/**
 * E-501's print gate (#300). The riser itself is a server render; in Object
 * mode its rows carry drawing images, so this wrapper holds `data-ready` at
 * "0" until every one has loaded or failed (or ~5 s pass). It carries
 * `data-plan-figure` because that is the selector the set's Print button
 * waits on — every figure that loads images joins the same wait.
 */
export default function RiserSheetFigure({ hrefs, children }: { hrefs: string[]; children: ReactNode }) {
  const ready = useImagesSettled(hrefs);
  return (
    <div data-plan-figure="" data-riser-figure="" data-ready={ready ? "1" : "0"} style={{ height: "100%" }}>
      {children}
    </div>
  );
}
