# 十评审结论 2026-11-21

- 评审对象：`D:\WorkSpace\LumineAgent` 当前 HEAD（分支 `fix/tauri-hide-backend-console`，`83975a2`）的 `Project/frontends/lumine-ui/src` 与 `Project/Lumine-rust/src`
- 评审方式：按 `Docs/agents/AGENT.md` 分工，R1–R10 十个只读子 AI 各评一维，由评审组长汇总
- 门槛基线（派发方实跑注入）：`cargo test` **2 passed / 0 failed**；`cargo clippy --all-targets -- -D warnings` **零警告**；`npm run build` **47 modules、322ms、类型零错误**
- 范围内的排除项：`src-tauri/` 他人未提交改动、Percho 冻结区（`globals.css` / `typography.css` / `ui/icons/`）、`Docs/reference/` 与 `Docs/Pi*` 参考副本

## 1. 十份总判定

| 评审员 | 判定 | 主要落点 |
| --- | --- | --- |
| R1 正确性 | 需修复 | 请求体把当前用户消息发两遍（`engine.ts:657-665`）；另有多条边界建议 |
| R2 契约与影响 | 通过 | IPC/HTTP 字段（`model`/`messages`/`session_id`/`permission`/`base_url`/`api_key`）camelCase↔snake_case 双向一致；`/api/models` 双通道包络差异前端已正确分支，仅建议级 |
| R3 架构与边界 | 需修复 | 环境判定 8 处重复源；`ENDPOINT` 与 `transport()` 双来源；部分 `ui` 组件绕过 `core` 直接 `invoke` |
| R4 测试与证据 | 需修复 | 本轮新增的纯函数（`workspace.ts` 四个导出）无任何入库的离线断言；`abort`/SSE 分片/IPC 队列无可离线复现手段且未点名手跑步骤 |
| R5 安全与稳健 | 需修复 | `engine.ts:326` mock 分支 `JSON.parse` 无 try/catch；`PrefsModels.tsx:321` 上游错误体原文直接上屏；Rust 侧无密钥泄露路径 |
| R6 并发与异步 | 需修复 | `openSession` 并发无序号守卫；`persistSession` 晚到覆盖；`WindowControls` unlisten 异步赋值（自撤一条不成立的 TDZ 误判） |
| R7 性能与分配 | 需修复（多为建议） | `flush` 每帧全量 `map`；Markdown 流式每块全量重解析；`MessageBlock` 未 memo |
| R8 命名与注释 | 需修复（建议级） | `Markdown.tsx:5` 写「十种风格」而只有 5 套 PALETTES；`savableMessages` 与 `messagesFor` 过滤口径差异未注释；`isTauri`/`inTauri` 双命名 |
| R9 兼容与文档 | 需修复（建议级） | README §9 环形缓冲 500 条 vs `logger.ts:25 BUFFER_LIMIT = 300`；`issue 0002` 仍 open 而 HEAD 已实现；README §2/§7/§10 漏登记 |
| R10 可观测与错误信息 | 需修复 | `engine.ts:610` HTTP 非 2xx 只抛 `HTTP <status>`；会话级 HTTP 分支无状态码/无 UI 反馈；`workspace.ts:97-103` 空快照与失败同文案 |

## 2. 阻断（P0）

**0 条**。十份里没有任何一份给出会造成错误结果 / 丢数据 / 崩溃 / 静默失败的结论。

## 3. 应改（P1）

