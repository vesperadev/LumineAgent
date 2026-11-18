import { useCallback, useEffect, useMemo, useState } from "react";

import { diffStats, fetchWorkspaceDiff, parseUnifiedDiff, statusLabel } from "../core/workspace";
import type { FileChange } from "../core/types";
import { ChevronRightIcon, CloseIcon, FileTextIcon, RefreshIcon } from "./icons";

export type DiffSidebarProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * 右侧 diff 浮层抽屉。几何类名来自 Percho globals.css（`.diff-sidebar` 等），不改基线。
 * 来源：packages/desktop/src/renderer/src/components/diff/DiffSidebar.tsx
 * 关闭：顶栏按钮 / 面板关闭 / Esc。无数据时空态，不抛错。
 */
export function DiffSidebar({ open, onClose }: DiffSidebarProps) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);

  const refresh = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void fetchWorkspaceDiff()
      .then((next) => {
        if (!cancelled) setFiles(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, epoch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const totals = useMemo(() => {
    return files.reduce(
      (acc, file) => {
        const stats = diffStats(file.diff);
        acc.added += stats.added;
        acc.removed += stats.removed;
        return acc;
      },
      { added: 0, removed: 0 },
    );
  }, [files]);

  return (
    <aside className={`diff-sidebar${open ? " open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="diff-sidebar-in">
        <div className="diff-side-head">
          <span className="diff-side-title">变更</span>
          <span className="diff-side-sum">
            {files.length} 个文件 · <span className="turn-diff-added">+{totals.added}</span>{" "}
            <span className="turn-diff-removed">−{totals.removed}</span>
          </span>
          <button
            type="button"
            className="diff-side-close"
            onClick={refresh}
            aria-label="刷新变更"
            title="刷新"
            disabled={loading}
          >
            <RefreshIcon />
          </button>
          <button type="button" className="diff-side-close" onClick={onClose} aria-label="关闭变更侧栏">
            <CloseIcon />
          </button>
        </div>
        <div className="diff-side-scroll">
          {files.length === 0 ? (
            <div className="diff-side-empty">
              {loading ? "正在读取工作区…" : "当前没有可显示的改动。Web/dev 未接后端时这里保持空态。"}
            </div>
          ) : (
            files.map((file, index) => <DiffFileCard key={file.path} file={file} defaultOpen={index === 0} />)
          )}
        </div>
      </div>
    </aside>
  );
}

function DiffFileCard({ file, defaultOpen }: { file: FileChange; defaultOpen: boolean }) {
  const stats = diffStats(file.diff);
  const rows = parseUnifiedDiff(file.diff);
  const badgeClass =
    file.status === "add" ? "text-ok" : file.status === "del" ? "text-err" : "text-ink-dim";

  return (
    <details className="diff-file-card" open={defaultOpen}>
      <summary className="diff-file-head">
        <FileTextIcon size={14} className="diff-file-icon" />
        <span className="diff-file-path min-w-0 truncate text-ui-13" title={file.path}>
          {file.path}
        </span>
        <span className={`text-ui-11 ${badgeClass}`}>{statusLabel(file.status)}</span>
        <span className="turn-diff-stat">
          <span className="turn-diff-added">+{stats.added}</span>{" "}
          <span className="turn-diff-removed">−{stats.removed}</span>
        </span>
        <span className="diff-file-chev">
          <ChevronRightIcon size={12} />
        </span>
      </summary>
      <div className="diff-card-body">
        {rows.length === 0 ? (
          <pre className="diff-fallback">{file.diff || "（无 diff 文本）"}</pre>
        ) : (
          <div className="diff-table">
            {rows.map((row, index) => {
              if (row.kind === "hunk") {
                return (
                  <div key={index} className="diff-hunk" style={{ ["--i" as string]: index }}>
                    {row.text}
                  </div>
                );
              }
              const lineClass =
                row.kind === "add" ? "diff-line diff-line-add" : row.kind === "del" ? "diff-line diff-line-del" : "diff-line";
              const oldNo = row.kind === "add" ? "" : String(row.oldNo);
              const newNo = row.kind === "del" ? "" : String(row.newNo);
              return (
                <div key={index} className={lineClass} style={{ ["--i" as string]: index }}>
                  <span className="diff-g">{oldNo}</span>
                  <span className="diff-g">{newNo}</span>
                  <span className="diff-code">{row.text}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}
