import { useState } from "react";

import { Markdown } from "../core/Markdown";
import type { Message, StepStatus } from "../core/types";
import { CheckIcon, ChevronRightIcon } from "./icons";

const StepGlyph = ({ status }: { status: StepStatus }) => {
  if (status === "done") return <CheckIcon size={12} />;
  if (status === "failed") return <span aria-hidden="true">✕</span>;
  if (status === "running") return <span aria-hidden="true">◐</span>;
  return <span aria-hidden="true">○</span>;
};

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

function ActivityRows({ steps, streaming }: { steps: NonNullable<Message["steps"]>; streaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const total = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

  const rows = steps.map((step) => (
    <div
      key={step.id}
      className={`flex min-w-0 items-center gap-1.5 text-ui-12 ${
        step.status === "failed" ? "text-err" : step.status === "running" ? "text-ink-2" : "text-ink-dim"
      }`}
    >
      <span className="grid w-3.5 shrink-0 place-items-center text-ink-faint">
        <StepGlyph status={step.status} />
      </span>
      <span className="min-w-0 truncate">{step.label}</span>
      {step.detail ? <span className="ml-auto text-ui-11 text-ink-faint">{step.detail}</span> : null}
    </div>
  ));

  if (streaming || expanded) {
    return (
      <div className="flex flex-col gap-1">
        {rows}
        {!streaming ? (
          <button
            type="button"
            className="w-fit text-ui-12 text-ink-faint transition-colors hover:text-ink-2"
            onClick={() => setExpanded(false)}
          >
            收起过程
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-12 text-ink-dim transition-colors hover:bg-hover hover:text-ink"
      onClick={() => setExpanded(true)}
    >
      <span className="text-ok">
        <CheckIcon size={12} />
      </span>
      <span>过程 {steps.length} 步</span>
      {total > 0 ? <span className="text-ink-faint">{seconds(total)}</span> : null}
      <span className="text-ink-faint">
        <ChevronRightIcon size={11} />
      </span>
    </button>
  );
}

/** 消息：用户右侧气泡（16px / 右下 6px），助手无头像直铺（Percho 的两种形态） */
export function MessageBlock({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-ui-15 leading-[1.7] text-ink shadow-soft select-text">
            {message.text}
          </div>
        </div>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const steps = message.steps ?? [];
  const stepTotal = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 ? <ActivityRows steps={steps} streaming={streaming} /> : null}

      {message.text ? (
        <div className="md markdown-body text-ui-15 leading-[1.75] text-ink select-text">
          <Markdown text={message.text} />
        </div>
      ) : streaming ? (
        <div className="flex items-center gap-1 text-ink-faint">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint [animation-delay:300ms]" />
        </div>
      ) : null}

      {message.error ? <div className="text-ui-13 text-err">{message.error}</div> : null}

      {message.text ? (
        <div className="text-ui-11 text-ink-faint">
          {streaming ? "输出中" : `${message.text.length} 字符`}
          {steps.length > 0 ? " · " : ""}
          {steps.length > 0 ? `工具 ${steps.length} 次${stepTotal > 0 ? ` · ${seconds(stepTotal)}` : ""}` : ""}
        </div>
      ) : null}
    </div>
  );
}
