import { invoke } from "@tauri-apps/api/core";

import { httpEndpoint, transport } from "./engine";
import type { FileChange, FileChangeStatus } from "./types";

export type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "add"; text: string; newNo: number }
  | { kind: "del"; text: string; oldNo: number }
  | { kind: "ctx"; text: string; oldNo: number; newNo: number };

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

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

export function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const raw of diff.split("\n")) {
    if (
      raw.startsWith("diff --git ") ||
      raw.startsWith("index ") ||
      raw.startsWith("new file mode ") ||
      raw.startsWith("deleted file mode ") ||
      raw.startsWith("similarity index ") ||
      raw.startsWith("rename from ") ||
      raw.startsWith("rename to ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      rows.push({ kind: "add", text: raw, newNo });
      newNo += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      rows.push({ kind: "del", text: raw, oldNo });
      oldNo += 1;
      continue;
    }
    if (raw.startsWith("\\")) {
      continue;
    }
    if (raw.length === 0 && rows.length === 0) continue;
    rows.push({ kind: "ctx", text: raw.startsWith(" ") ? raw : ` ${raw}`, oldNo, newNo });
    oldNo += 1;
    newNo += 1;
  }
  return rows;
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
