import type { CSSProperties, ReactNode } from "react";
import { useMemo, useState } from "react";

import type { Chat } from "../core/hooks";
import { PALETTES, useUiSettings } from "../theme/store";
import { UpdateChecker } from "./UpdateChecker";
import { Menu } from "./Menu";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ComposeIcon,
  EditIcon,
  PlusIcon,
  SearchIcon,
  SubagentIcon,
} from "./icons";

const trim = (text: string, max = 30) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const PLACEHOLDER_AGENTS = [
  { id: "agent-docs", title: "文档助手（占位）" },
  { id: "agent-review", title: "代码审阅（占位）" },
];

function GroupHeader({
  icon,
  label,
  collapsed,
  onToggle,
  onAdd,
}: {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="group/project flex h-8 w-full items-center gap-1.5 rounded-[7px] px-1.5 text-ui-135 text-ink-2">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-ink" onClick={onToggle}>
        <span className="shrink-0 text-ink-dim">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex w-3.5 shrink-0 items-center justify-center text-ink-faint">
          {collapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
        </span>
      </button>
      <button
        type="button"
        className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity group-hover/project:opacity-100"
        onClick={onAdd}
        aria-label={`${label}新建`}
      >
        <PlusIcon size={13} />
      </button>
    </div>
  );
}

export function SideBar({
  chat,
  onOpenSettings,
  onOpenPrefs,
}: {
  chat: Chat;
  onOpenSettings: () => void;
  onOpenPrefs: () => void;
}) {
  const ui = useUiSettings();
  const [query, setQuery] = useState("");
  const [dailyOpen, setDailyOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(false);

  const sessions = chat.sessions;
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(keyword));
  }, [query, sessions]);

  const palette = PALETTES.find((item) => item.id === ui.palette);

  return (
    <aside
      className="sidebar fade-rule-v"
      style={{ "--sidebar-render-width": "240px" } as CSSProperties}
      aria-label="侧栏"
    >
      <div className="sidebar-inner">
        <div className="flex shrink-0 flex-col gap-1 px-2.5 pt-2.5 pb-2">
          <button
            type="button"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-ui-14 font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            onClick={() => chat.reset()}
          >
            <EditIcon size={17} className="shrink-0" />
            <span>新建会话</span>
          </button>
          <button
            type="button"
            disabled
            title="智能体功能开发中"
            className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-ui-14 font-medium text-ink-faint"
          >
            <SubagentIcon size={17} className="shrink-0" />
            <span>新建智能体</span>
          </button>
          <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-hover px-2">
            <SearchIcon size={13} className="shrink-0 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题或会话 ID"
              className="min-w-0 flex-1 bg-transparent text-ui-13 text-ink-2 outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
        </div>

        <div className="edge-fade min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pt-0.5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="mb-2">
            <GroupHeader
              icon={<SubagentIcon size={13} />}
              label="智能体对话"
              collapsed={!agentsOpen}
              onToggle={() => setAgentsOpen((value) => !value)}
              onAdd={() => undefined}
            />
            {agentsOpen ? (
              <div className="pl-1">
                {PLACEHOLDER_AGENTS.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    disabled
                    title="智能体功能开发中"
                    className="flex h-[31px] w-full items-center rounded-[7px] px-1.5 text-left text-ui-135 text-ink-faint"
                  >
                    <span className="min-w-0 flex-1 truncate">{agent.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div>
            <GroupHeader
              icon={<ComposeIcon size={13} />}
              label="日常"
              collapsed={!dailyOpen}
              onToggle={() => setDailyOpen((value) => !value)}
              onAdd={() => chat.reset()}
            />
            {dailyOpen ? (
              <div className="pl-1">
                {filtered.length > 0 ? (
                  filtered.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => void chat.openSession(session.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void chat.deleteSession(session.id);
                      }}
                      className={`flex h-[31px] w-full items-center gap-2 rounded-[7px] px-1.5 text-left text-ui-135 ${
                        session.id === chat.sessionId
                          ? "bg-bubble font-medium text-ink"
                          : "text-ink-dim hover:bg-hover hover:text-ink"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{trim(session.title)}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-1.5 py-6 text-center text-ui-12 text-ink-faint">
                    {query.trim() ? "没有匹配的会话" : "暂无会话"}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-px border-t-[0.5px] border-border p-2">
          <p className="px-2 pb-1 text-ui-11 text-ink-faint">智能体</p>
          <p className="px-2 pb-2 text-ui-12 text-ink-faint">工具与项目入口将放在这里。</p>
          <Menu
            align="left"
            placement="up"
            trigger={({ toggle }) => (
              <button
                type="button"
                className="flex h-10 w-full items-center gap-2 rounded-[7px] px-2 text-left hover:bg-hover"
                onClick={toggle}
                aria-label="账户菜单"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-ui-12 font-semibold text-on-accent">
                  L
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-135 font-medium text-ink">Lumine 用户</span>
                  <span className="block truncate text-ui-11 text-ink-faint">本地工作区</span>
                </span>
              </button>
            )}
          >
            {({ close }) => (
              <div className="flex w-[240px] flex-col gap-px p-1">
                <div className="flex items-center gap-2 rounded-lg px-2 py-2">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-ui-13 font-semibold text-on-accent">
                    L
                  </span>
                  <span>
                    <span className="block text-ui-13 font-medium text-ink">Lumine 用户</span>
                    <span className="block text-ui-11 text-ink-faint">{palette?.name ?? "Percho"} · 本地</span>
                  </span>
                </div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-ui-13 text-ink-2 hover:bg-hover"
                  onClick={() => {
                    close();
                    onOpenPrefs();
                  }}
                >
                  <span>设置</span>
                  <span className="text-ui-11 text-ink-faint">Ctrl+,</span>
                </button>
                <Menu
                  align="left"
                  placement="up"
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      className="flex w-full rounded-lg px-2.5 py-2 text-left text-ui-13 text-ink-2 hover:bg-hover"
                      onClick={toggle}
                    >
                      外观
                    </button>
                  )}
                >
                  {({ close: closeSub }) => (
                    <div className="flex flex-col">
                      {(["light", "dark", "system"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className="rounded-lg px-2.5 py-1.5 text-left text-ui-13 text-ink-2 hover:bg-hover"
                          onClick={() => {
                            ui.setMode(mode);
                            closeSub();
                          }}
                        >
                          {mode === "light" ? "亮色" : mode === "dark" ? "暗色" : "跟随系统"}
                        </button>
                      ))}
                    </div>
                  )}
                </Menu>
                <div className="px-2.5 py-1">
                  <UpdateChecker />
                </div>
                <a
                  className="rounded-lg px-2.5 py-2 text-ui-13 text-ink-2 hover:bg-hover"
                  href="https://github.com/vesperadev/LumineAgent/issues/new"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => close()}
                >
                  意见反馈
                </a>
                <button
                  type="button"
                  className="rounded-lg px-2.5 py-2 text-left text-ui-13 text-ink-2 hover:bg-hover"
                  onClick={() => {
                    close();
                    onOpenPrefs();
                  }}
                >
                  关于
                  <span className="ml-2 text-ui-11 text-ink-faint">0.1.0</span>
                </button>
                <button type="button" className="hidden" onClick={onOpenSettings} aria-hidden="true" />
              </div>
            )}
          </Menu>
        </div>
      </div>
    </aside>
  );
}
