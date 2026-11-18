import type { Chat } from "../core/hooks";
import { RefreshIcon } from "./icons";

const seconds = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="context-row">
      <span className="context-row-label">{label}</span>
      <span className="context-row-value" data-strong={strong ? "true" : "false"}>
        {value}
      </span>
    </div>
  );
}

export function ContextPanel({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const turns = chat.messages.filter((message) => message.role === "assistant").length;
  const chars = chat.metrics.chars;
  const approxTokens = Math.round(chars / 3.4);

  return (
    <aside className="context-panel">
      <header className="context-head">
        <span className="context-title">对话状态</span>
        <button type="button" className="context-refresh" onClick={onClose}>
          <RefreshIcon />
          收起
        </button>
      </header>

      <section className="context-section">
        <p className="context-section-title">执行概况</p>
        <Row label="轮次" value={`${turns}`} />
        <Row label="运行 · 对话" value={chat.streaming ? "进行中" : `${turns} 成功`} />
        <Row label="模型" value={chat.model} />
      </section>

      <section className="context-section">
        <p className="context-section-title">耗时统计</p>
        <Row label="总时长" value={seconds(chat.metrics.totalMs)} />
        <Row label="首字延迟" value={seconds(chat.metrics.firstByteMs)} strong />
        <Row
          label="输出速度"
          value={
            chat.metrics.totalMs > 0
              ? `${Math.round(chars / (chat.metrics.totalMs / 1000))} 字/s`
              : "—"
          }
        />
      </section>

      <section className="context-section">
        <p className="context-section-title">用量</p>
        <Row label="字符数" value={`${chars}`} />
        <Row label="估算 Token" value={`≈ ${approxTokens}`} strong />
        <p className="context-note" style={{ marginTop: 6 }}>
          真实用量等接入后端 usage 事件后替换。
        </p>
      </section>
    </aside>
  );
}
