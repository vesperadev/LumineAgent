export type Role = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "error";

/** 过程步骤：界面上“一处行一条”的工具活动，属于回复的附属信息 */
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface Step {
  id: string;
  label: string;
  /** 右侧的次要说明，例如文件名、命令名、改动行数 */
  detail?: string;
  status: StepStatus;
  durationMs?: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  status: MessageStatus;
  /** 流式开始时间，用于计算首字延迟与速率 */
  startedAt: number;
  error?: string;
  /** 仅 assistant：本轮的步骤记录，缺省表示没有过程信息 */
  steps?: Step[];
}

export type Phase = "idle" | "streaming" | "error";

export interface ChatState {
  model: string;
  models: readonly string[];
  messages: Message[];
  phase: Phase;
  error: string | null;
  /** 出错时保留的原始输入，供输入框回填，避免用户重打 */
  retryText: string | null;
}

/** 与后端 /api/chat/stream 的 SSE 事件一一对应 */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage?: { prompt: number; completion: number } }
  | { type: "error"; message: string };

export interface SendResult {
  ok: boolean;
  error?: string;
}

/** 与后端 GET /api/workspace/diff 单项同形 */
export type FileChangeStatus = "add" | "mod" | "del";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  diff: string;
}

export interface Metrics {
  /** 已收到的分片数 */
  chunks: number;
  /** 实际合并进 state 的帧数（rAF 批量刷新次数） */
  flushes: number;
  /** 已渲染字符数 */
  chars: number;
  /** 最近一次批量刷新的耗时（毫秒） */
  lastFlushMs: number;
  /** 首字延迟（毫秒） */
  firstByteMs: number;
  /** 从发送到结束的总耗时（毫秒） */
  totalMs: number;
}
