# 0007 — openSession 的失败收尾与 steps 形状（排队项）

- 状态: open（排队，未修）
- 来源: 第 3 轮十评审（`Docs/issues/0006-local-session-parse-guard.md` 同批）
- 类别: 前端（`Project/frontends/lumine-ui`）
- 性质: 本轮按「一次只改一件事」**不修**，两条理由已在确认复审中核为成立。

## A. early-return 未按 reset 口径收尾（R6 应改，R1 建议）

`src/core/engine.ts` `openSession` 的 mock 分支有两条早退：`325` 的 `if (!packed) return` 与本次新增的 catch 分支 `return`。两者都在 `stop()` + `persistSession()` 之后直接返回，没有像 `reset()` 那样清 `phase`/`ctrl`/`targetId`/`buffer`/挂起的 `raf`。

**为什么不本轮修**：这是既有 `if (!packed) return` 的同形行为，本次只多了一条同形早退；`send()` 的 `finally`（`engine.ts:487-498`）会把 `phase` 拉回 `idle` 并清 `ctrl`/`targetId`/`raf`，时序上能自愈。要彻底对齐 `reset()` 得动 phase/raf 生命周期，属另一格。

**验收设想**：切会话时中断一条正在流的回复 → 目标会话存档损坏 → 点了之后不应出现「永远停止态」；`phase`、`ctrl`、`raf` 三者与 `reset()` 后一致。

## B. 失败无 UI 提示（R10 应改）

现只在日志里写「本地会话读取失败」，界面上用户看到的是「点了没反应」，无法区分「会话损坏」与「没点中」。

**为什么不本轮修**：`ChatState.error` 目前没有渲染出口（error 气泡只挂在单条消息上），要加提示需要新的 UI 入口与文案口径，属另一格。

**验收设想**：损坏会话被点击后，界面出现一次性提示（可关闭），文案说明「该会话存档损坏，已停在当前会话」。

## C. steps 非数组时渲染层会抛错（确认复审发现的 P2 残留）

`src/ui/MessageBlock.tsx:86` 对 `steps` 调 `.reduce`；若存档里 assistant 行带 `steps: {}`（合法 JSON 但不是数组），渲染直接抛错。

本轮的元素校验只核 `role` 与 `text`（那是 `messagesFor` / `persistSession` 会用到的字段），未覆盖 `steps`。

**验收设想**：渲染前对 `steps` 做 `Array.isArray` 守卫（或在读取时就把非数组 `steps` 丢弃）。

## 回滚

无（本文件为待办记录，不含代码）。
