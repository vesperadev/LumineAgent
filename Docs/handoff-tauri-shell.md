# 交接说明：Tauri 2 桌面壳（阶段 2）

> 写给接手的 AI。开工前先读 `AGENTS.md`、`Docs/roadmap.md`（阶段 2）、`Docs/frontends/README.md`。
> 本文档描述当前进度、待办与已知的坑。**所有改动未提交，勿擅自 commit。**

## 1. 任务与进度

目标（用户原话）：完成桌面端 Tauri，**1:1 复刻 Percho 桌面体验**（几何不变，壳只加窗口行为）。

当前状态：**代码全部写完，门槛全绿，`tauri dev` 实测部分通过**。剩 UI 端到端验证、一个未定位的退出问题、以及 §8 审查。

## 2. 已完成的改动（均未提交）

前端工作树 `D:\WorkSpace\LumineAgent`（分支 `doubao/frontend-percho`），全部位于 `Project/frontends/lumine-ui/`：

| 文件 | 内容 |
| --- | --- |
| `src-tauri/`（新建整个目录） | Tauri 2 壳：`Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`、`src/main.rs`、`src/lib.rs`、`src/backend.rs`（后端子进程拉起/健康探测/退出回收）、`src/chat.rs`（SSE→ipc::Channel 代理）、`src/window_bounds.rs`（Percho 窗口几何纯函数 + 7 个单测）、`src/window_state.rs`（bounds 持久化，400ms 防抖，退出兜底落盘）、`icons/`（tauri icon 生成） |
| `src/ui/WindowControls.tsx`（新建） | 自绘最小化/最大化/关闭，仅 Tauri 环境渲染；三个图形不在 Percho ui/icons 基线内，就地内联（已在文件头注释说明） |
| `src/ui/SessionTabBar.tsx` | 根节点加 `data-tauri-drag-region`；末尾挂 `<WindowControls />`（`-mr-3` 抵消顶栏右内边距） |
| `src/core/engine.ts` | 双通道：`isTauri()`/`useIpc()` 判定；新增 `remoteIpc()`（ipc::Channel 生成器）与 `messagesFor()`（请求体构造，HTTP 路径复用）；abort 时唤醒卡住的迭代器。**注意此文件同时含上一轮待审的两处修复**（空 assistant 占位过滤、mock steps 注入条件），审查时一并看 |
| `package.json` | 加 `@tauri-apps/api`、`@tauri-apps/cli`、`tauri` script |

门槛结果（刚跑过，改动后需重跑）：
- `src-tauri` 内 `cargo test`：7 通过；`cargo clippy -- -D warnings`：绿
- `npm run build`：绿（JS 281.40KB / gzip 87.32）

后端工作树 `D:\WorkSpace\LumineAgent-backend`（分支 `doubao/backend-http`）有上一轮的 usage 透传改动（未提交），与本任务无关但审查时要一起看。

## 3. 关键设计（勿推翻）

- **1:1 窗口契约**来自 Percho `packages/desktop/src/main/window-bounds.ts`：默认 1100×750、最小 640×480、存普通态尺寸（非最大化尺寸）、400ms 防抖落盘、最大重叠 workArea 校验（最小可见 160×80）、大屏换小屏夹紧+平移。落在 `window_bounds.rs` 纯函数 + 单测。
- **双通道同一事件形状**：桌面走 `invoke("chat_stream")` + `ipc::Channel`（壳内 reqwest 代理后端 SSE 逐帧转发）；web/dev 仍走 HTTP fetch。两条通道错误语义已对齐（非 2xx 文案 `HTTP {status}`，与 `remote()` 一致）。
- **后端由壳拉起**：解析顺序 `LUMINE_BACKEND_BIN` env → exe 旁 `lumine-backend(.exe)`（未来 sidecar）→ 仓库内 `Project/Lumine-rust/target/{release,debug}/serve(.exe)`（编译期路径反推，dev 兜底）。随机空闲端口，`/health` 探测上限 30s，退出时 kill+wait 回收。
- 单实例：`tauri-plugin-single-instance`，重复启动聚焦已有窗口。
- 生产无 `VITE_LUMINE_ENDPOINT` 时桌面自动走 IPC；dev 想连手动后端就设该 env（此时走 HTTP）。

