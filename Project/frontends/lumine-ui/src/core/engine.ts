import type { ChatState, Message, Metrics, SendResult, Step, StreamEvent } from "./types";

const MODELS = ["deepseek-chat", "deepseek-reasoner"] as const;

/** Mock 下的过程步骤：只为验证“过程行”的排版与状态切换，接真实后端后由 step 事件填充 */
const MOCK_STEPS: ReadonlyArray<Pick<Step, "id" | "label" | "detail">> = [
  { id: "plan", label: "梳理需求与现有结构", detail: "项目树" },
  { id: "read", label: "读取相关文件", detail: "src/main.py" },
  { id: "patch", label: "生成改动", detail: "3 处修改" },
  { id: "test", label: "运行验证", detail: "cargo test" },
];

const ENDPOINT = (import.meta.env.VITE_LUMINE_ENDPOINT as string | undefined) ?? "";

/** mock 判定只有这一处：hooks 与 UI 徽标都引用它，避免「显示 remote 实际走剧本」 */
export const isMock = (): boolean => ENDPOINT.trim().length === 0;

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

export class ChatEngine {
  private state: ChatState = {
    model: MODELS[0],
    models: MODELS,
    messages: [],
    phase: "idle",
    error: null,
    retryText: null,
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

  reset = (): void => {
    this.stop();
    this.buffer = "";
    this.targetId = null;
    this.state = { ...this.state, messages: [], phase: "idle", error: null, retryText: null };
    this.metrics = zeroMetrics();
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
      ...(isMock() ? {} : { steps: MOCK_STEPS.map((step) => ({ ...step, status: "pending" as const })) }),
    };

    this.state = {
      ...this.state,
      messages: [...this.state.messages, userMsg, assistantMsg],
      phase: "streaming",
      error: null,
      retryText: null,
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
      const events = isMock() ? this.mock(prompt) : this.remote(prompt);
      for await (const event of events) {
        if (event.type === "delta") {
          if (this.firstByteAt === 0) {
            this.firstByteAt = performance.now();
            this.metrics = { ...this.metrics, firstByteMs: this.firstByteAt - this.startedAt };
          }
          this.buffer += event.text;
          this.metrics = { ...this.metrics, chunks: this.metrics.chunks + 1 };
          this.scheduleFlush();
        } else if (event.type === "error") {
          throw new Error(event.message);
        } else {
          break;
        }
      }
      this.flush();
      this.finish("done");
      return { ok: true };
    } catch (cause) {
      this.flush();
      const aborted = this.ctrl?.signal.aborted === true;
      if (aborted) {
        this.finish("done");
        return { ok: true };
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      this.finish("error", message);
      this.state = { ...this.state, phase: "error", error: message, retryText: this.lastPrompt };
      this.emit();
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

  private async *remote(prompt: string): AsyncGenerator<StreamEvent> {
    const res = await fetch(`${ENDPOINT}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.state.model,
        messages: [
          ...this.state.messages
            .filter((m) => m.status !== "error")
            .map((m) => ({ role: m.role, content: m.text })),
          { role: "user", content: prompt },
        ],
      }),
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

  private emit(): void {
    this.version += 1;
    for (const fn of this.listeners) fn();
  }
}

export const engine = new ChatEngine();
