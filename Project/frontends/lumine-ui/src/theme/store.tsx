import { useCallback, useSyncExternalStore } from "react";

import type { Permission } from "../core/types";

export type PaletteId = "percho" | "sand" | "slate" | "forest" | "rose";
export type Mode = "light" | "dark" | "system";
export type WallpaperId = "none" | "linen" | "grid" | "aurora";
export type FontScale = "90" | "100" | "110";

export interface UiSettings {
  palette: PaletteId;
  mode: Mode;
  wallpaper: WallpaperId;
  wallpaperOpacity: number;
  fontScale: FontScale;
  sidebarCollapsed: boolean;
  enterToSend: boolean;
  defaultPermission: Permission;
}

export interface PaletteMeta {
  id: PaletteId;
  name: string;
  hint: string;
  /** 亮色画布 / accent / 暗色画布，用于设置面板的色卡预览 */
  swatch: [string, string, string];
}

export const PALETTES: PaletteMeta[] = [
  { id: "percho", name: "Percho", hint: "默认：纯白画布 + 紫罗兰强调", swatch: ["#ffffff", "#7c3aed", "#17171a"] },
  { id: "sand", name: "暖沙", hint: "米白纸感 + 琥珀强调，长时间阅读最舒服", swatch: ["#faf8f4", "#b07a3c", "#1a1712"] },
  { id: "slate", name: "冷灰", hint: "冷调灰蓝 + 青蓝强调，偏 IDE 气质", swatch: ["#f7f9fb", "#0e7490", "#101418"] },
  { id: "forest", name: "墨绿", hint: "低饱和绿 + 墨绿强调，安静、不抢注意力", swatch: ["#f6faf8", "#0f766e", "#0f1512"] },
  { id: "rose", name: "胭脂", hint: "暖粉中性 + 胭脂强调，柔和不甜腻", swatch: ["#fbf7f8", "#b0446a", "#171114"] },
];

export const WALLPAPERS: { id: WallpaperId; name: string; hint: string }[] = [
  { id: "none", name: "无", hint: "纯色画布（默认）" },
  { id: "linen", name: "亚麻细纹", hint: "横向细纹 + 米白底，静态位图开销为零" },
  { id: "grid", name: "淡网格", hint: "24px 工程格，和代码主题同源" },
  { id: "aurora", name: "晨雾", hint: "两团径向柔光，不参与动画" },
];

const STORAGE_KEY = "lumine.ui.v1";

const DEFAULTS: UiSettings = {
  palette: "percho",
  mode: "light",
  wallpaper: "none",
  wallpaperOpacity: 0.5,
  fontScale: "100",
  sidebarCollapsed: false,
  enterToSend: true,
  defaultPermission: "default",
};

const isPalette = (value: unknown): value is PaletteId =>
  PALETTES.some((palette) => palette.id === value);

const isMode = (value: unknown): value is Mode =>
  value === "light" || value === "dark" || value === "system";

const isWallpaper = (value: unknown): value is WallpaperId =>
  WALLPAPERS.some((wallpaper) => wallpaper.id === value);

const isFontScale = (value: unknown): value is FontScale =>
  value === "90" || value === "100" || value === "110";

function read(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      palette: isPalette(parsed.palette) ? parsed.palette : DEFAULTS.palette,
      mode: isMode(parsed.mode) ? parsed.mode : DEFAULTS.mode,
      wallpaper: isWallpaper(parsed.wallpaper) ? parsed.wallpaper : DEFAULTS.wallpaper,
      wallpaperOpacity:
        typeof parsed.wallpaperOpacity === "number"
          ? Math.min(1, Math.max(0.15, parsed.wallpaperOpacity))
          : DEFAULTS.wallpaperOpacity,
      fontScale: isFontScale(parsed.fontScale) ? parsed.fontScale : DEFAULTS.fontScale,
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      enterToSend: parsed.enterToSend !== false,
      defaultPermission: parsed.defaultPermission === "full" ? "full" : "default",
    };
  } catch {
    return DEFAULTS;
  }
}

let state: UiSettings = typeof localStorage === "undefined" ? DEFAULTS : read();
const listeners = new Set<() => void>();

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function resolvedMode(): "light" | "dark" {
  if (state.mode !== "system") return state.mode;
  return media?.matches ? "dark" : "light";
}

/** 把设置投影到根节点的 data-* 上：CSS 只认属性，不认 React 状态 */
function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolvedMode();
  root.dataset.palette = state.palette;
  root.dataset.wallpaper = state.wallpaper;
  root.dataset.fontScale = state.fontScale;
  root.style.setProperty("--wallpaper-opacity", String(state.wallpaperOpacity));
}

apply();

function emit() {
  apply();
  for (const listener of listeners) listener();
}

function update(patch: Partial<UiSettings>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下写入失败不影响本次会话 */
  }
  emit();
}

media?.addEventListener("change", () => {
  if (state.mode === "system") emit();
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => state;

/** 非 React 路径（引擎初始化 / 新会话）读取当前设置 */
export function getUiSettings(): UiSettings {
  return state;
}

/** 全局 UI 设置：主题 / 壁纸 / 字号 / 左栏开合，全部落 localStorage */
export function useUiSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...settings,
    resolvedMode: resolvedMode(),
    setPalette: useCallback((palette: PaletteId) => update({ palette }), []),
    setMode: useCallback((mode: Mode) => update({ mode }), []),
    setWallpaper: useCallback((wallpaper: WallpaperId) => update({ wallpaper }), []),
    setWallpaperOpacity: useCallback((wallpaperOpacity: number) => update({ wallpaperOpacity }), []),
    setFontScale: useCallback((fontScale: FontScale) => update({ fontScale }), []),
    toggleSidebar: useCallback(() => update({ sidebarCollapsed: !state.sidebarCollapsed }), []),
    setEnterToSend: useCallback((enterToSend: boolean) => update({ enterToSend }), []),
    setDefaultPermission: useCallback((defaultPermission: Permission) => update({ defaultPermission }), []),
  };
}