| # | 位置 | 问题 | 现状 |
| --- | --- | --- | --- |
| 1 | `core/engine.ts:657-665` | `messagesFor()` 在 `state.messages` 已含本轮 user 消息（`engine.ts:397,410`）之后又追加一次 `{ role: "user", content: prompt }`，上游收到连续两条相同 user 消息 | 已复核成立；本轮修复 |
| 2 | `core/engine.ts:323-330` | mock 分支 `localStorage` 的 `JSON.parse` 无 try/catch，坏数据让切会话抛未捕获异常 | 未修 |
| 3 | `ui/PrefsModels.tsx:321` | 上游错误体原文直接上屏，缺收敛与打码 | 未修 |
| 4 | `core/workspace.ts:30-39` | `diffStats` 用 `startsWith("+++")/("---")` 认文件头，hunk 内 `--old`/`++new` 正文被跳过，增删计数偏小 | **已修**：`doubao/frontend-diff-parse` `fae4bf1` |
| 5 | `Lumine-rust/src/llm/chat.rs:87-98` | `.error_for_status()` 丢弃上游错误正文，401/额度/限流不可区分 | **已修**：`doubao/backend-upstream-errors` `27d4ae9` |
| 6 | `core/engine.ts:610` | HTTP 非 2xx 只 `throw new Error("HTTP <status>")`，丢 body 与请求 id | 未修 |
| 7 | `core/engine.ts` 会话四个 HTTP 分支 | 失败无状态码、无 UI 反馈，只留空列表 | 未修 |
| 8 | `core/engine.ts`（`openSession`/`persistSession`） | 并发切会话无序号守卫；晚到的 `persistSession` 覆盖新会话 | 未修 |
| 9 | `core/engine.ts`（环境判定） | Tauri/通道判定 8 处重复源，`ENDPOINT` 与 `transport()` 双来源 | 未修（修法应走窄改：抽一个判定函数） |
| 10 | `ui/*` | 部分组件绕过 `core` 直接 `invoke`，与 `core` 的通道判定分叉 | 未修 |
| 11 | `core/workspace.ts` 四个导出 | 无任何入库的离线断言；前端不写测试的约定下也没留手跑步骤 | 未修 |
| 12 | `Docs/frontends/README.md` §9 / `logger.ts:25` / `Docs/issues/0002` | 文档与实现不一致（500 vs 300、issue 已实现仍 open、模块清单漏登记） | 未修 |

多票项：#1（R1 提出、R10 侧证请求体语义）、#4（R1 与 R10 同指解析层）、#5（R10 独立复核）。

## 4. 建议（P2，只列最高价值 5 条）

1. `MessageBlock` 未 memo + `flush` 每帧全量 `map`：长会话流式时是主要重渲染成本（R7）。
2. Markdown 流式每块全量重解析：可只在块边界重算（R7）。
3. `Markdown.tsx:5` 注释「十种风格」与 5 套 PALETTES 不符（R8）。
4. `savableMessages` 与 `messagesFor` 两套过滤口径（一个存盘、一个发请求）未写清差异（R8）。
5. R2：会话列表 `updatedMs` / `updated_ms` 双读而类型声明只有一种，建议在类型里写死契约（R2）。

## 5. 互斥意见

无。R6 自行撤销了一条「`remoteIpc` finally TDZ」判断（throw 在 try 之前，finally 不会执行），属于评审员自查，不算互斥。

## 6. 汇总判定

**需修复后提交**：P0 = 0，P1 共 12 项，其中 2 项已在我自己的分支上修过（#4、#5），本轮另修 #1；其余 9 项按「一次只改一件事」排队。

## 7. 本轮处置

| 项 | 处置 |
| --- | --- |
| #1 请求体重复用户消息 | **修**：删除 `messagesFor` 末尾追加的 `{ role: "user", content: prompt }`，并去掉随之无用的 `prompt` 参数 |
| #4 / #5 | 不修（已在他分支修过，本分支不重复改） |
| 其余 P1 | 不修本轮：超出「一次只改一件事」，逐日记入 `Docs/issues/` 排队 |
| P2 | 不修：口味与优化，只记录 |

## 8. 复现方式

- 十份结论可重跑：`Docs/agents/AGENT.md` 派发口径 + 各 `Docs/agents/R<n>/AGENT.md` 人设。
- 本轮无人跑真实模型、无人使用真实 key，全部为只读静态审查。
