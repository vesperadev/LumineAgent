# ISSUE-0002 桌面端启动时后端子进程弹出控制台窗口

- 状态: open
- 类型: bug / packaging
- 优先级: P1
- 发现时间: 2026-11-19（安装包冒烟）
- 关联: 无（独立缺陷）

## 现象

安装版启动后，桌面上除 `LumineAgent` 主窗口外，还额外弹出一个黑色控制台窗口，标题是后端进程路径，内容为：

```
INFO serve: lumine serve up address=127.0.0.1:<port> model=deepseek-chat cors_origin=http://localhost:5317
```

用户视角这是开发工具形态，不像可直接分发的成品软件。

## 复现

1. 安装 `LumineAgent_0.1.0_x64-setup.exe`（或直接运行 `src-tauri/target/release/lumine-agent.exe`，后端 `lumine-backend.exe` 在同目录）。
2. 启动应用。
3. 桌面同时出现主窗口 + 后端控制台窗口。

## 根因

`Project/frontends/lumine-ui/src-tauri/src/backend.rs:143-148` 用 `std::process::Command` 拉起 `lumine-backend.exe`。Windows 下该子进程会新建/继承控制台（conhost），代码未设置 `CREATE_NO_WINDOW`。

## 期望

- 桌面只出现应用主窗口，没有任何控制台窗口。
- 后端诊断日志仍然可读：壳日志写入 `%LOCALAPPDATA%\LumineAgent\logs\lumine.log`，后端 stdout 不再需要可见窗口。
- 端口分配、健康探测、退出回收行为不变。

## 验收标准

1. 安装版启动后，进程列表中 `lumine-backend` 进程 `MainWindowTitle` 为空，桌面无黑窗（截图取证）。
2. 壳日志出现 `后端就绪` 与 `Waiting -> Ready`，耗时 < 30s（实测基线约 0.5s）。
3. 主窗口 UI 正常渲染，`/api/chat/stream` 链路可用。
4. `cargo test` 与 `cargo clippy` 通过。
5. 关闭应用后 `lumine-backend` 不残留。

## 改动范围（点级）

唯一文件：`Project/frontends/lumine-ui/src-tauri/src/backend.rs`

- 文件顶部：`#[cfg(windows)] use std::os::windows::process::CommandExt;`
- `boot()` 内 `let mut command = Command::new(&binary);` 之后、`command.spawn()` 之前：
  `#[cfg(windows)] command.creation_flags(0x0800_0000);`（`CREATE_NO_WINDOW`）
- 不改 `resolve_backend`、`backend_cwd`、`packaged_api_key`、健康探测循环、退出回收逻辑。

## 非目标

- 不修 `list_sessions` 的 `error decoding response body`（另立 ISSUE）。
- 不改 NSIS 打包配置、不改 updater 签名流程。
- 不引入 `tauri-plugin-shell` sidecar 机制。

## 验证计划

重建安装包 → 静默安装 → 启动 → 截图查无黑窗 → 读日志确认 Ready → 关闭查无残留进程。

## 回滚

`git revert <sha>`。纯代码改动，无数据/系统配置副作用。
