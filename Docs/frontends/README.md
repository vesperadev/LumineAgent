# Lumine 前端（Project/frontends/lumine-ui）

LumineAgent 的桌面客户端界面。定位是「本地 AI 编码代理的控制台」：对话为主，过程与改动为辅，
所有对话最终落到后端的 `/api/chat/stream`。

## 1. 技术栈与命令

| 项 | 取值 |
| --- | --- |
| 框架 | React 19 + TypeScript（`strict` / `noUnusedLocals` / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`） |
| 构建 | Vite 8（`build.target = es2022`） |
| 样式 | Tailwind 4（`@tailwindcss/vite`），token 走 CSS 变量 |
| 端口 | dev `5317` |
| 包管理 | npm，源 `registry.npmmirror.com` |

```bash
cd Project/frontends/lumine-ui
npm install
npm run dev      # http://localhost:5317
npm run build    # tsc --noEmit && vite build —— 提交前必须绿
```

## 2. 目录结构与职责

| 路径 | 职责 | 不该做什么 |
| --- | --- | --- |
| `src/App.tsx` | 壳层：顶栏 / 侧栏 / 消息区 / 输入卡的组合与状态接线 | 不写业务逻辑，不直接解析 SSE |
| `src/ui/` | 纯展示组件（`SessionTabBar` `SideBar` `EmptyState` `Thread` `MessageBlock` `Composer` `SettingsPanel`） | 不发起请求、不持有领域状态 |
| `src/core/` | 领域层：`types.ts` 协议类型、`engine.ts` 外部 store、`hooks.ts` 订阅与行为、`Markdown.tsx` 正文渲染 | 不出现颜色、字号、间距 |
| `src/theme/` | UI 设置（主题 / 壁纸 / 字号 / 左栏开合），落 `localStorage` | 不写组件 |
| `src/styles/` | `globals.css`（Percho 原样）、`typography.css`（字号事实源）、`themes.css`（palette 与壁纸）、`overrides.css`（本项目轻量 Markdown 外观） | 不放业务组件样式 |
| `src/ui/icons/` | Percho 图标全集（逐字引入） | 不新增手绘 SVG，缺图标先在集合里找 |

## 3. 设计基线

界面基线来自 [Percho](https://github.com/Jaxton07/percho)（MIT）。做法是**引入它真实的 token 与图标**，不做近似复刻：

- `styles/globals.css`、`styles/typography.css`、`ui/icons/index.tsx` 与上游逐字一致，禁止手改。
- 组件几何照上游写：48px 顶栏、240px 侧栏（行高 31px / 圆角 7px）、760px 消息列（gap 24、pt 32 / pb 64）、
  输入卡 `rounded-[20px] border-[0.5px] shadow-soft`、用户气泡 `rounded-2xl rounded-br-md`、助手无头像直铺。
- **只改 token，不改几何**：换皮一律走 `styles/themes.css` 覆盖 `--color-*`，不允许在组件里换圆角/间距冒充换主题。
- 上游组件是 MIT，可整段移植；移植时在文件头注明来源路径，便于对账。

## 4. 主题与壁纸

状态落在根节点属性上，CSS 只认属性，不认 React 状态：

```
document.documentElement.dataset.theme      = "light" | "dark"
document.documentElement.dataset.palette    = "percho" | "sand" | "slate" | "forest" | "rose"
document.documentElement.dataset.wallpaper  = "none" | "linen" | "grid" | "aurora"
document.documentElement.dataset.fontScale  = "90" | "100" | "110"
--wallpaper-opacity                         壁纸强度（0.15–1）
```

- 唯一入口是 `theme/store.tsx` 的 `useUiSettings()`；组件里禁止直接写 `document.documentElement`。
- 新增一套主题 = 在 `styles/themes.css` 加 `[data-palette="x"]` 与 `[data-palette="x"][data-theme="dark"]`
  两块，再在 `theme/store.tsx` 的 `PALETTES` 里登记名称、提示与三色色卡。**不需要动任何组件。**
- 每套主题必须同时提供亮/暗两份 token，否则暗色下会出现对比度塌陷；正文对比度不低于 4.5:1，次要文字不低于 3:1。
- 壁纸规则：`wallpaper-layer` 只做画布底，正文区、输入卡、侧栏保持不透明面；**禁止**全屏 `backdrop-filter`、
  禁止动画壁纸（静态渐变/纹理即可，帧率优先）。
- 派生 token 与工具类：`--color-accent-soft` 在 `themes.css` 由 `--color-accent` + `--color-surface` 用 `color-mix` 派生一次
  （不逐 palette 维护）；对应的 `bg-accent-soft` 是在 `styles/overrides.css` 里手写的等价声明，
  不要依赖 `@theme` 在非入口 CSS 里被收集。`styles/overrides.css` 里的规则只引用语义 token，不重定义 token。
- 首帧主题脚本：`index.html` 的内联脚本是 `store.tsx` 的 `DEFAULTS`/`apply()` 镜像，默认值、白名单、
  钳制范围必须两处同步；新增 `data-*` 属性时两边都要改。

## 5. 代码规范

- 颜色与字号一律用语义类：`bg-canvas` `bg-surface` `text-ink` `text-ink-dim` `border-border` `shadow-soft`、
  `text-ui-13/14/15`。**禁止** `#fff`、`text-white`、`text-[13px]` 这类硬编码。
