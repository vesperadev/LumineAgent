# 0006 — mock 分支读取本地会话时坏数据会打穿切换

- 状态: open
- 来源: `Docs/reviews/2026-11-21-ten-review.md` P1-#2（R5 安全与稳健）
- 类别: 前端（`Project/frontends/lumine-ui`）
- 承接: `Docs/issues/0005-duplicate-user-message-in-request.md` 之后的下一格（一次只改一件事）

## 现象

mock 通道下点击侧栏会话（`openSession`），若 `localStorage` 里该会话的消息体损坏（被外部工具改过、写了一半、或旧版本格式），整次切换直接抛未捕获异常：

- 调用方拿不到返回，界面停在原会话；
- 控制台只有一条原始异常栈，没有「哪个会话、哪一步」的上下文。

同一文件里 `readLocalSessions()`（`engine.ts:776-790`）已经用 try/catch 兜住列表数据，只有会话正文这条路径漏了——两处口径不一致。

## 根因

`src/core/engine.ts:323-330`：

```ts
if (isMock()) {
  const packed = localStorage.getItem(`lumine.session.${id}`);
  if (!packed) return;
  const messages = JSON.parse(packed) as Message[];   // ← 无 try/catch，且不校验形状
  this.space = ...;
  this.state = { ...this.state, sessionId: id, messages, phase: "idle", error: null };
```

`JSON.parse` 抛错时异常向上冒，`openSession` 的调用方没有任何 catch。形状也不校验：内容若是 `{}`、`"str"`、`null`，`messages` 会变成非数组，随后 `state.messages` 上的 `.filter` / `.map` 会再炸一次。

## 期望

- 坏数据在本地拦下：不切换、不写坏状态、不抛未捕获异常。
- 记一条带会话 id 的错误日志（日志级别 error，经 `logger.ts`），但不打印消息正文（正文可能含用户隐私）。

## 改动点（点级）

1. `src/core/engine.ts:326`：`JSON.parse(packed)` 包进 try/catch，并对结果做 `Array.isArray` 形状校验。
2. `src/core/engine.ts:326-330`：失败时 `logError(\`本地会话读取失败（${id}）\`, "engine")` 后 `return`，不改 `state`、不切 `sessionId`。
3. 注释写明「为什么中止而不是退回空历史」：静默清空等于丢用户会话，宁可停在原会话并留日志。

## 验收

- `npm run build` 零错误。
- 离线/手跑：
  - 把 `lumine.session.<id>` 改成 `{{{` 后点该会话 → 不抛未捕获异常、界面仍在原会话、日志里有一条 `本地会话读取失败`。
  - 改成 `{}`（合法 JSON 但非数组）→ 同上。
  - 正常存档 → 行为与改前一致（能切换、消息完整）。
- 不涉及网络与密钥，全程不需要真实 key。

## 非目标

- 不改 `readLocalSessions()`（已有兜底）。
- 不加 UI toast（需要新的交互入口，另立 issue）。
- 不动 IPC/HTTP 通道的会话读取（那条路径的失败处理属 P1-#7，另做）。

## 回滚

```bash
git revert <本次 commit sha>
```
