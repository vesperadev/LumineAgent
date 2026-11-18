# 交接说明：Tauri 2 桌面壳（阶段 2）

> 写给接手的 AI。开工前先读 `AGENTS.md`、`Docs/roadmap.md`（阶段 2）、`Docs/frontends/README.md`。
> 本文档描述当前进度、待办与已知的坑。**截至 2026-11-18，桌面壳工作已全部完成并提交合并到 `main`。**

## 1. 任务与进度

目标（用户原话）：完成桌面端 Tauri，**1:1 复刻 Percho 桌面体验**（几何不变，壳只加窗口行为）。

当前状态：**已完成**。桌面壳 + 统一日志 + 后端健康态修复均已提交，经另一 AI 只读审查（P0/P1 清零、P2 全处理后）按用户授权推送并合并到 `main`。剩余工作见本文 §4。

相关提交（分支 `doubao/frontend-percho`，已合并进 `main`）：
- `f18c0f7` `feat(desktop): add Tauri shell with unified logging and backend health fix`
- `1446524` `docs(frontends): document desktop logging module and log levels`

## 2. 已交付内容

前端工作树 `D:\WorkSpace\LumineAgent`，全部位于 `Project/frontends/lumine-ui/`：

| 文件 | 内容 |
| --- | --- |
| `src-tauri/` | Tauri 2 壳：`Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`、`src/{main,lib,backend,chat,logging,window_bounds,window_state}.rs`、`icons/`、`gen/schemas/`。`.gitignore` 排除 `target/`、`gen/schemas` |
| `src/ui/WindowControls.tsx`（新建） | 自绘最小化/最大化/关闭，仅 Tauri 环境渲染；三个图形不在 Percho ui/icons 基线内，就地内联（已在文件头注释说明） |
| `src/ui/SessionTabBar.tsx` | 顶栏 `data-tauri-drag-region="deep"`（Tauri 2.12 bare 属性对子元素无效，已修正）+ 挂载 `<WindowControls />` |
| `src/core/logger.ts`（新建） | 前端统一日志出口，经 `log_write` 转发到壳日志文件，Web 环境降级 console |
| `src/core/engine.ts` | 双通道：`useIpc()` 判定；`remoteIpc()`（ipc::Channel 生成器）+ `messagesFor()`（请求体构造复用）；abort 唤醒卡住的迭代器；关键节点埋日志 |
| `index.html` + `public/favicon.*` | 修复 `/favicon.ico` 404 |

**核心 bug 修复（已完成）**：`backend.rs` 原用 `watch::Sender::send` 写健康态，零接收者时静默失败且不更新值 → 健康态永远停在 `Waiting` → `chat_stream` 的 `rx.changed().await` 永久挂起 → 前端表现为"发消息无任何响应、无流式、Esc 无效"。已改用 `send_replace`，抽出 `write_health()` 并加 2 个回归测试（测应用代码而非裸库）。

**统一日志（已完成）**：壳侧 `logging.rs`（滚动文件 + 环形缓冲，零新依赖）落盘 `%LOCALAPPDATA%\LumineAgent\logs\lumine.log`；前端经 `log_write` 汇入同一时间线。`LUMINE_LOG` 控制级别（支持 `debug`、`trace,info`、`lumine_agent=trace,info`）。

## 3. 关键设计（勿推翻）

- **1:1 窗口契约**来自 Percho `packages/desktop/src/main/window-bounds.ts`：默认 1100×750、最小 640×480、存普通态尺寸（非最大化尺寸）、400ms 防抖落盘、最大重叠 workArea 校验（最小可见 160×80）、大屏换小屏夹紧+平移。落在 `window_bounds.rs` 纯函数 + 单测。
- **双通道同一事件形状**：桌面走 `invoke("chat_stream")` + `ipc::Channel`（壳内 reqwest 代理后端 SSE 逐帧转发）；web/dev 仍走 HTTP fetch。两条通道错误语义已对齐（非 2xx 文案 `HTTP {status}`）。
- **后端由壳拉起**：解析顺序 `LUMINE_BACKEND_BIN` env → exe 旁 `lumine-backend(.exe)`（未来 sidecar）→ 仓库内 `Project/Lumine-rust/target/{release,debug}/serve(.exe)`（编译期路径反推，dev 兜底）。随机空闲端口，`/health` 探测上限 30s，退出时 kill+wait 回收。
- 单实例：`tauri-plugin-single-instance`，重复启动聚焦已有窗口。
- 生产无 `VITE_LUMINE_ENDPOINT` 时桌面自动走 IPC；dev 想连手动后端就设该 env（此时走 HTTP）。

