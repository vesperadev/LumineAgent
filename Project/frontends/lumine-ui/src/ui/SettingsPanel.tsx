import { useEffect } from "react";

import { PALETTES, WALLPAPERS, useUiSettings } from "../theme/store";
import { CloseIcon, CheckIcon, MoonIcon, SunIcon, MonitorIcon } from "./icons";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-2.5">
    <h3 className="text-ui-12 font-medium tracking-wide text-ink-dim">{title}</h3>
    {children}
  </section>
);

const Chip = ({
  label,
  active,
  onClick,
}: {
  label: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border-[0.5px] px-2 py-1.5 text-ui-13 transition-colors ${
      active
        ? "border-accent bg-accent-soft text-ink"
        : "border-border text-ink-dim hover:bg-hover hover:text-ink"
    }`}
  >
    {label}
    {active ? <CheckIcon size={11} className="text-accent" /> : null}
  </button>
);

/** 设置面板：只改 token 与布局开关，不碰组件几何（规范见 Docs/frontends/README.md §4） */
export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ui = useUiSettings();

  // 面板是模态语义：Esc 必须能关，键盘路径不能只靠点遮罩
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-[rgb(var(--color-scrim)_/_0.10)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-30 flex h-full w-[360px] flex-col border-l-[0.5px] border-border bg-surface shadow-dialog"
        aria-label="设置"
      >
        <header className="flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-border px-4">
          <span className="text-ui-14 font-medium text-ink">设置</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
            aria-label="关闭设置"
          >
            <CloseIcon size={15} />
          </button>
        </header>

        <div className="edge-fade min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-6">
            <Section title="外观">
              <div className="flex gap-1.5">
                <Chip
                  label={
                    <>
                      <SunIcon size={13} />
                      亮色
                    </>
                  }
                  active={ui.mode === "light"}
                  onClick={() => ui.setMode("light")}
                />
                <Chip
                  label={
                    <>
                      <MoonIcon size={13} />
                      暗色
                    </>
                  }
                  active={ui.mode === "dark"}
                  onClick={() => ui.setMode("dark")}
                />
                <Chip
                  label={
                    <>
                      <MonitorIcon size={13} />
                      跟随系统
                    </>
                  }
                  active={ui.mode === "system"}
                  onClick={() => ui.setMode("system")}
                />
              </div>
            </Section>

            <Section title="主题色">
              <div className="flex flex-col gap-1.5">
                {PALETTES.map((palette) => {
                  const active = ui.palette === palette.id;
                  return (
                    <button
                      key={palette.id}
                      type="button"
                      onClick={() => ui.setPalette(palette.id)}
                      className={`flex items-center gap-3 rounded-xl border-[0.5px] px-3 py-2.5 text-left transition-colors ${
                        active ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"
                      }`}
                    >
                      <span className="flex shrink-0 items-center gap-1">
                        {palette.swatch.map((color) => (
                          <span
                            key={color}
                            className="h-4 w-4 rounded-full border-[0.5px] border-border-strong"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-ui-13 font-medium text-ink">{palette.name}</span>
                        <span className="mt-0.5 block truncate text-ui-11 text-ink-faint">{palette.hint}</span>
                      </span>
                      {active ? <CheckIcon size={13} className="shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section title="壁纸">
              <div className="grid grid-cols-2 gap-1.5">
                {WALLPAPERS.map((wallpaper) => (
                  <button
                    key={wallpaper.id}
                    type="button"
                    onClick={() => ui.setWallpaper(wallpaper.id)}
                    className={`rounded-xl border-[0.5px] px-3 py-2 text-left transition-colors ${
                      ui.wallpaper === wallpaper.id
                        ? "border-accent bg-accent-soft text-ink"
                        : "border-border text-ink-dim hover:bg-hover hover:text-ink"
                    }`}
                  >
                    <span className="block text-ui-13">{wallpaper.name}</span>
                    <span className="mt-0.5 block text-ui-11 leading-snug text-ink-faint">{wallpaper.hint}</span>
                  </button>
                ))}
              </div>

              <label className="flex flex-col gap-1.5 pt-1">
                <span className="flex items-center justify-between text-ui-12 text-ink-dim">
                  壁纸强度
                  <span className="text-ink-faint">{Math.round(ui.wallpaperOpacity * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={15}
                  max={100}
                  step={5}
                  value={Math.round(ui.wallpaperOpacity * 100)}
                  disabled={ui.wallpaper === "none"}
                  onChange={(event) => ui.setWallpaperOpacity(Number(event.target.value) / 100)}
                  className="h-1 w-full appearance-none rounded-full bg-border accent-accent disabled:opacity-40"
                />
              </label>
              <p className="text-ui-11 leading-relaxed text-ink-faint">
                壁纸只铺在画布底层，正文、输入卡与侧栏保持不透明面；全部为静态图层，不参与动画。
              </p>
            </Section>

            <Section title="字号">
              <div className="flex gap-1.5">
                <Chip label="紧凑 90%" active={ui.fontScale === "90"} onClick={() => ui.setFontScale("90")} />
                <Chip label="标准" active={ui.fontScale === "100"} onClick={() => ui.setFontScale("100")} />
                <Chip label="宽松 110%" active={ui.fontScale === "110"} onClick={() => ui.setFontScale("110")} />
              </div>
            </Section>

            <Section title="关于">
              <dl className="flex flex-col gap-1.5 text-ui-12">
                <div className="flex justify-between">
                  <dt className="text-ink-dim">前端</dt>
                  <dd className="text-ink-2">lumine-ui 0.1.0</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-dim">后端</dt>
                  <dd className="text-ink-2">Lumine-rust（/api/chat/stream）</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-dim">界面基线</dt>
                  <dd className="text-ink-2">Percho（MIT）</dd>
                </div>
              </dl>
            </Section>
          </div>
        </div>
      </aside>
    </>
  );
}
