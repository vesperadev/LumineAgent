# LumineAgent 路线图

本文只记录"先后顺序与取舍"，不记录实现细节；前端细节见 `Docs/frontends/README.md`，
后端契约见后端分支（`doubao/backend-*`）里的 `Docs/backend/README.md`——它随后端代码一起提交，不在本分支。

## 阶段 0：现状（Web 形态，可用但不成品）

- 前端 `Project/frontends/lumine-ui`：React 19 + TS + Vite，界面基线 Percho，含主题/壁纸/字号设置。
- 后端 `Project/Lumine-rust`：axum，`POST /api/chat/stream` 走 SSE，独立进程监听 `127.0.0.1:8080`。
- 两者是两个进程、靠 HTTP 连；**没有桌面壳**，用户要自己开浏览器和起服务。

## 阶段 1：先把"能干活"补齐（不做壳）

按对"本地编码代理"的贡献排序：

1. diff 侧栏（顶栏按钮现为 disabled，需要后端提供改动快照）。
2. 工具调用与审批流（权限胶囊目前只是 UI，后端无对应能力）。
3. `/api/sessions` + 多会话（侧栏当前是单会话投影）。
4. 消息 >200 条的窗口化渲染。
5. 后端 `done` 的 usage 接 `stream_options.include_usage`。

## 阶段 2：桌面壳（Tauri 2）

选型：**Tauri 2，不选 Electron**。理由：主进程是 Rust，与 `Lumine-rust` 同语言；安装包 10MB 级；无内置 Chromium。
Percho 原版是 Electron 三包结构，复刻它的界面不要求复刻它的运行时。

需要做的：

- 壳负责窗口与生命周期：无边框窗口 + 自绘 48px 顶栏、尺寸/位置记忆、单实例。
- 壳负责拉起后端：不再要求用户手工 `cargo run`；退出时回收子进程。
- 本地能力：文件/目录选择、拖拽入窗、打开外部编辑器——这些浏览器里做不了，只有壳能给。
- 流式推送改通道：SSE 换成 Tauri 2 的 `ipc::Channel`（或事件），前端 `core/engine.ts` 的 `remote()` 换一层适配。
  HTTP 层**保留**，Web/dev 模式仍然走 `/api/chat/stream`，两条通道共用同一套事件形状。
- 分发：图标、安装包、自动更新、代码签名（Windows 先做，签名可后置）。

约束：

- 界面几何与 token 体系不变：壳只加"窗口"，不改 `globals.css` / `typography.css` / `icons`（`AGENTS.md` §4.1）。
- 不做两套前端：桌面与 Web 用同一份 `lumine-ui`，差异只在"传输层"与"本地能力"两个适配点。
- 代码改动仍须经另一个 AI 只读审查（`AGENTS.md` §8）。

## 阶段 3：真流与验收

- 配 `DEEPSEEK_API_KEY` 跑一次真实 SSE：delta 逐块渲染、`done`、上游 `error` 帧、断流四种路径都要看到。
- 抓一次真实上游错误（额度/限流）确认 `error` 事件在前端有可见表现。

## 明确不做

- 不复刻 Percho 的 Electron 三层包结构（`packages/{desktop,shared,backend}`），只复刻界面。
- 不在阶段 1 之前上壳：壳解决"怎么启动"，不解决"有没有 diff 面板与多会话"。
- 不引入第二套前端或第二套样式基线。
