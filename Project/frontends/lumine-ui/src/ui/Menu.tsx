import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * 轻量弹层：只做「点外部关闭 + Esc 关闭 + 上下定位」，不引入浮层库。
 * 几何对齐 Percho 的 Dropdown：bg-surface、12px 圆角、shadow-pop、0.5px 描边。
 */
export function Menu({
  trigger,
  children,
  align = "left",
  placement = "up",
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "left" | "right";
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div
          role="menu"
          className={`absolute z-30 min-w-[220px] overflow-hidden rounded-xl border-[0.5px] border-border bg-surface p-1 shadow-pop ${
            align === "right" ? "right-0" : "left-0"
          } ${placement === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"}`}
        >
          {children({ close: () => setOpen(false) })}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  label,
  hint,
  active = false,
  onClick,
}: {
  label: ReactNode;
  hint?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover"
    >
      <span className="flex-1">
        <span className={`block text-ui-13 ${active ? "font-medium text-ink" : "text-ink-2"}`}>{label}</span>
        {hint ? <span className="mt-0.5 block text-ui-11 leading-relaxed text-ink-faint">{hint}</span> : null}
      </span>
      {active ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" /> : null}
    </button>
  );
}
