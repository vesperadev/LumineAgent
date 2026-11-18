import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUiSettings } from "../theme/store";

const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 壳层窗口控制（仅桌面渲染）：Percho Windows 版用系统 titleBarOverlay，
 * Tauri 2 无对应能力，这里自绘最小化/最大化/关闭。
 * 三个图形不属于 Percho ui/icons 基线（基线里不存在系统窗口按钮），就地内联，不进 ui/icons/。
 */
export function WindowControls() {
  if (!inTauri()) return null;
  return <WindowControlsDesktop />;
}

function WindowControlsDesktop() {
  const ui = useUiSettings();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => {});
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    // 窗口底色跟随主题，避免暗色模式下出现异色边（Percho applyChromeTheme 的等价物）
    void win.setBackgroundColor(ui.resolvedMode === "dark" ? "#17171a" : "#fafafa").catch(() => {});
    return () => unlisten?.();
  }, [ui.resolvedMode]);

  const buttonClass =
    "no-drag grid h-12 w-11 shrink-0 place-items-center text-ink-dim transition-colors hover:bg-hover hover:text-ink";

  return (
    <div className="-mr-3 flex h-12 shrink-0">
      <button
        type="button"
        className={buttonClass}
        onClick={() => void getCurrentWindow().minimize()}
        aria-label="最小化"
        title="最小化"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => void getCurrentWindow().toggleMaximize()}
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2.5 2.5V1h6.5v6.5H7M1 3.5h6.5V9H1z" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className={buttonClass}
        onClick={() => void getCurrentWindow().close()}
        aria-label="关闭"
        title="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}