import type { Chat } from "../core/hooks";
import { useUiSettings } from "../theme/store";
import { DiffIcon, GearIcon, MoonIcon, PanelLeftIcon, PlusIcon, SunIcon } from "./icons";
import { WindowControls } from "./WindowControls";

const trim = (text: string, max = 20) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/**
 * 顶栏（48px）：左栏开合 + 会话胶囊 + 新建 + 变更侧栏 + 设置。
 * 结构照 Percho 的 SessionTabBar；主题切换只是开发便利，面板里有完整入口。
 */
export function SessionTabBar({
  chat,
  onToggleSidebar,
  onOpenSettings,
  diffOpen,
  onToggleDiff,
}: {
  chat: Chat;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  diffOpen: boolean;
  onToggleDiff: () => void;
}) {
  const ui = useUiSettings();
  const sessions = chat.sessions;
  const activeId = chat.sessionId;

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 bg-canvas pl-3 pr-3" data-tauri-drag-region="deep">
      {/* data-tauri-drag-region="deep"：Tauri 2.12 下 bare 属性只对 div 自身直接点击生效，
          顶栏可见区域几乎都是子元素（胶囊/按钮/gap），必须用 deep 才能让整条顶栏可拖拽。
          BUTTON 等交互元素由 Tauri drag.js 自动排除，不会被误拖。 */}
      <button
        type="button"
        className="no-drag shrink-0 rounded-lg bg-hover p-1.5 text-ink transition-colors hover:bg-border"
        onClick={onToggleSidebar}
        aria-label={ui.sidebarCollapsed ? "展开左栏" : "收起左栏"}
      >
        <PanelLeftIcon size={16} />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sessions.slice(-3).map((session) => (
          <div key={session.id} className="min-w-24 max-w-52 flex-1">
            <button
              type="button"
              onClick={() => void chat.openSession(session.id)}
              className={`no-drag flex w-full cursor-pointer items-center gap-2 rounded-full px-2.5 py-1.5 text-ui-14 leading-[calc(1.25_/_0.875)] ${
                session.id === activeId
                  ? "bg-bubble text-ink"
                  : "text-ink-dim hover:bg-hover hover:text-ink"
              }`}
            >
              <span
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink-faint text-ui-10 font-semibold text-on-ink"
                aria-hidden="true"
              >
                L
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{trim(session.title)}</span>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="no-drag shrink-0 rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        onClick={() => void chat.reset()}
        aria-label="新会话"
        title="新会话"
      >
        <PlusIcon size={18} />
      </button>
      <button
        type="button"
        className="no-drag shrink-0 rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        onClick={() => ui.setMode(ui.resolvedMode === "light" ? "dark" : "light")}
        aria-label="切换亮暗"
        title="切换亮暗"
      >
        {ui.resolvedMode === "light" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      </button>
      <button
        type="button"
        data-diff-toggle=""
        className={`no-drag relative shrink-0 rounded-lg p-1.5 transition-colors ${
          diffOpen ? "bg-hover text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
        }`}
        aria-label={diffOpen ? "关闭变更侧栏" : "打开变更侧栏"}
        aria-pressed={diffOpen}
        title="变更侧栏"
        onClick={onToggleDiff}
      >
        <DiffIcon size={16} />
      </button>
      <button
        type="button"
        className="no-drag shrink-0 rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        onClick={onOpenSettings}
        aria-label="设置"
        title="设置"
      >
        <GearIcon size={15} />
      </button>
      {/* 壳层窗口控制：仅桌面渲染（web 下返回 null），-mr-3 抵消顶栏右内边距让按钮贴住窗口右缘 */}
      <WindowControls />
    </div>
  );
}
