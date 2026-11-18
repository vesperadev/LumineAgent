import type { CSSProperties, ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 轻量弹层：只做「点外部关闭 + Esc 关闭 + 上下定位」，不引入浮层库。
 * 几何对齐 Percho 的 Dropdown：bg-surface、12px 圆角、shadow-pop、0.5px 描边。
 * `portal`：挂到 body，避免被 `.sidebar { overflow: hidden }` 裁掉（账户菜单要盖住中间栏）。
 */
export function Menu({
  trigger,
  children,
  align = "left",
  placement = "up",
  portal = false,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (props: { close: () => void }) => ReactNode;
  align?: "left" | "right";
  placement?: "up" | "down";
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [fixedStyle, setFixedStyle] = useState<CSSProperties>({});

  const place = () => {
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next: CSSProperties = {};
    if (align === "right") {
      next.right = `${window.innerWidth - rect.right}px`;
    } else {
      next.left = `${rect.left}px`;
    }
    if (placement === "up") {
      next.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      next.top = `${rect.bottom + 6}px`;
    }
    setFixedStyle(next);
  };

  useLayoutEffect(() => {
    if (!open || !portal) return;
    place();
  }, [open, portal, align, placement]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    if (portal) {
      window.addEventListener("resize", place);
      window.addEventListener("scroll", place, true);
    }
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, portal]);

  const panel = open ? (
    <div
      ref={panelRef}
      role="menu"
      style={portal ? fixedStyle : undefined}
      className={`${
        portal ? "fixed z-[80] min-w-[360px]" : "absolute z-30 min-w-[220px]"
      } overflow-hidden rounded-xl border-[0.5px] border-border bg-surface p-1 shadow-pop ${
        portal
          ? ""
          : `${align === "right" ? "right-0" : "left-0"} ${
              placement === "up" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"
            }`
      }`}
    >
      {children({ close: () => setOpen(false) })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {portal && typeof document !== "undefined" && panel ? createPortal(panel, document.body) : panel}
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
