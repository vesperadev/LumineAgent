# Lumine 后端（Project/Lumine-rust）

LumineAgent 的主实现。自研精简 Agent，直连 DeepSeek OpenAI 兼容接口；对外只暴露一套 HTTP + SSE 契约，
供 `Project/frontends/lumine-ui` 消费。

`Project/Lumine-python` 是参照实现（LangChain `create_agent`），用于对照学习，**不作为产品后端**。

## 1. 命令

```bash
cd Project/Lumine-rust
cargo run              # 命令行对话（现有人工输入循环）
cargo run --bin serve  # HTTP 服务，默认 127.0.0.1:8080
cargo test             # 门槛一
cargo clippy -- -D warnings   # 门槛二
```

两条门槛命令必须同时绿，CI（`.github/workflows/lumine-rust.yml`）在 PR 上跑同样两条。
交付前还要按 `AGENTS.md` §8 由另一个 AI 做只读审查，P0/P1 清零。

## 2. 环境变量

| 键 | 必填 | 说明 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 只从 `.env` 读；缺失时接口返回 `error` 事件而不是崩溃 |
| `LUMINE_ADDR` | 否 | 服务监听地址，默认 `127.0.0.1:8080` |
| `LUMINE_MODEL` | 否 | 默认模型，默认 `deepseek-chat` |
| `LUMINE_CORS_ORIGIN` | 否 | 允许的前端源，默认 `http://localhost:5317` |
| `LUMINE_WORKSPACE` | 否 | 改动快照扫描的仓库根目录，默认进程当前工作目录 |

`.env` 已被 git 忽略。**禁止**把 key、抓包内容写进日志、提交、文档或 issue。
占位键名见 `Project/Lumine-rust/.env.example`。

## 3. 对外契约

```
GET  /health              → {"status":"ok","model":"deepseek-chat"}

GET  /api/workspace/diff
200 application/json
[
  { "path": "src/main.rs", "status": "mod", "diff": "--- a/src/main.rs\n+++ b/src/main.rs\n@@ ..." },
  { "path": "new.txt", "status": "add", "diff": "--- /dev/null\n+++ b/new.txt\n@@ ..." },
  { "path": "gone.rs", "status": "del", "diff": "--- a/gone.rs\n+++ /dev/null\n@@ ..." }
]

POST /api/chat/stream
{ "model": "deepseek-chat", "messages": [{ "role": "user", "content": "…" }] }

200 text/event-stream
data:{"type":"delta","text":"…"}          逐片增量
data:{"type":"done","usage":{"prompt":0,"completion":0}}   正常结束
data:{"type":"error","message":"…"}       错误（含上游不可达、缺 key）
```

约定：

- 事件顺序是 `delta*` → （`done` | `error`），**不混发**；`done` 之后不再有事件。
- 错误一律走 `error` 事件（HTTP 仍为 200），前端只处理一种错误路径。
- 服务端不保存会话历史，历史由调用方每次带齐（前端保持单会话上下文）。
- CORS 只放行配置的前端源，不使用 `*`。`GET /api/workspace/diff` 与聊天共用同一套 CORS（允许 GET）。
- `GET /api/workspace/diff` 是只读工作树快照：相对 `HEAD` 的增删改（含未跟踪文件）。`status` 仅 `add` | `mod` | `del`。
- 扫描根目录由 `LUMINE_WORKSPACE` 决定，未设则用进程 cwd。目录不是 git 仓库、没有改动、或 `git` 不可用时返回 `[]`（HTTP 200），不 500。
- 不做工具调用、不写工作区、不跑审批。单文件 diff 超过 64KiB 会截断。

## 4. 模块

| 路径 | 职责 |
| --- | --- |
| `src/main.rs` | 命令行对话（保留，用于离线自测） |
| `src/bin/serve.rs` | HTTP 入口，读环境变量、装配路由 |
| `src/server.rs` | 路由、请求体校验、SSE 事件拼装、工作区快照入口 |
| `src/workspace.rs` | git 工作树快照：porcelain 解析、unified diff 切分（纯函数，离线可测） |
| `src/llm/chat.rs` | 非流式一次性对话（既有） |
| `src/llm/stream.rs` | 流式：上游 SSE 分片解析 → `delta` 事件 |

## 5. 设计约束

- 网络相关逻辑必须能在**无网络、无密钥**条件下被单元测试覆盖：解析、拼装、校验各自独立成纯函数。
- 上游分片按行累积解析，不假设一次 `chunk` 等于一个完整事件（TCP 边界与事件边界无关）。
- 不引入 agent 框架（LangChain / LlamaIndex 等）；工具调用等能力后续在 `src/agent/` 内自研。
- 不向上游透传客户端 `model` 之外的自定义字段，防止参数注入。

## 6. 分支与提交

- 后端改动只在 `doubao/backend-*` 分支（当前 worktree 位于 `D:\WorkSpace\LumineAgent-backend`，分支 `doubao/backend-http`）。
- **不直接向 `main` 提交**；`Cargo.toml` / `Cargo.lock` 属共享文件，改动单独提交并说明原因。
- 同一能力若 Python 参照实现也要动，分两次提交、分两个 PR。

## 7. 已知未完成

- 工具调用（读写文件、跑命令）与审批流；
- `/api/sessions` 会话持久化；
- 上游用量（usage）透传（当前 `done` 里固定 0，待接 `stream_options.include_usage`）；
- 工作区快照暂不覆盖 submodule / 未跟踪目录的深度忽略规则以外的内容（沿用 git 默认 ignore）。