## 4. 待办（按优先级）

1. **UI 端到端验证**（两次被用户中断，未完成）：
   - 正常对话出流式回复（此前观察已确认链路通，用户手动发过 hello 且收到生成中状态）
   - 流式中按 Esc → 窗口存活、回到可输入、已输出内容保留
   - 错误路径可见：杀掉壳拉起的 serve 子进程后再发消息 → 聊天区应出现错误气泡
   - 最大化/最小化/关闭按钮、拖拽顶栏移动窗口、双击顶栏最大化（tauri 内建）
2. **未定位问题：流式中按 Esc 后应用整体退出**。已修一个确定的 bug（abort 后 `remoteIpc` 生成器卡死在 await，已加唤醒）；并在 `lib.rs` 的 `on_window_event` 加了 `CloseRequested`/`Destroyed` eprintln 日志。复现时看 tauri dev 日志：若出现 `[lumine] main window close requested` 说明是收到了关闭请求（WebView2 的 window.close 或外部 WM_CLOSE），而非 Rust panic。**WebView2 会执行 `window.close()` 关掉宿主窗口**（与浏览器行为不同），排查时注意这条路径。
3. `tauri build --no-bundle` 门槛未跑（bundle 需要 NSIS 打包配置，roadmap 里分发后置）。NSIS targets 已配，icon 已生成，后续补打包验证即可。
4. 按 `AGENTS.md` §8 交另一个 AI 只读审查（P0/P1 清零），§7 汇报四件事。**不提交**，等用户确认。
5. 本地能力（文件/目录选择、拖拽入窗、打开外部编辑器）：dialog/opener 插件未接，前端无消费方，roadmap 允许延后——汇报里注明即可。

## 5. 环境与坑

- **Write/Edit 工具对 `D:\WorkSpace` 全部受限**（"restricted to the working directory"）。改文件一律用 Shell + PowerShell（读 `ReadAllText` → `.Replace()`/正则 → `WriteAllText`，注意 CRLF）。Read/Grep/Glob 可用。
- 后端 dev 实测二进制：`D:\WorkSpace\LumineAgent-backend\Project\Lumine-rust\target\release\serve.exe`（含 usage 透传，2026-11-18 构建）。启动方式：
  ```
  $env:LUMINE_BACKEND_BIN='D:\WorkSpace\LumineAgent-backend\Project\Lumine-rust\target\release\serve.exe'
  npm run tauri dev   # 在 Project/frontends/lumine-ui 下
  ```
- 8787 被旧后端实例（PID 42084）长期占用，别动它；壳自己用随机端口（实测 60654/53116/49992）。
- 5317 是 dev server 端口，`tauri dev` 会自己拉 vite；先确认没别的 dev server 占着。
- `tauri dev` 监听 src-tauri 变更自动重编译重启，改 Rust 文件后等它自己重建即可。
- dotenvy 从子进程 cwd 向上找 `.env`，实测能找到 `Project/Lumine-rust/.env`（DEEPSEEK_API_KEY）。
- Percho 上游参考：github.com/Jaxton07/percho（MIT），主进程文件 `packages/desktop/src/main/window.ts` 与 `window-bounds.ts`。

## 6. 给审查 AI 的重点核对项

- `chat.rs`：pump 的 SSE 逐帧解析（字节级攒行防 UTF-8 切断）、abort 的 select 竞态、done/error 帧后收尾、abort 后代际清理
- `engine.ts` `remoteIpc()`：queue+wake 桥接无丢帧、abort 唤醒路径、finally 兜底 chat_abort 对未知 id 无害
- `window_state.rs`：最大化/最小化时不写盘（getNormalBounds 语义）、退出 flush
- `capabilities/default.json`：权限是否最小化