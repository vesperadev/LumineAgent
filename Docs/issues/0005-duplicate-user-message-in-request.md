# 0005 — 请求体把当前用户消息发了两遍

- 状态: open
- 来源: `Docs/reviews/2026-11-21-ten-review.md` 第 3 节 P1-#1（R1 正确性）
- 类别: 前端（`Project/frontends/lumine-ui`）

## 现象

每条消息发出去时，上游收到的 `messages` 里，本轮用户提问出现两次：

```
[..., { role: "user", content: "你好" }, { role: "user", content: "你好" }]
```

## 根因

`send()` 先把本轮用户消息推进 `state.messages`：

- `src/core/engine.ts:397` 构造 `userMsg`（`text: prompt`）
- `src/core/engine.ts:410` `messages: [...this.state.messages, userMsg, assistantMsg]`

随后 `streamBody()` → `messagesFor()` 再次追加一条同样的用户消息：

- `src/core/engine.ts:648` `messages: this.messagesFor(prompt)`
- `src/core/engine.ts:657-665` 返回「过滤后的 state.messages + `{ role: "user", content: prompt }`」

`messagesFor` 只过滤「status=error」和「正文为空」的条目，本轮的 user 消息正文非空，因此被保留；末尾再追加一次，就成了连续两条相同 user 消息。

## 影响

- HTTP 与 IPC 两条通道共用 `streamBody`，两条都受影响。
- 后端（`Project/Lumine-rust`）只做透传（`src/llm/chat.rs:106-119` 原样映射），不会去重。
- 后果：模型看到重复提问，多花 token；遇到对「连续 user 消息」敏感的兼容端点时行为不可预期。
- mock 通道不构造请求体，不受影响。

## 期望

`messages` = 完整历史，**末尾是本轮用户输入一次**。

## 改动点（点级）

1. `src/core/engine.ts:657` 去掉 `messagesFor` 的 `prompt` 参数。
2. `src/core/engine.ts:659-664` 删除追加的 `{ role: "user", content: prompt }` 一项。
3. `src/core/engine.ts:644-648` `streamBody()` 同步去掉 `prompt` 参数，`messagesFor()` 调用改为无参。
4. `src/core/engine.ts:606`（`remote`）与 `:684`（`remoteIpc`）的 `streamBody(prompt)` 改为 `streamBody()`。
5. 注释同步：`messagesFor` 说明改为「历史原样映射，本轮用户消息已在 state.messages 里」。

## 验收

- `npm run build` 零错误（tsc 会直接暴露改签名后漏改的调用点）。
- 离线核对：构造一次 `send("你好")`，断言发给上游的 `messages` 末尾只有一条 `role=user, content=你好`，且总条数 = state.messages 过滤后条数。前端不写测试，按约定用仓库外 `node --experimental-strip-types` 脚本或「肉眼 + 日志」证明，并把手跑步骤写进当日记录。
- 真实上游只用无效占位 key 触发错误路径，不用真实 key 发正式请求。

## 回滚

```bash
git revert <本次 commit sha>
```

## 非目标

- 不改请求体其它字段（`session_id` / `permission` / `base_url` / `api_key`）。
- 不动 `savableMessages`（存盘口径与发请求口径本就不同，另立 issue 写清差异）。
- 不改后端。
