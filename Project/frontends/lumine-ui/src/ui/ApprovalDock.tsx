import type { Chat } from "../core/hooks";

/** 审批条：允许/拒绝当前工具调用，回写到对话流 */
export function ApprovalDock({ chat }: { chat: Chat }) {
  const approval = chat.approval;
  if (!approval) return null;

  return (
    <div className="mx-auto mb-2 flex max-w-[760px] items-center gap-2 rounded-[12px] border-[0.5px] border-border bg-surface px-3 py-2 shadow-soft">
      <span className="min-w-0 flex-1 truncate text-ui-13 text-ink">{approval.summary}</span>
      <button
        type="button"
        className="rounded-lg px-2 py-1 text-ui-13 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
        onClick={() => void chat.decideApproval(false)}
      >
        拒绝
      </button>
      <button
        type="button"
        className="rounded-lg bg-accent px-2 py-1 text-ui-13 text-on-accent"
        onClick={() => void chat.decideApproval(true)}
      >
        允许
      </button>
    </div>
  );
}
