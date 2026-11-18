# AGENTS.md — 多 AI 并行协作约定

本仓库由多个 AI 编码助手（Cursor、豆包等）与人类维护者并行开发。
**任何 AI 在开始改动前，先读完本文件。** 这些约定对所有 AI 一视同仁，不区分工具。

## 1. 分支模型

- 每个 AI 只在自己的一条长期分支上工作。分支名格式：`<工具>/<主题>`，必要时带短哈希，例如
  `cursor/chat-multiturn-4fd2`、`doubao/agent-core`。
- `main` 是**集成分支**，只由人类维护者合并。**任何 AI 都不直接向 `main` 提交、合并或
  force push 到 `main`。**
- **别人的分支对你只读**：不提交、不 amend、不 rebase、不 force push 别人的分支，
  也不把别人的分支 merge 进自己的分支来自行"同步"。需要别人的改动，走下面第 3 条。
- 可以推送自己的分支（用于备份或请人 review），但不要设置写权限类的自动化。

## 2. 需要基于别人未合并的成果时

从**那条分支**新开一条自己的分支，而不是从 `main` 重来，也不要直接在对方分支上提交：

```bash
git fetch origin
git switch -c <自己的前缀>/<主题> origin/<对方分支>
```

在自己的分支里可以自由提交；要合回主线由人类决定，不由 AI 之间互相合并。

## 3. 共享文件要窄改

以下文件多个分支同时改动的概率高，改动请谨慎：

`Cargo.toml`、`Cargo.lock`、`.gitignore`、`README.md`、`AGENTS.md`、`.github/workflows/`

- 只改需要改的行，**不要顺手格式化整个文件**。
- 改动共享文件请单独放一个提交，并在提交信息里说明原因，方便合并时挑拣。
- 不要为了让自己的分支和 `main` 看起来一致而大规模 rebase + force push。

## 4. 提交前必须过的门槛

在 `Project/Lumine-rust` 目录内：

```bash
cargo test
cargo clippy -- -D warnings
```

CI（`.github/workflows/lumine-rust.yml`）在 PR 上跑同样两条命令。**门槛不绿不要提交。**
新增逻辑要带能在无网络、无密钥条件下跑通的测试。

前端（`Project/frontends/lumine-ui`）另有一条门槛：

```bash
npm run build   # tsc --noEmit && vite build
```

前端不写测试，但类型检查必须为零错误；改样式时额外保证亮/暗两套主题都实测过。

## 4.1 前端基线与规范

界面基线是 Percho（MIT）：`src/styles/globals.css`、`typography.css`、`ui/icons/` 与上游逐字一致，
**禁止手改**。换皮只允许覆盖 `--color-*` token（`src/styles/themes.css`），不允许改组件几何。
完整规范（目录职责、主题属性契约、性能约束、接口契约）见 `Docs/frontends/README.md`；
后端契约与门槛见 `Docs/backend/README.md`（与后端代码同分支提交，不在前端分支）。改动前端或接口的 AI 必须先读这两份。


## 5. 密钥与敏感信息

- `.env` 已在 `.gitignore` 中，内含 `DEEPSEEK_API_KEY`。
- **禁止把 `.env` 内容、任何 API Key、抓包日志写进提交、文档、提交信息或 issue。**
- 新增配置项请补到 `.env.example`（若不存在则新建），只写键名和占位值。

## 6. 目录职责

| 路径 | 职责 |
| --- | --- |
| `Project/Lumine-rust` | 主实现：自研精简 Agent，直连 DeepSeek OpenAI 兼容接口，对外提供 HTTP + SSE |
| `Project/Lumine-python` | 参照实现：LangChain `create_agent`，用于对照学习，不作为产品后端 |
| `Project/frontends/lumine-ui` | 唯一前端：React 19 + TS + Vite，界面基线 Percho |
| `Docs/` | 设计文档、架构说明、协作记录 |

同一项能力若两个实现都要动，请**分两次提交、分两个 PR**，不要跨目录混在一个提交里。

## 7. 交付汇报

每次改动结束，向人类汇报四件事：

1. 改了哪些文件
2. 影响范围（哪些模块、哪些分支会受影响）
3. 回滚方式（具体命令，例如 `git revert <sha>` 或 `git restore <path>`）
4. 未处理项与已知限制

不要用"应该可以""理论上没问题"代替实跑证据。

## 8. 代码交付前必须经另一个 AI 审查

**任何代码改动（前端、后端、脚本）在交给人类之前，必须先由「另一个 AI」做一次只读审查。**
执行改动的 AI 不能自己给自己出审查结论，也不能用「门槛已绿」代替审查。

审查要求：

- 只读：不改文件、不格式化、不执行 `git commit` / `push` / `branch`。
- 必须给出总判定 `可以提交 / 需修复后提交 / 阻断`，并按 P0（阻断）/ P1（提交前应改）/ P2（可后续）列到 `文件:行`。
- **P0 清零、P1 处理完**并重新跑过门槛命令，才算审查通过；P1 若选择不修，必须在汇报里写明理由。
- 审查开始前，改动方要提供：改动文件清单、已跑过的门槛命令与结果、需要重点核对的点（契约一致性、安全、边界条件）。
- 交付汇报里要带上审查结论：审查者标识、最终判定、未修项。

豁免：纯文档 / 注释 / 排版类改动，以及 `git revert` 回滚操作，可不出审查，但要在汇报里注明「未审查及原因」。

## 9. 明确不做的事

- 不主动改人类或其他 AI 的未提交改动（`git stash`、`git checkout --`、`git clean` 一律先问）。
- 不删除、不覆盖、不批量替换非本次任务范围内的文件。
- 不擅自更换技术栈或重构模块边界；有不同意见请标注为**建议**，不直接执行。
