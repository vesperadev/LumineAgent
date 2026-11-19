# ISSUE-0003 后端丢弃上游错误正文，前端无法区分 401/429/额度不足

- 状态: open
- 类型: backend / 可观测性
- 优先级: P1
- 发现时间: 2026-11-19（roadmap 阶段 3「抓一次真实上游错误确认前端有可见表现」前置）
- 关联: `Docs/roadmap.md` 阶段 3；`Project/Lumine-rust/src/llm/chat.rs`

## 现象

上游返回非 2xx 时，用户侧只看到：

```
DeepSeek request failed: HTTP status client error (401 Unauthorized) for url (…)
```

上游正文里的真实原因（`{"error":{"message":"Authentication Fails"}}`、额度不足、限流、参数非法）全部丢失。
这几类错误在前端长得一模一样，阶段 3 要求的「上游 `error` 帧有可见表现」因此无法验证。
另外，网关/代理返回 HTML 或纯文本时同样没有可读信息。

## 根因

`Project/Lumine-rust/src/llm/chat.rs:87-104`：

1. `.error_for_status()` 把响应正文连同 `error.message` 一起丢掉，只剩 `reqwest::Error` 的状态码；
2. 成功路径 `.json::<Value>()` 后只取 `choices[0].message.content`，缺字段一律报 `UnexpectedResponse`，同样没有上下文。

## 期望

- 非 2xx：返回新变体 `ChatError::Upstream { status, message }`，`message` 优先取上游 `error.message`；
  非 JSON 正文退化为原文；正文为空给固定文案。
- `message`（含 `error.message` 主路径）统一先对 `sk-` 开头的令牌打码、再按字符截断到 300 字符，
  避免上游/网关回显密钥片段时把凭证写进日志（`AGENTS.md` §5）。
- 2xx 但缺 `content`：保持 `UnexpectedResponse`，行为不变。
- 不打印、不落盘 API Key；不改请求体、不改 URL、不加依赖。

## 验收标准

1. `cargo test` 全绿（基线 2 passed → 12 passed），新增用例覆盖：`error.message` 提取、纯文本正文、空正文、
   长正文按字符截断、`error.message` 主路径截断、message 内 key 打码、纯文本正文多 key 打码、
   `completion_text` 正常/缺失、`Upstream` 的 `Display`。
2. `cargo clippy --all-targets -- -D warnings` 全绿。
3. 不新增 crate 依赖（`Cargo.toml` 不动）。
4. 新增用例全部为纯函数，无网络、无密钥即可跑通（`AGENTS.md` §4）。

## 改动范围（点级）

唯一文件：`Project/Lumine-rust/src/llm/chat.rs`

- `ChatError` 增加 `Upstream { status: u16, message: String }`；
- `Display` / `source()` 各加一条分支（`Upstream` 无 source）；
- `chat()`：`send()` 后先判 `status.is_success()`，非成功读 `text()` 走新错误；
  成功路径改为 `completion_text(&payload)`；
- 新增私有纯函数 `upstream_error_message(&str) -> String`、`redact_secrets(&str) -> String`、
  `completion_text(&Value) -> Option<String>`，`MAX_UPSTREAM_CHARS = 300`；
- `tests` 模块增加上列用例。

## 审查记录（AGENTS.md §8）

- 第 1 轮：另一个 AI 只读审查，判定「需修复后提交」，P0 无，P1 两条：
  ① 主路径 `error.message` 未截断；② 上游正文未打码，可能回显 key 片段。
- 处理：两条 P1 均已修复（收口到 `redact_secrets` + 按字符截断），并新增 3 个针对性用例；
  修复后 `cargo test` 12 passed / `clippy` 无警告 / 真实 401 复测通过，提交第 2 轮复核结论。

## 非目标

- 不改 `main.rs` 的 REPL 交互与输出格式；
- 不加超时/重试/流式；
- 不动 `request_body` 与请求体字段；
- 不动前端 `core/engine.ts` 的错误展示（另立 issue）。

## 验证计划

`cargo test` → `cargo clippy --all-targets -- -D warnings` → 人工用无效 key 触发一次真实 401，确认 stderr 里有上游 message。

## 回滚

`git revert <sha>`。纯代码 + 测试改动，无数据/配置副作用。
