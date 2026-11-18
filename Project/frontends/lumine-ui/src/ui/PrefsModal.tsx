import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import type { Chat } from "../core/hooks";
import { PALETTES, WALLPAPERS, useUiSettings } from "../theme/store";
import { CloseIcon } from "./icons";
import { ChoiceBar, SettingGroup, SettingRow, Switch } from "./PrefsFields";
import { PrefsModels } from "./PrefsModels";
import { UpdateChecker } from "./UpdateChecker";

type SectionId =
  | "general"
  | "appearance"
  | "shortcuts"
  | "models"
  | "runtime"
  | "security"
  | "logs"
  | "about"
  | "prompts"
  | "mcp"
  | "usage"
  | "proxy";

const NAV: { id: SectionId; group: string; label: string; keywords: string }[] = [
  { id: "general", group: "个人", label: "通用", keywords: "语言 发送 输入法 enter" },
  { id: "appearance", group: "个人", label: "外观", keywords: "主题 暗色 壁纸 字号 配色" },
  { id: "shortcuts", group: "个人", label: "快捷键", keywords: "ctrl 快捷 键盘" },
  { id: "models", group: "模型", label: "模型服务", keywords: "deepseek reasoner 模型 服务 添加 api" },
  { id: "runtime", group: "模型", label: "运行时", keywords: "权限 审批 工具" },
  { id: "prompts", group: "模型", label: "提示词", keywords: "系统提示 system prompt" },
  { id: "mcp", group: "模型", label: "MCP", keywords: "mcp 工具" },
  { id: "usage", group: "模型", label: "使用情况", keywords: "token 用量 usage" },
  { id: "security", group: "系统", label: "密钥", keywords: "api key deepseek 密钥" },
  { id: "proxy", group: "系统", label: "网络代理", keywords: "proxy 代理" },
  { id: "logs", group: "系统", label: "日志", keywords: "log 诊断 报错" },
  { id: "about", group: "系统", label: "关于", keywords: "版本 更新 github" },
];

const GROUPS = ["个人", "模型", "系统"] as const;

