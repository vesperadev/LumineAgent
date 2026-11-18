import { useEffect, useRef, useState } from "react";

import { useChat } from "./core/hooks";
import { useUiSettings } from "./theme/store";
import { ApprovalDock } from "./ui/ApprovalDock";
import { Composer } from "./ui/Composer";
import { DiffSidebar } from "./ui/DiffSidebar";
import { EmptyState } from "./ui/EmptyState";
import { PrefsModal } from "./ui/PrefsModal";
import { SettingsPanel } from "./ui/SettingsPanel";
import { SessionTabBar } from "./ui/SessionTabBar";
import { SideBar } from "./ui/SideBar";
import { Thread } from "./ui/Thread";

const DEMO_TEXT = "把 src/main.py 里的占位实现补完";

export function App() {
  const chat = useChat();
  const ui = useUiSettings();
  const params = new URLSearchParams(window.location.search);
  const [settingsOpen, setSettingsOpen] = useState(params.has("settings"));
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(params.has("diff"));

  const demoStarted = useRef(false);
  const demo = params.has("demo");

  useEffect(() => {
    if (!demoStarted.current && demo) {
      demoStarted.current = true;
      void chat.send(DEMO_TEXT);
    }
  }, [demo, chat]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setPrefsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
          diffOpen={diffOpen}
          onToggleDiff={() => setDiffOpen((open) => !open)}
        />
        <div className="relative flex min-h-0 flex-1">
          {ui.sidebarCollapsed ? null : (
            <SideBar
              chat={chat}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenPrefs={() => setPrefsOpen(true)}
            />
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1">
              {empty ? <EmptyState chat={chat} /> : <Thread chat={chat} />}
            </main>
            {empty ? null : <ApprovalDock chat={chat} />}
            {empty ? null : <Composer chat={chat} />}
          </div>
          <DiffSidebar open={diffOpen} onClose={() => setDiffOpen(false)} />
        </div>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PrefsModal open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
