import { useEffect, useRef, useState } from "react";

import { useChat } from "./core/hooks";
import { useUiSettings } from "./theme/store";
import { Composer } from "./ui/Composer";
import { EmptyState } from "./ui/EmptyState";
import { SettingsPanel } from "./ui/SettingsPanel";
import { SessionTabBar } from "./ui/SessionTabBar";
import { SideBar } from "./ui/SideBar";
import { Thread } from "./ui/Thread";

/** 开发期演示：?demo=1 自动发一条，用于核对有消息时的排版 */
const DEMO_TEXT = "把 src/main.py 里的占位实现补完";

export function App() {
  const chat = useChat();
  const ui = useUiSettings();
  const params = new URLSearchParams(window.location.search);
  const [settingsOpen, setSettingsOpen] = useState(params.has("settings"));

  const demoStarted = useRef(false);
  const demo = params.has("demo");

  useEffect(() => {
    if (!demoStarted.current && demo) {
      demoStarted.current = true;
      void chat.send(DEMO_TEXT);
    }
  }, [demo, chat]);

  // 开发期直接用查询串验主题：?palette=sand&mode=dark&wallpaper=linen
  useEffect(() => {
    const palette = params.get("palette");
    const mode = params.get("mode");
    const wallpaper = params.get("wallpaper");
    if (palette === "sand" || palette === "slate" || palette === "forest" || palette === "rose") {
      ui.setPalette(palette);
    }
    if (mode === "dark" || mode === "light" || mode === "system") ui.setMode(mode);
    if (wallpaper === "linen" || wallpaper === "grid" || wallpaper === "aurora" || wallpaper === "none") {
      ui.setWallpaper(wallpaper);
    }
    // 只在挂载时读一次，避免与用户在面板里的选择互相覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const empty = chat.messages.length === 0;

  return (
    <div className="relative h-full">
      <div className="wallpaper-layer" aria-hidden="true" />

      <div className="relative z-10 flex h-full flex-col">
        <SessionTabBar
          chat={chat}
          onToggleSidebar={ui.toggleSidebar}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="relative flex min-h-0 flex-1">
          {ui.sidebarCollapsed ? null : <SideBar chat={chat} onOpenSettings={() => setSettingsOpen(true)} />}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              {empty ? <EmptyState chat={chat} /> : <Thread chat={chat} />}
            </main>
            {empty ? null : <Composer chat={chat} />}
          </div>
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
