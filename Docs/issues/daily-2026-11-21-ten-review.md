# 当日记录 2026-11-21 — 十评审批次

> 与定时任务自动建的 `daily-2026-11-21.md` 分开命名，避免两边互相覆盖。

## 今天做了什么

两件事：

1. **建了一套 `AGENT.md`**（13 个文件，仿 `D:\WorkSpace\Lumine` 的写法：规则必须可验证、严重度三档、证据优先）：
   `Docs/agents/AGENT.md`（总纲：分工表、只评本格、三档严重度、评审员没有编译器、派发四件套、处置二选一、收敛三条、轮次纪律、互斥意见、本项目红线）+ `Docs/agents/R1..R10/AGENT.md`（一人一维，互不重叠，各带判定口径与输出格式）。
2. **用这十份人设跑了第一轮全仓审查**，回收十份结论并落 `Docs/reviews/2026-11-21-ten-review.md`：**阻断 0**，P1 12 项，P2 5 项，无互斥。随后修掉 R1 的 P1-#1（请求体把当前用户消息发两遍），并跑第二轮十评审复审。

## 改动文件

| 文件 | 内容 |
| --- | --- |
| `Docs/agents/AGENT.md` | 十评审团队章程（99 行） |
| `Docs/agents/R1..R10/AGENT.md` | 十份评审员人设（各约 28 行） |
| `Docs/reviews/2026-11-21-ten-review.md` | 第 1 轮结论汇总（判定表、P0/P1/P2、互斥、处置） |
| `Docs/issues/0005-duplicate-user-message-in-request.md` | P1-#1 的点级 issue（现象/根因/验收/回滚/非目标） |
| `Project/frontends/lumine-ui/src/core/engine.ts` | 删掉 `messagesFor()` 末尾重复追加的本轮 user 消息；连带去掉 `messagesFor` / `streamBody` / `remote` / `remoteIpc` 已无用的 `prompt` 参数 |

`src/core/engine.ts` 净改动：13 增 / 13 删，仅一个文件。未动共享文件、未动 `src-tauri/`、未动 Percho 冻结区。

## 门槛实跑

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 改前基线（后端） | `cargo test` | 2 passed / 0 failed |
| 改前基线（后端） | `cargo clippy --all-targets -- -D warnings` | 零警告 |
| 改前基线（前端） | `npm run build` | 47 modules、322ms、类型零错误 |
| 改后（第一次） | `npm run build` | **红**：`TS6133 'prompt' is declared but its value is never read`（`engine.ts:602,671`） |
| 改后（补删无用参数） | `npm run build` | 47 modules、321ms、零错误 |
| 注释微调后 | `npm run build` | 47 modules、492ms、零错误 |

第一次红说明 tsc 确实守住了签名改动：漏改调用点会被拦住。

## 审查结论

- 第 1 轮（全仓，HEAD `83975a2`）：10 位，**阻断 0**；R1/R3/R4/R5/R6/R7/R8/R9/R10 需修复，R2 通过（建议级）。详见 `Docs/reviews/2026-11-21-ten-review.md`。
- 第 2 轮（只审本次 diff，同一位评审组长带同一批 R1–R10 复审）：**9 通过 / 1 应改（R4 证据缺口）**，总判定 **可以提交**。
- R4 的应改（缺「只发一条 user」的离线证据）按章程 §6 记「不修 + 理由」：
  1. 前端约定不写测试、不加测试框架或 devDependency；
  2. `engine.ts` 依赖 Tauri API 与 extensionless 相对导入，Node 直连导入实测失败（`ERR_MODULE_NOT_FOUND: src/theme/store`）；
  3. 手跑需要 Tauri 桌面壳 + 真实上游，与「不用真实 key 发正式请求」的约定冲突；
  4. 现有证据：tsc 零错误 + 静态事实（`send()` 在 `engine.ts:397/410` 先写入 `state.messages`，`messagesFor` 只做过滤+映射）+ diff 只删一处追加。
  5. TODO（下一格）：把请求体构造抽成纯函数（如 `core/messages.ts` 的 `toRequestMessages`），就能用 `node --experimental-strip-types` 直接断言，不必引入框架。

## 未修项（P1 排队，按一次一件事）

1. `engine.ts:323-330` mock 分支 `localStorage` `JSON.parse` 无 try/catch。
2. `ui/PrefsModels.tsx:321` 上游错误体原文直接上屏。
3. `engine.ts:610` HTTP 非 2xx 只抛状态码，丢 body 与请求 id。
4. 会话四个 HTTP 分支失败无状态码 / 无 UI 反馈。
5. `openSession` 并发无序号守卫；`persistSession` 晚到覆盖。
6. 环境判定 8 处重复源（收成单一判定函数）。
7. 部分 `ui` 组件绕过 `core` 直接 `invoke`。
8. `workspace.ts` 四个导出的离线断言（依赖上面的纯函数抽取）。
9. 文档对账：README §9 缓冲 500 vs `logger.ts:25` 300、`issue 0002` 已实现仍 open、README §2/§7/§10 漏登记。

## 已知限制

- 第 2 轮复审发现一条既有行为（非本 diff 引入）：失败后重试时，上一轮失败留下的 user 消息仍在 `state.messages` 里，可能与本轮提问一起发出。**本轮未修，记 TODO**（需要先定「失败轮是否应整轮撤掉」的口径，属另一格）。
- 真实上游行为未验证（按约定不用真实 key 发正式请求）；错误路径只用无效占位 key 才能触发，本轮没跑。

## 回滚

```bash
git revert <code-sha>    # 撤销 engine.ts 修复
git revert 85cec75       # 撤销 AGENT.md 套件与第 1 轮记录
```

## 提交

- `85cec75` docs(agents)：AGENT.md 套件 + 第 1 轮结论 + issue 0005（纯文档，免审查，已在提交信息注明）
- `<code-sha>` fix(ui)：请求体重复用户消息（见提交正文：第 2 轮十评审是 9 通过 / 1 应改，R4 按 §6 书面不修）
