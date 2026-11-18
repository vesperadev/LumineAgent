import { PlusIcon, SearchIcon, SettingsIcon, PanelIcon } from "./icons";

type Theme = "light" | "dark";

/** 顶部条：品牌 + 菜单 + 主题/设置，对齐 Percho 的极简窗口头 */
export function TitleBar({ onToggleTheme }: { theme?: Theme; onToggleTheme: () => void }) {
  return (
    <header className="titlebar">
      <span className="brand">
        <span className="brand-mark" />
        LumineAgent
      </span>
      <button type="button" className="menu-item">
        文件
      </button>
      <button type="button" className="menu-item">
        视图
      </button>
      <button type="button" className="menu-item">
        帮助
      </button>
      <span className="titlebar-spacer" />
      <button type="button" className="icon-button" title="切换主题" onClick={onToggleTheme}>
        <PanelIcon />
      </button>
      <button type="button" className="icon-button" title="设置">
        <SettingsIcon />
      </button>
    </header>
  );
}

/** 会话头右侧的视图动作 */
export function RegionActions({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="main-actions">
      <button type="button" className="icon-button" title="搜索会话">
        <SearchIcon />
      </button>
      <button type="button" className="icon-button" title="新建会话" onClick={onNewChat}>
        <PlusIcon />
      </button>
    </div>
  );
}
