import type { CSSProperties, ReactNode } from "react";
import { sheetCssVars, type SheetSizeKey, type TitleBlockData } from "@/lib/design/grid-drawing-set";
import { TitleBlock } from "./title-block";

/**
 * One drawing-set sheet (#209): exact paper size (11×17 or 24×36), border
 * frame, drawing area on the left, title strip on the right. Geometry comes
 * from grid-drawing-set's size table via CSS variables, never literals here.
 * Server-renderable (no "use client").
 */
export function DrawingSheet({
  size,
  titleBlock,
  children,
}: {
  size: SheetSizeKey;
  titleBlock: TitleBlockData;
  children: ReactNode;
}) {
  return (
    <section
      className="pk-drawing-sheet"
      data-size={size}
      data-sheet={titleBlock.sheet.number}
      style={sheetCssVars(size) as CSSProperties}
    >
      <div className="pk-drawing-frame">
        <div className="pk-drawing-area">{children}</div>
        <TitleBlock data={titleBlock} />
      </div>
    </section>
  );
}
