/**
 * 桌面端「检查更新」入口。
 *
 * 走 Tauri updater：从 GitHub Releases 的 latest.json 拉取，
 * 签名由壳配置里的 pubkey 校验，不合法直接拒绝安装。
 * Web/dev 环境没有壳 → 整块不渲染，不报错、不阻塞。
 */

import { useCallback, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

import { logError, logInfo } from "../core/logger";

type Phase = "idle" | "checking" | "downloading" | "installing" | "done" | "error";

const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 状态文案：进度百分比按已下载 chunk / contentLength 估算 */
const label: Record<Phase, string> = {
  idle: "检查更新",
  checking: "检查中…",
  downloading: "下载中…",
  installing: "安装中…",
  done: "已是最新版本",
  error: "检查失败，重试",
};

export function UpdateChecker() {
  // SSR / Web 环境直接不渲染：插件依赖 Tauri IPC
  if (!inTauri()) return null;
  return <UpdateCheckerInner />;
}

function UpdateCheckerInner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [percent, setPercent] = useState<number | null>(null);

  const run = useCallback(async () => {
    setPhase("checking");
    setDetail("");
    setPercent(null);
    try {
      const update = await check();
      if (!update) {
        setPhase("done");
        setDetail("已是最新版本");
        logInfo("updater", "检查更新：已是最新版本");
        return;
      }
      logInfo("updater", `发现新版本 ${update.version}`);
      setDetail(`发现 v${update.version}`);
      setPhase("downloading");

      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setPercent(Math.min(100, Math.round((downloaded / total) * 100)));
        } else if (event.event === "Finished") {
          setPercent(100);
        }
      });

      setPhase("installing");
      logInfo("updater", `更新 ${update.version} 已安装，准备重启`);
      // Windows 上安装步骤会自动退出应用；relaunch 在部分平台可能抛错，吞掉即可
      try {
        await relaunch();
      } catch (error) {
        logError("updater", `重启失败（更新已安装，可手动重启）: ${String(error)}`);
      }
      setPhase("done");
      setDetail("更新已安装，重启后生效");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPhase("error");
      setDetail(message);
      logError("updater", `检查更新失败: ${message}`);
    }
  }, []);

  const busy = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="flex w-full items-center justify-center rounded-lg border-[0.5px] border-border px-2 py-1.5 text-ui-13 text-ink-dim transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        {label[phase]}
        {percent !== null ? ` ${percent}%` : ""}
      </button>
      {detail ? (
        <p className="break-all text-ui-11 leading-relaxed text-ink-faint" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}
