import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { PALETTES, WALLPAPERS, useUiSettings } from "../theme/store";
import { CloseIcon } from "./icons";
import { UpdateChecker } from "./UpdateChecker";

type SectionId = "general" | "appearance" | "about" | "security";

const NAV: { id: SectionId; group: string; label: string }[] = [
  { id: "general", group: "通用", label: "通用" },
  { id: "appearance", group: "通用", label: "外观" },
  { id: "security", group: "数据与安全", label: "密钥" },
  { id: "about", group: "数据与安全", label: "关于" },
];

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 左下角菜单打开的悬浮设置窗口（与右上角 SettingsPanel 独立） */
export function PrefsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUiSettings();
  const [section, setSection] = useState<SectionId>("appearance");
  const [query, setQuery] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = NAV.filter((item) => item.label.includes(query.trim()) || query.trim() === "");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgb(var(--color-scrim)_/_0.18)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="设置"
        className="fixed inset-0 z-50 m-auto flex h-[min(640px,80vh)] w-[min(840px,92vw)] overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface shadow-dialog"
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r-[0.5px] border-border bg-canvas p-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索设置"
            className="mb-3 h-8 rounded-lg bg-hover px-2 text-ui-13 text-ink outline-none placeholder:text-ink-faint"
          />
          <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {["通用", "数据与安全"].map((group) => (
              <div key={group}>
                <p className="px-1.5 pb-1 text-ui-11 text-ink-faint">{group}</p>
                {filtered
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSection(item.id)}
                      className={`flex h-8 w-full items-center rounded-[7px] px-2 text-left text-ui-135 ${
                        section === item.id ? "bg-bubble font-medium text-ink" : "text-ink-dim hover:bg-hover hover:text-ink"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center justify-between border-b-[0.5px] border-border px-4">
            <span className="text-ui-14 font-medium text-ink">
              {NAV.find((item) => item.id === section)?.label}
            </span>
            <button type="button" className="rounded-lg p-1.5 text-ink-dim hover:bg-hover hover:text-ink" onClick={onClose} aria-label="关闭">
              <CloseIcon size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {section === "general" ? (
              <p className="text-ui-13 text-ink-dim">通用项将在后续版本加入。当前可在「外观」调整主题与字号。</p>
            ) : null}
            {section === "appearance" ? (
              <div className="flex flex-col gap-4">
                <div className="flex gap-1.5">
                  {(["light", "dark", "system"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => ui.setMode(mode)}
                      className={`rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 ${
                        ui.mode === mode ? "border-accent bg-accent-soft text-ink" : "border-border text-ink-dim"
                      }`}
                    >
                      {mode === "light" ? "亮" : mode === "dark" ? "暗" : "系统"}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {PALETTES.map((palette) => (
                    <button
                      key={palette.id}
                      type="button"
                      title={palette.hint}
                      onClick={() => ui.setPalette(palette.id)}
                      className={`rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 ${
                        ui.palette === palette.id ? "border-accent text-ink" : "border-border text-ink-dim"
                      }`}
                    >
                      {palette.name}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {WALLPAPERS.map((wallpaper) => (
                    <button
                      key={wallpaper.id}
                      type="button"
                      onClick={() => ui.setWallpaper(wallpaper.id)}
                      className={`rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 ${
                        ui.wallpaper === wallpaper.id ? "border-accent text-ink" : "border-border text-ink-dim"
                      }`}
                    >
                      {wallpaper.name}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-ui-13 text-ink-dim">
                  壁纸强度
                  <input
                    type="range"
                    min={0.15}
                    max={1}
                    step={0.05}
                    value={ui.wallpaperOpacity}
                    onChange={(event) => ui.setWallpaperOpacity(Number(event.target.value))}
                  />
                </label>
                <div className="flex gap-1.5">
                  {(["90", "100", "110"] as const).map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      onClick={() => ui.setFontScale(scale)}
                      className={`rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 ${
                        ui.fontScale === scale ? "border-accent text-ink" : "border-border text-ink-dim"
                      }`}
                    >
                      {scale}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {section === "security" ? (
              <div className="flex flex-col gap-3">
                <p className="text-ui-13 text-ink-dim">
                  密钥只写到本机 `%LOCALAPPDATA%/LumineAgent/secrets.env`，不会进仓库。留空保存即清除。
                </p>
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  placeholder="DEEPSEEK API Key"
                  className="h-9 rounded-lg border-[0.5px] border-border bg-canvas px-2 text-ui-13 text-ink outline-none"
                />
                <button
                  type="button"
                  className="w-fit rounded-lg bg-accent px-3 py-1.5 text-ui-13 text-on-accent disabled:opacity-40"
                  disabled={!inTauri()}
                  onClick={() => {
                    void invoke("save_api_key", { key: keyDraft })
                      .then(() => setKeySaved("已保存，下次拉起后端时生效"))
                      .catch(() => setKeySaved("保存失败（仅桌面端可用）"));
                  }}
                >
                  保存
                </button>
                {keySaved ? <p className="text-ui-12 text-ink-dim">{keySaved}</p> : null}
                {!inTauri() ? <p className="text-ui-12 text-ink-faint">Web 模式请继续用项目目录下的 .env。</p> : null}
              </div>
            ) : null}
            {section === "about" ? (
              <div className="flex flex-col gap-3 text-ui-13 text-ink-dim">
                <p>LumineAgent 0.1.0 · 界面基线 Percho（MIT）</p>
                <UpdateChecker />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
