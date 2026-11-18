import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type { Chat } from "../core/hooks";
import { ChevronDownIcon, ComposeIcon, EditIcon, GearIcon, PlusIcon, SearchIcon } from "./icons";

const trim = (text: string, max = 30) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/** 左栏：新建会话 + 搜索 + 「日常」分组 + 会话行（31px）+ 底部设置入口 */
export function SideBar({ chat, onOpenSettings }: { chat: Chat; onOpenSettings: () => void }) {
  const [query, setQuery] = useState("");
  const sessions = chat.messages.filter((message) => message.role === "user");
  const activeId = sessions.at(-1)?.id;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const list = sessions.slice().reverse();
    if (!keyword) return list;
    return list.filter((session) => session.text.toLowerCase().includes(keyword));
  }, [query, sessions]);

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
          <div className="group/project">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-1.5 rounded-[7px] px-1.5 text-ui-135 text-ink-2 transition-colors hover:bg-hover hover:text-ink"
            >
              <span className="flex w-3.5 shrink-0 items-center justify-center text-ink-faint">
                <ChevronDownIcon size={12} />
              </span>
              <ComposeIcon size={13} className="shrink-0 text-ink-dim" />
              <span className="min-w-0 flex-1 truncate text-left">日常</span>
              <span className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity group-hover/project:opacity-100">
                <PlusIcon size={13} />
              </span>
            </button>

            <div className="pl-1">
              {filtered.length > 0 ? (
                filtered.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`flex h-[31px] w-full items-center gap-2 rounded-[7px] px-1.5 text-left text-ui-135 ${
                      session.id === activeId ? "bg-bubble font-medium text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{trim(session.text)}</span>
                  </button>
                ))
              ) : (
                <p className="px-1.5 py-6 text-center text-ui-12 text-ink-faint">
                  {query.trim() ? "没有匹配的会话" : "暂无会话"}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-px p-2">
          <button
            type="button"
            className="flex h-8 w-full items-center gap-[9px] rounded-[7px] px-2 text-ui-135 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
            onClick={onOpenSettings}
          >
            <GearIcon size={14} />
            <span>设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
