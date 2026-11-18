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
| `LUMINE_DATA_DIR` | 否 | 会话 JSON 目录，默认 `%LOCALAPPDATA%/LumineAgent` 或 `$HOME/LumineAgent` |

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
{ "model": "deepseek-chat", "messages": [{ "role": "user", "content": "…" }], "permission": "default", "session_id": "s1", "base_url": "https://api.openai.com/v1", "api_key": "…" }

200 text/event-stream
data:{"type":"delta","text":"…"}
data:{"type":"step","id":"…","label":"read_file","detail":"src/lib.rs","status":"running"}
data:{"type":"approval","id":"…","tool":"read_file","args":{"path":"src/lib.rs"},"summary":"…"}
data:{"type":"done","usage":{"prompt":12,"completion":34}}  正常结束（usage 为真实 token；上游未给时为 0）
data:{"type":"error","message":"…"}

GET    /api/sessions          → 会话列表（不含消息正文）
POST   /api/sessions          → upsert，空 id 则新建
GET    /api/sessions/{id}     → 含消息
DELETE /api/sessions/{id}
POST   /api/approvals         { "id": "…", "allow": true }
```

约定：

- 事件顺序是 `(delta|step|approval)*` → （`done` | `error`）；`done` 之后不再有事件。
- 错误一律走 `error` 事件（HTTP 仍为 200），前端只处理一种错误路径。发送 `/error` 会注入额度类 error 帧，供前端验收。
- 会话列表由服务端 JSON 文件保存；聊天正文仍可每次带齐。`session_id` 目前只作关联，不改流式语义。
- CORS 只放行配置的前端源，不使用 `*`。允许 GET/POST/DELETE。
- `GET /api/workspace/diff` 是只读工作树快照。非 git / 无改动 / git 不可用 → `[]`（200）。
- 只读工具：用户消息 `/list [path]`、`/read <path>`。`permission=default` 时先发 `approval`，等 `POST /api/approvals`；`full` 跳过审批。不写工作区、不跑任意命令。
- 打包版密钥：`%LOCALAPPDATA%/LumineAgent/secrets.env`（只含键名，由设置页写入，不进仓库）。
- `base_url` / `api_key` 只给本服务用来选上游，**不会**原样塞进上游 JSON。`base_url` 必须是 http/https 的 OpenAI 兼容根（自动补 `/chat/completions`）。`api_key` 为空则回退 `DEEPSEEK_API_KEY`。二者都不写进日志。

## 4. 模块

| 路径 | 职责 |
| --- | --- |
| `src/main.rs` | 命令行对话（保留，用于离线自测） |
| `src/bin/serve.rs` | HTTP 入口，读环境变量、装配路由 |
| `src/server.rs` | 路由、SSE 拼装、工作区快照、会话、审批 |
| `src/sessions.rs` | 会话 upsert / 列表（JSON 文件，离线可测） |
| `src/tools.rs` | `list_dir` / `read_file`，路径锁在工作区 |
| `src/approvals.rs` | 审批 oneshot 表 |
| `src/workspace.rs` | git 工作树快照 |
| `src/llm/chat.rs` | 非流式一次性对话 |
| `src/llm/stream.rs` | 流式解析 + `stream_options.include_usage` |

## 5. 设计约束

- 网络相关逻辑必须能在**无网络、无密钥**条件下被单元测试覆盖：解析、拼装、校验各自独立成纯函数。
- 上游分片按行累积解析，不假设一次 `chunk` 等于一个完整事件（TCP 边界与事件边界无关）。
- 不引入 agent 框架（LangChain / LlamaIndex 等）；工具调用等能力后续在 `src/agent/` 内自研。
- 不向上游透传客户端 `model` 之外的自定义字段，防止参数注入。`base_url` / `api_key` 只用于本服务选上游，不进入上游请求体。

## 6. 分支与提交

- 后端改动只在 `doubao/backend-*` 分支（当前 worktree 位于 `D:\WorkSpace\LumineAgent-backend`，分支 `doubao/backend-http`）。
- **不直接向 `main` 提交**；`Cargo.toml` / `Cargo.lock` 属共享文件，改动单独提交并说明原因。
- 同一能力若 Python 参照实现也要动，分两次提交、分两个 PR。

## 7. 已知未完成

- 模型原生 function calling（目前工具入口是 `/list` `/read` 斜杠命令）；
- 工作区快照暂不覆盖 submodule 深度规则（沿用 git 默认 ignore）。
