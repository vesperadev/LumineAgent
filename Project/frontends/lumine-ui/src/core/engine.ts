import type {
  ApprovalRequest,
  ChatState,
  Message,
  Metrics,
  Permission,
  SendResult,
  SessionSpace,
  SessionSummary,
  Step,
  StreamEvent,
} from "./types";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getUiSettings } from "../theme/store";
import { activeUpstream, enabledModelIds, subscribeProviders } from "./providers";
import { logDebug, logError, logInfo } from "./logger";

const MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;

/** Mock 下的过程步骤：只为验证“过程行”的排版与状态切换，接真实后端后由 step 事件填充 */
const MOCK_STEPS: ReadonlyArray<Pick<Step, "id" | "label" | "detail">> = [
  { id: "plan", label: "梳理需求与现有结构", detail: "项目树" },
  { id: "read", label: "读取相关文件", detail: "src/main.py" },
  { id: "patch", label: "生成改动", detail: "3 处修改" },
  { id: "test", label: "运行验证", detail: "cargo test" },
];

const ENDPOINT = (import.meta.env.VITE_LUMINE_ENDPOINT as string | undefined) ?? "";

/** 桌面壳判定：Tauri 注入的内部对象只在 webview 里存在 */
const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * 传输层选择：桌面（Tauri）且未设 VITE_LUMINE_ENDPOINT → ipc::Channel（壳负责拉起后端）；
 * 桌面但显式设了端点 → HTTP（dev 联调手动后端）；Web 设了端点 → HTTP；都没设 → mock。
 * 两条真通道共用同一 StreamEvent 形状（roadmap 阶段 2）。
 * mock 判定只有这一处：hooks 与 UI 徽标都引用它，避免「显示 remote 实际走剧本」。
 */
const useIpc = (): boolean => isTauri() && ENDPOINT.trim().length === 0;
export const isMock = (): boolean => !isTauri() && ENDPOINT.trim().length === 0;

/** 与 send() 同一套通道判定，工作区快照走 ipc / http，mock 则空列表。 */
export type Transport = "mock" | "ipc" | "http";
export const transport = (): Transport => (isMock() ? "mock" : useIpc() ? "ipc" : "http");
export const httpEndpoint = (): string => ENDPOINT.trim();

let seq = 0;
const nextId = () => `m${++seq}`;

