import type { CSSProperties, ReactNode } from "react";

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <svg {...base} style={style} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** 任务：竖列三段（对齐侧栏首项） */
export const TasksIcon = () => (
  <Glyph>
    <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
    <path d="M4.5 6h7M4.5 9h4.5" />
  </Glyph>
);

/** 自动化：循环箭头 */
export const AutomationIcon = () => (
  <Glyph>
    <path d="M13 6.5A5.2 5.2 0 0 0 4.2 4.6" />
    <path d="M3 3v3.2h3.2" />
    <path d="M3 9.5A5.2 5.2 0 0 0 11.8 11.4" />
    <path d="M13 13v-3.2h-3.2" />
  </Glyph>
);

/** 伙伴：圆环 + 内点 */
export const BuddyIcon = () => (
  <Glyph>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.8" />
  </Glyph>
);

/** 插件：四个方块 */
export const PluginIcon = () => (
  <Glyph>
    <rect x="2.6" y="2.6" width="4.6" height="4.6" rx="1" />
    <rect x="8.8" y="2.6" width="4.6" height="4.6" rx="1" />
    <rect x="2.6" y="8.8" width="4.6" height="4.6" rx="1" />
    <rect x="8.8" y="8.8" width="4.6" height="4.6" rx="1" />
  </Glyph>
);

/** 设置：滑杆 */
export const SettingsIcon = () => (
  <Glyph>
    <path d="M2.5 5h11M2.5 11h11" />
    <circle cx="6" cy="5" r="1.7" />
    <circle cx="10" cy="11" r="1.7" />
  </Glyph>
);

export const ChevronDownIcon = ({ open = true }: { open?: boolean }) => (
  <Glyph style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 120ms ease" }}>
    <path d="M5.5 6.5 8 9l2.5-2.5" />
  </Glyph>
);

export const SearchIcon = () => (
  <Glyph>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.4 13.4" />
  </Glyph>
);

export const PlusIcon = () => (
  <Glyph>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Glyph>
);

export const ArrowUpIcon = () => (
  <Glyph>
    <path d="M8 13V3.4M3.8 7.6 8 3.4l4.2 4.2" />
  </Glyph>
);

export const ArrowDownIcon = () => (
  <Glyph>
    <path d="M8 3v9.6M3.8 8.4 8 12.6l4.2-4.2" />
  </Glyph>
);

export const LockIcon = () => (
  <Glyph>
    <rect x="3.4" y="7" width="9.2" height="6.2" rx="1.4" />
    <path d="M5.8 7V5.3a2.2 2.2 0 0 1 4.4 0V7" />
  </Glyph>
);

export const StopIcon = () => (
  <Glyph>
    <rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2" />
  </Glyph>
);

export const CheckIcon = () => (
  <Glyph>
    <path d="M3.4 8.4 6.4 11.4 12.6 4.9" />
  </Glyph>
);

export const ChevronRightIcon = () => (
  <Glyph>
    <path d="M6.5 3.8 10.7 8l-4.2 4.2" />
  </Glyph>
);

export const CopyIcon = () => (
  <Glyph>
    <rect x="5.4" y="5.4" width="8" height="8" rx="1.4" />
    <path d="M10.4 5.4V3.9a1.4 1.4 0 0 0-1.4-1.4H3.9A1.4 1.4 0 0 0 2.5 3.9v5.1a1.4 1.4 0 0 0 1.4 1.4h1.5" />
  </Glyph>
);

export const RefreshIcon = () => (
  <Glyph>
    <path d="M13 8.6A5 5 0 0 1 4.4 11.3" />
    <path d="M2.9 13l1.5-1.7 1.7 1.5" />
    <path d="M3 7.4A5 5 0 0 1 11.6 4.7" />
    <path d="M13.1 3l-1.5 1.7-1.7-1.5" />
  </Glyph>
);

export const PanelIcon = () => (
  <Glyph>
    <rect x="2.4" y="3" width="11.2" height="10" rx="1.6" />
    <path d="M10.4 3v10" />
  </Glyph>
);

export const EditIcon = () => (
  <Glyph>
    <path d="M11.4 2.7 13.3 4.6 5.6 12.3 2.9 13.1 3.7 10.4z" />
  </Glyph>
);

export const TuneIcon = () => (
  <Glyph>
    <path d="M2.5 4.5h11M2.5 11.5h11" />
    <circle cx="5.6" cy="4.5" r="1.5" />
    <circle cx="10.4" cy="11.5" r="1.5" />
  </Glyph>
);

export const SpinnerRing = () => (
  <span className="spinner" data-active="true" />
);