## 4. 剩余待办（按优先级）

阶段 2 桌面壳 / 分发：
1. **本地能力**：dialog/opener 插件、拖拽入窗、打开外部编辑器——前端尚无消费方，roadmap 允许延后。
2. **NSIS 打包 + 代码签名**：`tauri build --no-bundle` 已通过（产出 `src-tauri/target/release/lumine-agent.exe`），bundle 未验证。
3. **自动更新**：未做。
4. **顶栏拖拽真机验证**：代码层已用 CDP 命中链确认 `deep` 属性使顶栏判定为拖拽区；但自动化合成鼠标无法驱动 WebView2 原生窗口拖动，需手工拖一次确认手感。
5. **后端 key 分发**：`.env`（含 `DEEPSEEK_API_KEY`）目前只在工作树 `Project/Lumine-rust/`，`tauri dev` 需显式设 `LUMINE_BACKEND_BIN` + `LUMINE_BACKEND_CWD`；打包版的分发方式待定。

阶段 1「能干活」补齐（见 `Docs/roadmap.md`）：diff 侧栏 → 工具调用/审批流 → `/api/sessions` 多会话 → 消息 >200 条窗口化 → 后端 done 的 usage 接 `stream_options.include_usage`。

阶段 3 验收：抓一次真实上游错误帧（额度/限流）确认前端 `error` 事件可见。已验证的是"杀后端"错误路径。

分支状态：`doubao/backend-http` 已同步 `main`（`git merge main`），但其工作树有 3 个未提交改动（`Docs/backend/README.md`、`src/llm/stream.rs`、`src/server.rs`），不要 stash/checkout 动它们。

## 5. 环境与坑

- **Write/Edit 工具对 `D:\WorkSpace` 可用**（早期交接文档说受限，本次实测已解除）；改完注意 CRLF。
- 后端 dev 实测二进制：`D:\WorkSpace\LumineAgent-backend\Project\Lumine-rust\target\release\serve.exe`。启动方式：
  ```bash
  cd Project/frontends/lumine-ui
  export LUMINE_BACKEND_BIN='D:\WorkSpace\LumineAgent-backend\Project\Lumine-rust\target\release\serve.exe'
  export LUMINE_BACKEND_CWD='D:\WorkSpace\LumineAgent\Project\Lumine-rust'
  npm run tauri dev
  ```
- 调试用 WebView2 远程端口：`export WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'`，CDP 脚本在 `C:\Users\37963\WorkBuddy\2026-11-18-18-27-25\tools\`（`cdp.js` / `repro_esc2.js` / `err_path.js` / `win_controls.js` / `verify_drag2.js`）。
- 8787 被旧后端实例长期占用，别动它；壳自己用随机端口。5317 是 vite dev server 端口。
- `tauri dev` 监听 src-tauri 变更自动重编译重启。
- dotenvy 从子进程 cwd 向上找 `.env`，实测能找到 `Project/Lumine-rust/.env`（含 `DEEPSEEK_API_KEY`，**勿提交其内容**）。
- Percho 上游参考：github.com/Jaxton07/percho（MIT），主进程文件 `packages/desktop/src/main/window.ts` 与 `window-bounds.ts`。

## 6. 已完成的审查与门槛

- 门槛：`cargo test` 13 passed / `cargo clippy -- -D warnings` 绿 / `npm run build` 绿 / `npm run tauri build -- --no-bundle` 绿。
- 端到端（CDP 脚本实测）：流式逐字正常；Esc 0.4–0.8s 中断、窗口存活、内容保留；杀后端子进程后错误气泡出现且应用存活；窗口最大化/还原/拖拽区齐备。
- 审查：另一 AI（`general-purpose` / 免费档）只读核对，初判 P0=0 / P1=1 / P2=5，P1（顶栏拖拽 `deep`）与 5 项 P2 全部修复并重跑门槛。
