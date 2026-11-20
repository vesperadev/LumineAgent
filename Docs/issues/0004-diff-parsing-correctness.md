# ISSUE-0004 diff 解析把末尾换行当成上下文行、把 `--`/`++` 开头的正文当文件头

- 状态: open
- 类型: frontend / 展示正确性
- 优先级: P2（不影响对话主链路，但会让 diff 面板的行号与增删统计说假话）
- 发现时间: 2026-11-20（每日推进；读 `core/workspace.ts` 时定位）
- 关联: `Docs/frontends/README.md` §7 接口契约、`src/ui/DiffSidebar.tsx`

## 现象

1. **每个文件末尾多一行空上下文行**：`git diff` 文本以 `\n` 结尾，`split("\n")` 会多出一个空串；
   `parseUnifiedDiff` 只挡了「首行为空」，对末尾空串照样 push 一条 `ctx` 行，于是面板末尾永远多一行
   空白，且它带着 `oldNo/newNo` 递增，后面的行号看起来是错的。
2. **增删统计会漏计**：`diffStats` 用 `startsWith("+++") / startsWith("---")` 判断文件头，
   但 hunk 内的正文也可能以 `--` / `++` 开头（例如删除一行 `--old`，diff 行就是 `---old`），
   这类行被当成文件头跳过，`+N/−M` 徽标显示的数目小于实际。

## 根因

`Project/frontends/lumine-ui/src/core/workspace.ts:30-84`：

- `diffStats`：`line.startsWith("+++") || line.startsWith("---")`，既没要求头部有空格，也没限定「首个 hunk 之前」；
- `parseUnifiedDiff`：`if (raw.length === 0 && rows.length === 0) continue;` 只能挡住首行空串，
  末尾空串落到 `rows.push({ kind: "ctx", ... })` 分支。

## 期望

- diff 文本末尾的换行不产生任何行；
- 文件头（`--- `/`+++ `）只在**首个 hunk 之前**跳过；进入 hunk 后，以 `-`/`+` 开头的行一律按删除/新增处理；
- 行号从 hunk 头解析，行为与现在一致（`add` 用 newNo、`del` 用 oldNo、`ctx` 双号）；
- `DiffSidebar` 的导入路径与公开函数名不变，渲染与几何零改动（`AGENTS.md` §4.1）。

## 验收标准

1. `npm run build`（`tsc --noEmit && vite build`）零错误。
2. 纯函数可离线验证：`src/core/diff.ts` 不 import 任何模块，用
   `node --experimental-strip-types` 直接 import 后断言；修复前应有两个用例失败、修复后全通过，命令与输出贴进当日记录。
3. 不改 `styles/globals.css`、`typography.css`、`ui/icons/`，不改组件几何与任何硬编码颜色/字号。

## 改动范围（点级）

| 文件 | 改动 |
| --- | --- |
| `src/core/diff.ts`（新增） | `DiffRow` 类型 + `diffStats` + `parseUnifiedDiff` 迁入；纯函数、零 import；修两处缺陷 |
| `src/core/workspace.ts` | 删除本地定义，改为 `export type { DiffRow }` + `export { diffStats, parseUnifiedDiff } from "./diff"`；`fetchWorkspaceDiff` 等保持不动 |
| `src/ui/DiffSidebar.tsx` | 不改（仍从 `../core/workspace` 导入，公开 API 不变） |

## 非目标

- 不改 diff 面板的渲染结构、折叠逻辑与几何；
- 不引入测试框架或新的 devDependency（`Docs/frontends/README.md`：前端不写测试）；
- 不改 `/api/workspace/diff` 的契约与 `FileChange` 类型；
- 不处理二进制 diff、rename 之外的 git 扩展头（`rename from/to` 已在跳过名单内，但不扩展）。

## 验证计划

1. 原样迁出两个函数 → 跑离线断言，确认用例失败（证明缺陷真实存在）；
2. 在 `diff.ts` 内修两处判定 → 同一套断言全通过；
3. `npm run build` 绿 → 交另一个 AI 只读审查 → 提交并推送自己的 `doubao/*` 分支。

## 回滚

`git revert <sha>`。纯前端纯函数改动，无数据与配置副作用。