const SHORTCUTS: { action: string; keys: string; scope: string }[] = [
  { action: "打开设置", keys: "Ctrl+,", scope: "应用" },
  { action: "关闭弹层", keys: "Esc", scope: "应用" },
  { action: "发送消息", keys: "Enter", scope: "输入框" },
  { action: "换行", keys: "Shift+Enter", scope: "输入框" },
  { action: "中断生成", keys: "Esc", scope: "输入框" },
  { action: "删除会话", keys: "右键会话行", scope: "侧栏" },
];

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 左下角菜单打开的悬浮设置窗口（与右上角 SettingsPanel 独立） */
export function PrefsModal({
  open,
  onClose,
  chat,
}: {
  open: boolean;
  onClose: () => void;
  chat: Chat;
}) {
  const ui = useUiSettings();
  const [section, setSection] = useState<SectionId>("appearance");
  const [query, setQuery] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logHint, setLogHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const keyword = query.trim().toLowerCase();
  const filtered = NAV.filter(
    (item) =>
      !keyword ||
      item.label.includes(query.trim()) ||
      item.keywords.includes(keyword) ||
      item.group.includes(query.trim()),
  );

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgb(var(--color-scrim)_/_0.18)]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-label="设置"
        className="fixed inset-0 z-50 m-auto flex h-[min(680px,84vh)] w-[min(920px,94vw)] overflow-hidden rounded-2xl border-[0.5px] border-border bg-surface shadow-dialog"
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r-[0.5px] border-border bg-canvas p-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索设置"
            className="mb-3 h-8 rounded-lg bg-hover px-2 text-ui-13 text-ink outline-none placeholder:text-ink-faint"
          />
          <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            {GROUPS.map((group) => {
              const items = filtered.filter((item) => item.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-1.5 pb-1 text-ui-11 text-ink-faint">{group}</p>
                  {items.map((item) => (
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
              );
            })}
          </nav>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center justify-between border-b-[0.5px] border-border px-4">
            <span className="text-ui-14 font-medium text-ink">{NAV.find((item) => item.id === section)?.label}</span>
            <button type="button" className="rounded-lg p-1.5 text-ink-dim hover:bg-hover hover:text-ink" onClick={onClose} aria-label="关闭">
              <CloseIcon size={15} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {section === "general" ? (
              <SettingGroup title="对话输入">
                <SettingRow label="界面语言" description="目前只提供简体中文。">
                  <ChoiceBar value="zh" options={[{ id: "zh", label: "简体中文" }]} onChange={() => undefined} />
                </SettingRow>
                <SettingRow
                  label="Enter 发送"
                  description={ui.enterToSend ? "Enter 发送，Shift+Enter 换行。" : "Ctrl+Enter 发送，Enter 换行。"}
                >
                  <div className="flex justify-end">
                    <Switch on={ui.enterToSend} onChange={ui.setEnterToSend} label="Enter 发送" />
                  </div>
                </SettingRow>
                <SettingRow label="中文输入法" description="组字过程中按 Enter 不会误发送，无需单独开关。">
                  <span className="text-ui-12 text-ink-faint">已启用</span>
                </SettingRow>
              </SettingGroup>
            ) : null}

            {section === "appearance" ? (
              <>
                <SettingGroup title="主题">
                  <SettingRow label="外观" description="跟随系统时随 Windows 亮暗切换。">
                    <ChoiceBar
                      value={ui.mode}
                      options={[
                        { id: "light", label: "亮色" },
                        { id: "dark", label: "暗色" },
                        { id: "system", label: "跟随系统" },
                      ]}
                      onChange={ui.setMode}
                    />
                  </SettingRow>
                  <SettingRow label="配色" description={PALETTES.find((item) => item.id === ui.palette)?.hint ?? ""}>
                    <ChoiceBar
                      value={ui.palette}
                      options={PALETTES.map((item) => ({ id: item.id, label: item.name }))}
                      onChange={ui.setPalette}
                    />
                  </SettingRow>
                </SettingGroup>
                <SettingGroup title="画布">
                  <SettingRow label="壁纸" description={WALLPAPERS.find((item) => item.id === ui.wallpaper)?.hint ?? ""}>
                    <ChoiceBar
                      value={ui.wallpaper}
                      options={WALLPAPERS.map((item) => ({ id: item.id, label: item.name }))}
                      onChange={ui.setWallpaper}
                    />
                  </SettingRow>
                  <SettingRow label="壁纸强度" description="只影响画布底纹，侧栏和输入卡保持不透明。">
                    <input
                      type="range"
                      min={0.15}
                      max={1}
                      step={0.05}
                      value={ui.wallpaperOpacity}
                      onChange={(event) => ui.setWallpaperOpacity(Number(event.target.value))}
                      className="w-full"
                    />
                  </SettingRow>
                  <SettingRow label="界面字号" description="按 90% / 100% / 110% 缩放 UI 字号，不影响模型输出。">
                    <ChoiceBar
                      value={ui.fontScale}
                      options={[
                        { id: "90", label: "90%" },
                        { id: "100", label: "100%" },
                        { id: "110", label: "110%" },
                      ]}
                      onChange={ui.setFontScale}
                    />
                  </SettingRow>
                </SettingGroup>
              </>
            ) : null}

            {section === "shortcuts" ? (
              <SettingGroup title="当前绑定">
                <div className="py-2">
                  <div className="grid grid-cols-[1fr_8rem_5rem] gap-2 px-0.5 pb-2 text-ui-11 text-ink-faint">
                    <span>功能</span>
                    <span>快捷键</span>
                    <span>范围</span>
                  </div>
                  {SHORTCUTS.map((item) => (
                    <div
                      key={`${item.action}-${item.keys}`}
                      className="grid grid-cols-[1fr_8rem_5rem] gap-2 border-t-[0.5px] border-border py-2 text-ui-13"
                    >
                      <span className="text-ink">{item.action}</span>
                      <span className="text-ink-2">{item.keys}</span>
                      <span className="text-ink-faint">{item.scope}</span>
                    </div>
                  ))}
                  <p className="pt-2 text-ui-12 text-ink-faint">自定义改键会在后续版本加入，当前为只读一览。</p>
                </div>
              </SettingGroup>
            ) : null}

            {section === "models" ? <PrefsModels /> : null}

            {section === "prompts" ? (
              <p className="text-ui-13 text-ink-dim">自定义系统提示词尚未接入，避免做成点了没反应的输入框。</p>
            ) : null}
            {section === "mcp" ? (
              <p className="text-ui-13 text-ink-dim">MCP 服务列表尚未接入。工具目前只有对话里的 /list 与 /read。</p>
            ) : null}
            {section === "usage" ? (
              <p className="text-ui-13 text-ink-dim">
                累计 token 将来自流结束的 usage 字段。后端接上真实用量前这里不显示假数字。
              </p>
            ) : null}
            {section === "proxy" ? (
              <p className="text-ui-13 text-ink-dim">后端当前对上游请求关闭系统代理（no_proxy）。代理开关需后端配合后才能启用。</p>
            ) : null}
            {section === "runtime" ? (
              <SettingGroup title="任务权限">
                <SettingRow
                  label="新会话权限"
                  description="点「新建会话」时采用此项。当前会话可在输入卡左侧随时改。"
                >
                  <ChoiceBar
                    value={ui.defaultPermission}
                    options={[
                      { id: "default", label: "默认（审批）" },
                      { id: "full", label: "完全访问" },
                    ]}
                    onChange={(permission) => {
                      ui.setDefaultPermission(permission);
                      chat.setPermission(permission);
                    }}
                  />
                </SettingRow>
                <SettingRow
                  label="当前会话"
                  description={
                    chat.permission === "full"
                      ? "本会话跳过 /list /read 审批，仍不执行任意命令。"
                      : "只读工具会先弹出审批条。"
                  }
                >
                  <span className="text-ui-13 text-ink-2">{chat.permission === "full" ? "完全访问" : "默认"}</span>
                </SettingRow>
              </SettingGroup>
            ) : null}

            {section === "security" ? (
              <SettingGroup title="凭据">
                <SettingRow
                  label="DeepSeek API Key"
                  description="只写到本机 %LOCALAPPDATA%/LumineAgent/secrets.env，不会进仓库。留空保存即清除。"
                >
                  <input
                    type="password"
                    value={keyDraft}
                    onChange={(event) => setKeyDraft(event.target.value)}
                    placeholder="sk-…"
                    className="h-9 w-full rounded-lg border-[0.5px] border-border bg-surface px-2 text-ui-13 text-ink outline-none"
                  />
                </SettingRow>
                <SettingRow label="保存">
                  <div className="flex flex-col items-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-lg bg-accent px-3 py-1.5 text-ui-13 text-on-accent disabled:opacity-40"
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
                    {!inTauri() ? <p className="text-ui-12 text-ink-faint">Web 请继续用项目目录下的 .env。</p> : null}
                  </div>
                </SettingRow>
              </SettingGroup>
            ) : null}

            {section === "logs" ? (
              <SettingGroup title="诊断">
                <SettingRow label="日志文件" description="前端与桌面壳写到同一份文件，报障时只交这一份即可。">
                  <span className="break-all text-ui-12 text-ink-2">{logPath ?? "尚未读取"}</span>
                </SettingRow>
                <SettingRow label="操作">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      type="button"
                      className="rounded-lg border-[0.5px] border-border px-2.5 py-1.5 text-ui-13 text-ink-2 hover:bg-hover"
                      disabled={!inTauri()}
                      onClick={() => {
                        void invoke<[string[], string | null]>("log_dump")
                          .then(([lines, path]) => {
                            setLogLines(lines.slice(-40));
                            setLogPath(path);
                            setLogHint(path ? `已载入 ${lines.length} 行` : "当前只输出到控制台");
                          })
                          .catch(() => setLogHint("读取失败（仅桌面端）"));
                      }}
                    >
                      刷新
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border-[0.5px] border-border px-2.5 py-1.5 text-ui-13 text-ink-2 hover:bg-hover disabled:opacity-40"
                      disabled={!inTauri() || !logPath}
                      onClick={() => {
                        if (!logPath) return;
                        void invoke("open_path", { path: logPath }).catch(() => setLogHint("无法打开文件"));
                      }}
                    >
                      打开文件
                    </button>
                  </div>
                </SettingRow>
                {logHint ? <p className="py-2 text-ui-12 text-ink-faint">{logHint}</p> : null}
                {logLines.length > 0 ? (
                  <pre className="mb-3 max-h-56 overflow-auto rounded-lg bg-surface p-2 text-ui-11 leading-relaxed text-ink-2">
                    {logLines.join("\n")}
                  </pre>
                ) : null}
              </SettingGroup>
            ) : null}

            {section === "about" ? (
              <>
                <SettingGroup title="应用">
                  <SettingRow label="LumineAgent" description="界面基线 Percho（MIT）。">
                    <span className="text-ui-13 text-ink-2">0.1.0</span>
                  </SettingRow>
                  <SettingRow label="检查更新">
                    <UpdateChecker />
                  </SettingRow>
                  <SettingRow label="使用文档">
                    <a
                      className="text-ui-13 text-accent hover:underline"
                      href="https://github.com/vesperadev/LumineAgent/blob/main/README.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开 README
                    </a>
                  </SettingRow>
                  <SettingRow label="GitHub Issue">
                    <a
                      className="text-ui-13 text-accent hover:underline"
                      href="https://github.com/vesperadev/LumineAgent/issues/new"
                      target="_blank"
                      rel="noreferrer"
                    >
                      提交反馈
                    </a>
                  </SettingRow>
                </SettingGroup>
                <SettingGroup title="更新与启动">
                  <SettingRow label="自动检查更新" description="启动后检查新版本；运行期间定时检查尚未接入。">
                    <span className="text-ui-12 text-ink-faint">即将支持</span>
                  </SettingRow>
                  <SettingRow label="自动下载更新" description="发现新版本后自动下载，安装仍由你决定。">
                    <span className="text-ui-12 text-ink-faint">即将支持</span>
                  </SettingRow>
                  <SettingRow label="开机自启" description="登录系统后启动 LumineAgent。尚未接入 Tauri autostart。">
                    <span className="text-ui-12 text-ink-faint">即将支持</span>
                  </SettingRow>
                </SettingGroup>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}