const zeroMetrics = (): Metrics => ({
  chunks: 0,
  flushes: 0,
  chars: 0,
  lastFlushMs: 0,
  firstByteMs: 0,
  totalMs: 0,
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 按 code point 切块，避免把 CJK / emoji 的代理对切断 */
function* chunks(text: string, size: number): Generator<string> {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += size) {
    yield chars.slice(i, i + size).join("");
  }
}

/**
 * Mock 剧本：刻意包含标题、列表、代码块、引用四种排版单元。
 * 十种风格的差异必须能在这四类单元上体现出来，否则对比没意义。
 */
function scriptFor(prompt: string, model: string): string {
  const p = prompt.trim();
  const lower = p.toLowerCase();

  if (p === "?" || lower === "help") {
    return [
      "## 可用能力",
      "",
      "- 连续对话，保留完整上下文",
      `- 切换模型（当前 ${model}）`,
      "- 生成过程中随时中断，已输出内容保留",
      "- 请求失败时回填你的原话，不用重打",
      "",
      "> 当前是 Mock 模式：回复由本地剧本生成，不消耗额度、不联网。",
      "",
      "接入真实后端后，这条链路只需替换 transport 层。",
    ].join("\n");
  }

  if (/排版|字体|风格|设计|style/i.test(p)) {
    return [
      "## 排版对比要点",
      "",
      "同一段内容，不同风格要给出不同的阅读节奏：",
      "",
      "1. **字号阶梯**：正文 14–16px，标题靠字重和字距拉开层级，而不是靠加粗堆砌。",
      "2. **行高与字距**：终端风 1.5 倍行高偏紧；杂志风 1.75 倍配宽字距才不闷。",
      "3. **留白**：卡片风靠内边距分隔，纸感风靠外边距和一条 1px 线。",
      "4. **等宽与比例字**：代码、路径、快捷键用等宽；叙述性正文用比例字更省眼。",
      "",
      "```css",
      "/* 同一个提示气泡，三种排版策略 */",
      ".terminal { font: 13px/1.5 Consolas; }",
      ".paper    { font: 16px/1.75 Georgia; }",
      ".swiss    { font: 15px/1.4 'Segoe UI'; }",
      "```",
      "",
      "> 结论：先定排版节奏，再定颜色。反过来的话，颜色一换就要重排。",
    ].join("\n");
  }

  if (/架构|分层|解耦|依赖/i.test(p)) {
    return [
      "## 四层切分",
      "",
      "| 层 | 职责 | 不该做的事 |",
      "| --- | --- | --- |",
      "| transport | SSE 解码，产出事件 | 不碰 UI 状态 |",
      "| session | 消息历史、模型、中止信号 | 不拼 DOM |",
      "| view | 渲染与交互 | 不知道网络存在 |",
      "| contract | 共享类型与错误码 | 不含实现 |",
      "",
      "依赖方向单向：`view → session → transport`。",
      "一旦 view 直接调 fetch，换后端就等于重写界面。",
      "",
      "```ts",
      "// 唯一允许穿透的方向",
      "useChat() -> send() -> transport -> StreamEvent",
      "```",
    ].join("\n");
  }

  if (/你好|hi|hello|在吗/i.test(p)) {
    return [
      "你好。",
      "",
      "这是一次 Mock 往返，用来验证四件事：流式渲染是否跟手、自动滚动是否粘底、",
      "中断是否保留已输出内容、失败是否回填输入。",
      "",
      "十种风格共用这套引擎，差异只在排版、配色与信息密度。",
    ].join("\n");
  }

  return [
    `收到：**${p}**`,
    "",
    "这是本地剧本拼出的回复，重点不在内容，而在让排版单元都能被看见：",
    "",
    "- 一段叙述性正文，用来观察行高与字距",
    "- 一个列表，用来观察缩进与项目符号的垂直对齐",
    "- 一段引用，用来观察次要信息的弱化程度",
    "",
    "> 渲染验证通过后，十种风格就具备了同条件对比的基础。",
    "",
    "```rust",
    "// 后端接上后，这段外壳不用改",
    "let reply = chat(&client, model, &history).await?;",
    "```",
    "",
    `这次用的模型是 \`${model}\`。`,
  ].join("\n");
}

function catalogModels(): string[] {
  const ids = enabledModelIds();
  return ids.length > 0 ? ids : [...MODELS];
}

export class ChatEngine {
  private state: ChatState = {
    model: catalogModels()[0] ?? "deepseek-chat",
    models: catalogModels(),
    messages: [],
    phase: "idle",
    error: null,
    retryText: null,
    sessionId: null,
    sessions: [],
    permission: getUiSettings().defaultPermission,
    approval: null,
  };

  private listeners = new Set<() => void>();
  private version = 0;

  private ctrl: AbortController | null = null;
  private buffer = "";
  private targetId: string | null = null;
  private raf = 0;
  private startedAt = 0;
  private firstByteAt = 0;
  private lastPrompt = "";
  private space: SessionSpace = "daily";

  metrics: Metrics = zeroMetrics();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): number => this.version;

  getState = (): ChatState => this.state;

  setModel = (model: string): void => {
    if (model === this.state.model) return;
    this.state = { ...this.state, model };
    this.emit();
  };

  syncModels = (): void => {
    const models = catalogModels();
    const model = models.includes(this.state.model) ? this.state.model : (models[0] ?? this.state.model);
    if (model === this.state.model && models.length === this.state.models.length && models.every((id, i) => id === this.state.models[i])) {
      return;
    }
    this.state = { ...this.state, model, models };
    this.emit();
  };

  reset = async (): Promise<void> => {
    this.stop();
    this.flush();
    try {
      await this.persistSession();
    } catch (error) {
      logError(`归档当前会话失败，未打开空白会话：${error}`, "engine");
      return;
    }
    this.buffer = "";
    this.targetId = null;
    this.space = "daily";
    this.state = {
      ...this.state,
      messages: [],
      phase: "idle",
      error: null,
      retryText: null,
      sessionId: null,
      approval: null,
      permission: getUiSettings().defaultPermission,
    };
    this.metrics = zeroMetrics();
    this.emit();
    await this.refreshSessions();
  };

  setPermission = (permission: Permission): void => {
    if (permission === this.state.permission) return;
    this.state = { ...this.state, permission };
    this.emit();
  };

  decideApproval = async (allow: boolean): Promise<void> => {
    const approval = this.state.approval;
    if (!approval) return;
    this.state = { ...this.state, approval: null };
    this.emit();
    if (isMock()) return;
    const body = JSON.stringify({ id: approval.id, allow });
    try {
      if (useIpc()) {
        await invoke("approve_tool", { id: approval.id, allow });
      } else {
        await fetch(`${ENDPOINT}/api/approvals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      }
    } catch (error) {
      logError(`审批提交失败：${error}`, "engine");
    }
  };

  refreshSessions = async (): Promise<void> => {
    if (isMock()) {
      this.state = { ...this.state, sessions: readLocalSessions() };
      this.emit();
      return;
    }
    try {
      const raw = useIpc()
        ? await invoke<Array<{ id: string; title: string; updated_ms?: number; updatedMs?: number; space?: string }>>(
            "list_sessions",
          )
        : ((await (await fetch(`${ENDPOINT}/api/sessions`)).json()) as Array<{
            id: string;
            title: string;
            updated_ms?: number;
            updatedMs?: number;
            space?: string;
          }>);
      const sessions = raw.map((session) => ({
        id: session.id,
        title: session.title,
        updatedMs: session.updatedMs ?? session.updated_ms ?? 0,
        space: session.space === "agent" ? ("agent" as const) : ("daily" as const),
      }));
      this.state = { ...this.state, sessions };
      this.emit();
    } catch (error) {
      logError(`拉取会话列表失败：${error}`, "engine");
    }
  };

  openSession = async (id: string): Promise<void> => {
    if (this.state.sessionId !== id) {
      this.stop();
      this.flush();
      try {
        await this.persistSession();
      } catch (error) {
        logError(`切换前归档失败：${error}`, "engine");
        return;
      }
    }
    if (isMock()) {
      const packed = localStorage.getItem(`lumine.session.${id}`);
      if (!packed) return;
      let messages: Message[];
      try {
        const parsed: unknown = JSON.parse(packed);
        if (!Array.isArray(parsed)) throw new Error("local session payload is not an array");
        // 逐条校验后续必用到的两个字段：role 决定渲染与请求映射，text 会被 trim 后过滤；
        // 缺任何一个都会延后到 messagesFor / persistSession 才抛 TypeError，排查方向会被带偏
        const valid = parsed.every((row: unknown) => {
          if (typeof row !== "object" || row === null) return false;
          const entry = row as Record<string, unknown>;
          return (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string";
        });
        if (!valid) throw new Error("local session contains malformed messages");
        messages = parsed as Message[];
      } catch (error) {
        // 启动时退回空历史等于把用户会话丢掉，宁可停在原会话并留一条带 id 的日志（不打印正文）
        logError(`本地会话读取失败（${id}）：${error}`, "engine");
        return;
      }
      this.space = readLocalSessions().find((session) => session.id === id)?.space ?? "daily";
      this.state = { ...this.state, sessionId: id, messages, phase: "idle", error: null };
      this.emit();
      return;
    }
    try {
      const raw = useIpc()
        ? await invoke<{ id: string; space?: string; messages: Array<{ role: string; content: string }> }>("get_session", {
            id,
          })
        : ((await (await fetch(`${ENDPOINT}/api/sessions/${id}`)).json()) as {
            id: string;
            space?: string;
            messages: Array<{ role: string; content: string }>;
          });
      const now = Date.now();
      const messages: Message[] = raw.messages.map((item, index) => ({
        id: `s${id}-${index}`,
        role: item.role === "assistant" ? "assistant" : "user",
        text: item.content,
        status: "done",
        startedAt: now,
      }));
      this.space = raw.space === "agent" ? "agent" : "daily";
      this.state = { ...this.state, sessionId: raw.id, messages, phase: "idle", error: null };
      this.emit();
    } catch (error) {
      logError(`打开会话失败：${error}`, "engine");
    }
  };

  deleteSession = async (id: string): Promise<void> => {
    if (isMock()) {
      localStorage.removeItem(`lumine.session.${id}`);
      const rest = readLocalSessions().filter((session) => session.id !== id);
      writeLocalSessions(rest);
      if (this.state.sessionId === id) await this.reset();
      else await this.refreshSessions();
      return;
    }
    try {
      if (useIpc()) await invoke("delete_session", { id });
      else await fetch(`${ENDPOINT}/api/sessions/${id}`, { method: "DELETE" });
      if (this.state.sessionId === id) await this.reset();
      else await this.refreshSessions();
    } catch (error) {
      logError(`删除会话失败：${error}`, "engine");
    }
  };

  attachPaths = (paths: string[]): void => {
    if (paths.length === 0) return;
    const note = paths.map((path) => `\n\n[附件] ${path}`).join("");
    this.state = {
      ...this.state,
      retryText: `${this.state.retryText ?? ""}${note}`,
    };
    this.emit();
  };

  stop = (): void => {
    this.ctrl?.abort();
  };

  send = async (text: string): Promise<SendResult> => {
    const prompt = text.trim();
    if (!prompt) return { ok: false };
    if (this.state.phase === "streaming") return { ok: false };

    const now = Date.now();
    const userMsg: Message = { id: nextId(), role: "user", text: prompt, status: "done", startedAt: now };
    const assistantMsg: Message = {
      id: nextId(),
      role: "assistant",
      text: "",
      status: "streaming",
      startedAt: now,
      // 只有 mock 才伪造步骤演示；真后端目前不返回步骤，不能凭空显示"工具 N 次"
      ...(isMock() ? { steps: MOCK_STEPS.map((step) => ({ ...step, status: "pending" as const })) } : {}),
    };

    this.state = {
      ...this.state,
      messages: [...this.state.messages, userMsg, assistantMsg],
      phase: "streaming",
      error: null,
      retryText: null,
      approval: null,
    };
    this.targetId = assistantMsg.id;
    this.buffer = "";
    this.lastPrompt = prompt;
    this.metrics = zeroMetrics();
    this.startedAt = performance.now();
    this.firstByteAt = 0;
    this.ctrl = new AbortController();
    this.emit();

    try {
      const transport = isMock() ? "mock" : useIpc() ? "ipc" : "http";
      logInfo(`发送消息（通道=${transport}，模型=${this.state.model}）`, "engine");
      const events = isMock() ? this.mock(prompt) : useIpc() ? this.remoteIpc() : this.remote();
      for await (const event of events) {
        if (event.type === "delta") {
          if (this.firstByteAt === 0) {
            this.firstByteAt = performance.now();
            this.metrics = { ...this.metrics, firstByteMs: this.firstByteAt - this.startedAt };
            logDebug(`收到首字，延迟 ${Math.round(this.metrics.firstByteMs)}ms`, "engine");
          }
          this.buffer += event.text;
          this.metrics = { ...this.metrics, chunks: this.metrics.chunks + 1 };
          this.scheduleFlush();
        } else if (event.type === "error") {
          logError(`收到错误事件：${event.message}`, "engine");
          throw new Error(event.message);
        } else if (event.type === "approval") {
          this.state = {
            ...this.state,
            approval: { id: event.id, tool: event.tool, summary: event.summary } satisfies ApprovalRequest,
          };
          this.emit();
        } else if (event.type === "step") {
          const target = this.targetId;
          if (target) {
            this.patchSteps(target, (steps) => {
              const next = steps.filter((step) => step.id !== event.id);
              next.push({
                id: event.id,
                label: event.label,
                status: event.status,
                ...(event.detail ? { detail: event.detail } : {}),
              });
              return next;
            });
          }
        } else {
          break;
        }
      }
      logInfo(`消息结束，共 ${this.metrics.chunks} 帧 / ${this.metrics.chars} 字`, "engine");
      this.flush();
      this.finish("done");
      await this.persistSession().catch((error) => logError(`保存会话失败：${error}`, "engine"));
      return { ok: true };
    } catch (cause) {
      this.flush();
      const aborted = this.ctrl?.signal.aborted === true;
      if (aborted) {
        logInfo("请求被用户中断", "engine");
        this.finish("done");
        await this.persistSession().catch((error) => logError(`保存会话失败：${error}`, "engine"));
        return { ok: true };
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      logError(`请求失败：${message}`, "engine");
      this.finish("error", message);
      this.state = { ...this.state, phase: "error", error: message, retryText: this.lastPrompt };
      this.emit();
      await this.persistSession().catch((error) => logError(`保存会话失败：${error}`, "engine"));
      return { ok: false, error: message };
    } finally {
      this.ctrl = null;
      this.targetId = null;
      if (this.raf) {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
      }
      if (this.state.phase !== "error") {
        this.state = { ...this.state, phase: "idle" };
        this.emit();
      }
    }
  };

  private scheduleFlush(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.flush();
    });
  }

  /** 一帧只合并一次，避免每个 token 触发一次 React 更新 */
  private flush(): void {
    if (!this.buffer || !this.targetId) return;
    const t0 = performance.now();
    const delta = this.buffer;
    this.buffer = "";
    const id = this.targetId;
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)),
    };
    this.metrics = {
      ...this.metrics,
      chars: this.metrics.chars + delta.length,
      flushes: this.metrics.flushes + 1,
      lastFlushMs: performance.now() - t0,
    };
    this.emit();
  }

  /** 只更新某条消息的 steps，避免为了走一步就重排整篇正文 */
  private patchSteps(id: string, mutate: (steps: Step[]) => Step[]): void {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) => (m.id === id ? { ...m, steps: mutate(m.steps ?? []) } : m)),
    };
    this.emit();
  }

  private finish(status: "done" | "error", error?: string): void {
    const id = this.targetId;
    if (!id) return;
    this.state = {
      ...this.state,
      messages: this.state.messages.map((m) =>
        m.id === id
          ? error === undefined
            ? { ...m, status }
            : { ...m, status, error }
          : m,
      ),
    };
    this.metrics = { ...this.metrics, totalMs: performance.now() - this.startedAt };
    this.emit();
  }

  private async *mock(prompt: string): AsyncGenerator<StreamEvent> {
    const text = scriptFor(prompt, this.state.model);
    const signal = this.ctrl?.signal;
    const target = this.targetId;

    if (prompt.trim() === "/error") {
      yield { type: "error", message: "insufficient_quota: mock 额度耗尽（验收 error 气泡）" };
      return;
    }
    if (prompt.trim().startsWith("/read") || prompt.trim().startsWith("/list")) {
      yield {
        type: "approval",
        id: "mock-ap",
        tool: prompt.trim().startsWith("/read") ? "read_file" : "list_dir",
        summary: "Mock 审批：允许这次只读工具？点允许后继续剧本。",
      };
    }

    // 先跑过程步骤，再出正文：界面据此演示“过程行 → 结论”的阅读顺序
    if (target) {
      for (let i = 0; i < MOCK_STEPS.length; i += 1) {
        const began = performance.now();
        this.patchSteps(target, (steps) =>
          steps.map((step, index) => (index === i ? { ...step, status: "running" as const } : step)),
        );
        await sleep(90 + i * 50);
        if (signal?.aborted) return;
        this.patchSteps(target, (steps) =>
          steps.map((step, index) =>
            index === i
              ? { ...step, status: "done" as const, durationMs: Math.round(performance.now() - began) }
              : step,
          ),
        );
      }
    }

    for (const chunk of chunks(text, 3)) {
      if (signal?.aborted) return;
      // 首字更快，模拟真实流式的预热差异
      await sleep(this.firstByteAt === 0 ? 90 : 26);
      if (signal?.aborted) return;
      yield { type: "delta", text: chunk };
    }
    yield { type: "done", usage: { prompt: prompt.length, completion: text.length } };
  }

  private async *remote(): AsyncGenerator<StreamEvent> {
    const res = await fetch(`${ENDPOINT}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.streamBody()),
      signal: this.ctrl?.signal ?? null,
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(payload) as StreamEvent;
          } catch {
            // 单帧坏 JSON 不能打断整条流，跳过即可（服务端已保证单行 JSON）
            continue;
          }
          yield event;
        }
      }
    } finally {
      // 调用方见到 done / error 会提前 break，这里必须显式取消，否则连接一直吊着
      void reader.cancel().catch(() => {});
    }
  }

  private streamBody() {
    const upstream = activeUpstream();
    return {
      model: this.state.model,
      messages: this.messagesFor(),
      session_id: this.state.sessionId,
      permission: this.state.permission,
      base_url: upstream.baseUrl,
      ...(upstream.apiKey ? { api_key: upstream.apiKey } : {}),
    };
  }

  /**
   * 请求体构造：HTTP 与 IPC 两条通道共用。
   * 本轮用户消息已在 state.messages 里（send() 先把本轮消息写入 state.messages 再发请求，
   * 落盘在请求结束后才做），这里只做原样映射，不再追加，否则上游会收到连续两条相同的 user 消息。
   * 空正文条目（含刚插入、尚未收到首帧的助手占位）不入请求体：服务端拒绝空白 content。
   */
  private messagesFor(): Array<{ role: string; content: string }> {
    return this.state.messages
      .filter((m) => m.status !== "error" && m.text.trim() !== "")
      .map((m) => ({ role: m.role, content: m.text }));
  }

  /**
   * 桌面通道：invoke chat_stream（壳内 HTTP 代理 → 后端 SSE），事件经 ipc::Channel 回流。
   * 事件形状与 remote() 相同，差异只在传输；中止走 chat_abort 丢弃下游连接。
   */
  private async *remoteIpc(): AsyncGenerator<StreamEvent> {
    const queue: StreamEvent[] = [];
    let wake: (() => void) | null = null;
    const events = new Channel<StreamEvent>();
    events.onmessage = (event: StreamEvent) => {
      queue.push(event);
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve();
      }
    };
    logDebug("调用 chat_stream（IPC 通道）", "engine");
    const body = this.streamBody();
    const id = await invoke<number>("chat_stream", {
      model: body.model,
      messages: body.messages,
      sessionId: body.session_id,
      permission: body.permission,
      baseUrl: body.base_url,
      ...(body.api_key ? { apiKey: body.api_key } : {}),
      onEvent: events,
    });
    logInfo(`chat_stream 已建立，id=${id}`, "engine");
    const signal = this.ctrl?.signal ?? null;
    const abort = () => {
      logInfo(`请求 chat_abort（id=${id}）`, "engine");
      void invoke("chat_abort", { id }).catch(() => {});
      // 中止发生在 await 等待下一帧时：唤醒卡住的迭代，让 send() 正常收尾（与 HTTP 中止语义一致）
      if (wake) {
        const resolve = wake;
        wake = null;
        resolve();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      while (true) {
        while (queue.length > 0) {
          const event = queue.shift();
          if (!event) continue;
          yield event;
          if (event.type === "done" || event.type === "error") return;
        }
        if (signal?.aborted) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      // 兜底中止：正常收尾后的 id 已不在 aborts 表里，chat_abort 对未知 id 是无害 no-op
      void invoke("chat_abort", { id }).catch(() => {});
      logDebug(`chat_stream 通道收尾（id=${id}）`, "engine");
    }
  }

  private emit(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }

  private savableMessages(): Array<{ role: string; content: string }> {
    return this.state.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.text.trim() !== "")
      .map((message) => ({ role: message.role, content: message.text }));
  }

  private persistSession = async (): Promise<void> => {
    const packed = this.savableMessages();
    if (packed.length === 0) return;
    const title =
      packed.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim().slice(0, 24) || "新会话";
    const id = this.state.sessionId ?? `s${Date.now()}`;
    if (isMock()) {
      localStorage.setItem(`lumine.session.${id}`, JSON.stringify(this.state.messages));
      const sessions = readLocalSessions().filter((session) => session.id !== id);
      sessions.unshift({ id, title, updatedMs: Date.now(), space: this.space });
      writeLocalSessions(sessions);
      this.state = { ...this.state, sessionId: id, sessions };
      this.emit();
      return;
    }
    const payload = { id, title, messages: packed, space: this.space };
    const saved = useIpc()
      ? await invoke<{ id?: string }>("put_session", { session: payload })
      : await (async () => {
          const res = await fetch(`${ENDPOINT}/api/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as { id?: string };
        })();
    this.state = { ...this.state, sessionId: saved.id ?? id };
    this.emit();
    await this.refreshSessions();
  };
}

const LOCAL_SESSIONS = "lumine.sessions.v1";

function readLocalSessions(): SessionSummary[] {
  try {
    const raw = localStorage.getItem(LOCAL_SESSIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<SessionSummary> & { id: string; title: string }>;
    return parsed.map((session) => ({
      id: session.id,
      title: session.title,
      updatedMs: session.updatedMs ?? 0,
      space: session.space === "agent" ? "agent" : "daily",
    }));
  } catch {
    return [];
  }
}

function writeLocalSessions(sessions: SessionSummary[]): void {
  localStorage.setItem(LOCAL_SESSIONS, JSON.stringify(sessions));
}

export const engine = new ChatEngine();
subscribeProviders(() => engine.syncModels());
void engine.refreshSessions();
