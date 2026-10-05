/**
 * The Grid toolbar's icon set (#299) — small inline SVGs, 16px, drawn in
 * currentColor so a button's text colour (and its disabled state) carries
 * through. No icon library in this app; each icon is a few path elements.
 */

type IconProps = { size?: number };

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconSelect = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 2.5 L3.5 12.5 L6.2 9.9 L8.2 14 L9.8 13.2 L7.8 9.2 L11.5 9.2 Z" />
  </Svg>
);

export const IconPlace = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
    <path d="M8 5.2 V10.8 M5.2 8 H10.8" />
  </Svg>
);

export const IconWire = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12.5 L6 5 L10 10.5 L14 3.5" />
    <circle cx="2" cy="12.5" r="0.6" />
    <circle cx="14" cy="3.5" r="0.6" />
  </Svg>
);

export const IconSpace = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4 L9.5 2.5 L13.5 7 L11 13.5 L3.5 12 Z" />
  </Svg>
);

export const IconCalibrate = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.8 10.2 L10.2 1.8 L14.2 5.8 L5.8 14.2 Z" />
    <path d="M5 7 L6.4 8.4 M7 5 L8.4 6.4 M9 3 L10.4 4.4" />
  </Svg>
);

export const IconPan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8.5 V4 a1 1 0 0 1 2 0 V7.5 V3 a1 1 0 0 1 2 0 V7.5 V4 a1 1 0 0 1 2 0 V8" />
    <path d="M11 6.5 a1 1 0 0 1 2 0 V10 a4 4 0 0 1 -4 4 H8.4 a4 4 0 0 1 -3.2 -1.6 L3 9.5 a1 1 0 0 1 1.6 -1.2 L5 8.8" />
  </Svg>
);

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 3.5 L2.5 6.5 L5.5 9.5" />
    <path d="M2.5 6.5 H10 a3.5 3.5 0 0 1 0 7 H7" />
  </Svg>
);

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.5 3.5 L13.5 6.5 L10.5 9.5" />
    <path d="M13.5 6.5 H6 a3.5 3.5 0 0 0 0 7 H9" />
  </Svg>
);

export const IconCut = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.5" cy="11.5" r="2" />
    <circle cx="11.5" cy="11.5" r="2" />
    <path d="M6 10 L12 2.5 M10 10 L4 2.5" />
  </Svg>
);

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" />
    <path d="M10.5 5.5 V3.8 a1.3 1.3 0 0 0 -1.3 -1.3 H3.8 a1.3 1.3 0 0 0 -1.3 1.3 V9.2 a1.3 1.3 0 0 0 1.3 1.3 H5.5" />
  </Svg>
);

export const IconPaste = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="10" height="11" rx="1.3" />
    <rect x="5.5" y="1.8" width="5" height="2.6" rx="0.8" />
    <path d="M5.5 8 H10.5 M5.5 10.8 H9" />
  </Svg>
);

export const IconDuplicate = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="8" height="8" rx="1.3" />
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" />
    <path d="M9.5 8 V11 M8 9.5 H11" />
  </Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5 H13.5 M6 4.5 V2.8 H10 V4.5" />
    <path d="M4 4.5 L4.8 13.5 H11.2 L12 4.5" />
    <path d="M6.7 7 V11 M9.3 7 V11" />
  </Svg>
);

export const IconAlignLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 2 V14" />
    <rect x="4.5" y="3.5" width="8" height="3" rx="0.6" />
    <rect x="4.5" y="9.5" width="5" height="3" rx="0.6" />
  </Svg>
);

export const IconAlignCenter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2 V14" />
    <rect x="3.5" y="3.5" width="9" height="3" rx="0.6" />
    <rect x="5" y="9.5" width="6" height="3" rx="0.6" />
  </Svg>
);

export const IconAlignRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 2 V14" />
    <rect x="3.5" y="3.5" width="8" height="3" rx="0.6" />
    <rect x="6.5" y="9.5" width="5" height="3" rx="0.6" />
  </Svg>
);

export const IconAlignTop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2.5 H14" />
    <rect x="3.5" y="4.5" width="3" height="8" rx="0.6" />
    <rect x="9.5" y="4.5" width="3" height="5" rx="0.6" />
  </Svg>
);

export const IconAlignMiddle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 8 H14" />
    <rect x="3.5" y="3.5" width="3" height="9" rx="0.6" />
    <rect x="9.5" y="5" width="3" height="6" rx="0.6" />
  </Svg>
);

export const IconAlignBottom = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 13.5 H14" />
    <rect x="3.5" y="3.5" width="3" height="8" rx="0.6" />
    <rect x="9.5" y="6.5" width="3" height="5" rx="0.6" />
  </Svg>
);

export const IconDistributeH = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2 V14 M14 2 V14" />
    <rect x="6.5" y="4.5" width="3" height="7" rx="0.6" />
  </Svg>
);

export const IconDistributeV = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2 H14 M2 14 H14" />
    <rect x="4.5" y="6.5" width="7" height="3" rx="0.6" />
  </Svg>
);

export const IconZoomIn = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4 L14 14 M5 7 H9 M7 5 V9" />
  </Svg>
);

export const IconZoomOut = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4 L14 14 M5 7 H9" />
  </Svg>
);

export const IconFit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 6 V2.5 H6 M10 2.5 H13.5 V6 M13.5 10 V13.5 H10 M6 13.5 H2.5 V10" />
  </Svg>
);

export const IconSnap = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.5" cy="3.5" r="0.7" />
    <circle cx="8" cy="3.5" r="0.7" />
    <circle cx="12.5" cy="3.5" r="0.7" />
    <circle cx="3.5" cy="8" r="0.7" />
    <circle cx="8" cy="8" r="0.7" />
    <circle cx="12.5" cy="8" r="0.7" />
    <circle cx="3.5" cy="12.5" r="0.7" />
    <circle cx="8" cy="12.5" r="0.7" />
    <circle cx="12.5" cy="12.5" r="0.7" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6 L8 10 L12 6" />
  </Svg>
);
