export type FileChangeStatus = "add" | "mod" | "del";

export interface FileChange {
  path: string;
  status: FileChangeStatus;
  diff: string;
}

export type Role = "user" | "assistant";

export type MessageStatus = "streaming" | "done" | "error";

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface Step {
  id: string;
  label: string;
  detail?: string;
  status: StepStatus;
  durationMs?: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  status: MessageStatus;
  startedAt: number;
  error?: string;
  steps?: Step[];
}

export type Phase = "idle" | "streaming" | "error";

export interface SessionSummary {
  id: string;
  title: string;
  updatedMs: number;
}

export interface ApprovalRequest {
  id: string;
  tool: string;
  summary: string;
}

export type Permission = "default" | "full";

export interface ChatState {
  model: string;
  models: readonly string[];
  messages: Message[];
  phase: Phase;
  error: string | null;
  retryText: string | null;
  sessionId: string | null;
  sessions: SessionSummary[];
  permission: Permission;
  approval: ApprovalRequest | null;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage?: { prompt: number; completion: number } }
  | { type: "error"; message: string }
  | { type: "approval"; id: string; tool: string; summary: string }
  | { type: "step"; id: string; label: string; detail?: string; status: StepStatus };

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface Metrics {
  chunks: number;
  flushes: number;
  chars: number;
  lastFlushMs: number;
  firstByteMs: number;
  totalMs: number;
}
