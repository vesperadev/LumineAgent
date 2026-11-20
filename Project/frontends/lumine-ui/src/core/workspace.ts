import { invoke } from "@tauri-apps/api/core";

import { httpEndpoint, transport } from "./engine";
import type { FileChange, FileChangeStatus } from "./types";

// diff 的纯解析搬到 core/diff.ts（零 import，可离线校验）；对外 API 保持不变
export type { DiffRow } from "./diff";
export { diffStats, parseUnifiedDiff } from "./diff";

const STATUSES: ReadonlySet<string> = new Set(["add", "mod", "del"]);

export function isFileChange(value: unknown): value is FileChange {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === "string" &&
    typeof record.diff === "string" &&
    typeof record.status === "string" &&
    STATUSES.has(record.status)
  );
}

export function parseSnapshot(data: unknown): FileChange[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isFileChange);
}

/**
 * 桌面 IPC 与 Web HTTP 同一 JSON 形状。mock / 失败 / 非数组一律 []，调用方不得 throw。
 */
export async function fetchWorkspaceDiff(): Promise<FileChange[]> {
  const channel = transport();
  try {
    if (channel === "ipc") {
      return parseSnapshot(await invoke<unknown>("workspace_diff"));
    }
    if (channel === "http") {
      const res = await fetch(`${httpEndpoint()}/api/workspace/diff`);
      if (!res.ok) return [];
      return parseSnapshot(await res.json());
    }
    return [];
  } catch {
    return [];
  }
}

export function statusLabel(status: FileChangeStatus): string {
  if (status === "add") return "新增";
  if (status === "del") return "删除";
  return "修改";
}