- 组件 props 就地声明并导出类型；跨文件复用的类型放 `core/types.ts`。
- 状态只放在 `core/engine.ts`（会话领域状态）与 `theme/store.tsx`（UI 设置）两处；组件内部只保留
  「展开/收起」「当前菜单」这类纯属该组件的瞬时状态。
- 不新增 UI 组件库（Radix / shadcn / MUI 一律不加）；弹层用现有 `ui/Menu.tsx` 的轻量实现。
- 新增交互必须同时给键盘路径（Esc 关闭、Enter 确认），鼠标不是唯一入口。
- 注释解释「为什么」，不复述代码；中文注释，专有名词保留英文。

## 6. 性能约束

- 流式渲染必须走 `engine.ts` 的 rAF 批量合并，禁止逐 token `setState`。
- 消息列宽度上限 760px，Markdown 解析保持纯函数（`Markdown` 已 `memo`）。
- 壁纸只用静态图层，不参与任何 animation。
- 已知待办：消息数超过约 200 条后需要窗口化渲染（当前全量挂载）。

## 7. 接口契约（前端不实现，只消费）

```
POST /api/chat/stream
Content-Type: application/json
{ "model": "deepseek-chat", "messages": [{ "role": "user", "content": "…" }] }

响应：text/event-stream
data:{"type":"delta","text":"…"}
data:{"type":"done","usage":{"prompt":0,"completion":0}}
data:{"type":"error","message":"…"}
```

- 默认**不配置** `VITE_LUMINE_ENDPOINT`：界面走本地剧本（`chat.mock`），不依赖后端即可看效果。
- 要接真实后端就显式设置，例如 `VITE_LUMINE_ENDPOINT=http://localhost:8080`（与后端默认地址一致）。
- mock 判定唯一出处是 `src/core/engine.ts` 的 `isMock()`，对齐时不要另写判断。
- 后端必须放行 dev 源 `http://localhost:5317` 的 CORS。

## 8. 分支与提交

- 前端改动只在 `doubao/frontend-*` 分支（当前 `doubao/frontend-percho`）。
- **不直接向 `main` 提交、不合并、不 force push**；合入由人类维护者做。
- 提交信息用英文，`feat:` / `fix:` / `docs:` / `refactor:` 前缀；共享文件（`.gitignore`、根 `README.md`、`AGENTS.md`）
  单独一个提交并说明原因。
- 提交前必须 `npm run build` 全绿，并按 `AGENTS.md` §8 另经一个 AI 只读审查（P0/P1 清零）。

## 9. 已知未完成

- 顶栏「变更侧栏」只有按钮（已 disabled），diff 面板未接；
- `Project/frontends/_attic/` 内是迁移前的旧组件；早期风格试验的 `src/app.css` 与 `src/styles/01-terminal/` 已删除；
- Percho 未移植组件：`ApprovalDock`、`MessageRail`、`TodoPanel`、`DiffSidebar`、`SessionRail`、`ContextRing`；
- 多会话：侧栏仍是单会话投影，需要后端 `/api/sessions`；
- 消息窗口化渲染；
- 桌面壳：当前只有 Web 形态，Tauri 方案见 `Docs/roadmap.md`。
