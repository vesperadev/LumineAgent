/**
 * 前端日志出口。
 *
 * 与 Rust 侧 `src-tauri/src/logging.rs` 配对：桌面环境下前端日志会经
 * `log_write` 命令转发到壳的日志文件，与壳/后端日志落在同一时间线上，
 * 出问题时「前端报了什么」和「壳做了什么」能对照着看。
 *
 * Web/dev 环境没有壳，降到 console 输出，不报错、不阻塞。
 */

import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Tauri 注入的内部对象只在 webview 里存在 */
const inTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 级别权重：数值越大越严重，与 Rust 侧 Level 对齐 */
const WEIGHT: Record<LogLevel, number> = { debug: 1, info: 2, warn: 3, error: 4 };

/** 生效级别；由 setLogLevel 调整，默认 info */
let threshold: number = WEIGHT.info;

/** 前端日志缓冲：最近 N 条，供 UI 展示 */
const BUFFER_LIMIT = 300;
const buffer: Array<{ level: LogLevel; message: string; at: string }> = [];

function stamp(): string {
  return new Date().toISOString();
}

function push(level: LogLevel, message: string): void {
  buffer.push({ level, message, at: stamp() });
  if (buffer.length > BUFFER_LIMIT) buffer.shift();
}

/**
 * 写一条日志。
 *
 * @param level 级别
 * @param message 正文
 * @param scope 模块标签，与 Rust 侧的 `[shell] / [ipc] / [backend]` 对齐
 */
export function log(level: LogLevel, message: string, scope = "ui"): void {
  if (WEIGHT[level] < threshold) return;
  const line = `[${scope}] ${message}`;
  push(level, line);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // 转发到壳：与壳日志写进同一个文件，形成统一时间线
  if (inTauri()) {
    void invoke("log_write", { level, scope, message }).catch(() => {
      // 日志转发本身失败不能影响主流程，静默降级
    });
  }
}

/** 调整生效级别（低于该级别的不记录） */
export function setLogLevel(level: LogLevel): void {
  threshold = WEIGHT[level];
}

/** 取回前端日志缓冲 */
export function getLogBuffer(): ReadonlyArray<{ level: LogLevel; message: string; at: string }> {
  return buffer;
}

export const logDebug = (message: string, scope?: string): void => log("debug", message, scope);
export const logInfo = (message: string, scope?: string): void => log("info", message, scope);
export const logWarn = (message: string, scope?: string): void => log("warn", message, scope);
export const logError = (message: string, scope?: string): void => log("error", message, scope);
