# dsh-BFF-pet 🐾

> 一只住在 Windows 桌面上的 DeepSeek Harness（DSH）桌宠插件
> A desktop pet plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) running on Windows, driven by real agent state.

透明悬浮窗 + WebM 动画，通过 DSH 的 webServer 状态端点实时反映 Agent 的工作状态。整个插件与 DSH 共生：**由 DSH 自动拉起，无独立应用入口、无需额外端口**（仅复用 DSH 自身的 `127.0.0.1:3080`）。

---

## ✨ 功能特性

- **透明悬浮桌宠**：只在桌面显示宠物本身，无背景块；置顶显示，可任意拖拽
- **Agent 状态驱动**：空闲 / 思考中 / 工作中（区分搜索/编辑/测试/命令）/ 等待确认 / 完成 / 错误 实时切换动画与气泡
- **状态气泡**：在宠物上方显示当前状态文字（如「工作中 · 搜索」）
- **彩蛋调度**：空闲随机彩蛋、早/中/晚餐时间彩蛋、长时间工作吃 Token
- **互动**：点击触发互动动画，拖拽反馈悬空动画
- **系统托盘 + 右键菜单**：触发彩蛋 / 显示隐藏 / 气泡开关 / 透明度 / 大小缩放 / 复位位置 / 退出
- **健壮性**：断连检测（DSH 失联自动显示「未连接」并在恢复后回到真实状态）、错误可视化、状态回落（任务完成无活动自动回空闲）

---

## 🎬 效果演示

动画由 **Agent 实时状态驱动**——当 DSH 的 agent 接触信息、执行任务时，桌宠会播放对应的动画。以下是几个代表性场景：

| 工作中 · 搜索 | 完成任务 | 吃 Token |
|---|---|---|
| ![工作中·搜索](docs/gifs/work_search.gif) | ![完成任务](docs/gifs/success_dance.gif) | ![吃Token](docs/gifs/eat_token.gif) |

> 动画素材来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（见下方致谢），完整 50+ 个动画随桌宠运行自动触发。

---

## 🔄 数据流（逻辑结构）

桌宠的核心是**一条从 DSH 到桌宠的单向状态流 + 一条反向的控制流**，全部通过 DSH 自身的 webServer 完成，不引入额外通道。

```
DSH 侧（插件）                          Windows Electron 侧
───────────                            ────────────────────
Agent 产生事件                          桌宠窗口（透明 + 动画）
   │                                        ▲
   ▼                                        │ ipc/webContents 转发
状态机推导（reducer）                        │
   │                                        │
   ▼                                        │
状态端点暴露（GET /state）  ──轮询(1s)──▶  轮询器 → 渲染层 → 播放动画/气泡
   │
   ▼
控制端点（POST /quit）  ◀──退出请求──── 托盘/右键菜单
```

1. **状态流（正向）**：DSH 的 Agent 产生 `session/event` → 插件内状态机（`reducer`）把事件推导成宠物状态（空闲/思考/工作/等待/完成/错误）→ 通过状态端点 `GET /state` 暴露。Windows Electron 每秒轮询该端点，去重后转发给渲染层，驱动动画与气泡切换。
2. **控制流（反向）**：托盘/右键菜单的用户动作（触发彩蛋、气泡开关、退出等）→ 渲染层处理，或通过控制端点 `POST /quit` 通知 DSH 彻底停止。

两条流都只复用 DSH 自身的 `127.0.0.1:3080`，插件与 DSH 共生，无独立入口、无额外端口。

---

## 🖥️ 环境与 Electron 运行时

桌宠是 **Windows 原生**应用（透明置顶窗口 + 系统托盘）。运行需要 **Electron 运行时**，程序启动时会**自动探测并匹配本机可用的 Electron 路径**（无需手动配置），按以下顺序定位：

1. 环境变量 `ELECTRON_PATH` 显式指定
2. 纯 Windows：`node_modules/electron/dist/electron.exe`（本项目目录 `npm install electron` 所得）
3. 兼容：`bin/win32-x64/electron.exe`

**拉取/安装 Electron 由使用者按自身环境执行**（例如 Windows 用户先 `npm install electron`），程序只负责"找到并配对路径"，不打包、不强制任何方式。

- **纯 Windows**：DSH 与桌宠同机运行，程序直接启动 Electron 窗口；runtime 就在本地目录，无需跨盘同步。
- **WSL2**：DSH 在 WSL（Linux），桌宠窗口在 Windows。helper 自动把 runtime 与 `bin/` 中的 Windows 版 Electron 同步到 `C:\Users\<user>\AppData\Local\dsh-BFF-pet\` 后启动。
  > 注意：WSL 下 `npm install electron` 拉取的是 Linux 版，**无法**驱动 Windows 桌宠；WSL 用户需放置 Windows 版 electron 于 `bin/win32-x64/`（或由 Agent 按环境处理）。

## 测试与 CI

- **契约测试**：`npm test`（Node 内置 `node --test`），覆盖 reducer 状态机 + helper 平台路径识别
- **冒烟测试**：`npm run smoke`（syntax 检查所有 src/runtime JS + 契约测试）
- **CI**：GitHub Actions 每次 push/PR 到 `main` 自动跑冒烟测试（`.github/workflows/ci.yml`）

```sh
npm test          # 跑 reducer + helper 契约测试
npm test:helper   # 只跑 helper 平台路径测试
npm run smoke     # 冒烟测试（语法 + 契约）
```

---

## 🙏 致谢 / Credits

本项目参考并借鉴了以下优秀的 DSH 桌宠插件，在此致谢：

- **[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** — by [PC2005-cloud](https://github.com/PC2005-cloud)，MIT License。**本项目的 50+ 个 WebM 动画素材即来自 dsh-pet**（经本地重命名为英文文件名后使用），感谢其精美的动画资产。
- **[dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)** — by [QCYTSN](https://github.com/QCYTSN)，MIT License。参考其 WSL→Windows helper 桥接、状态机（reducer）与 webServer 端点设计。

> 注意：本项目的**架构与代码为独立实现**；动画素材复用自 dsh-pet。两个参考项目均为 MIT License，使用需遵循各自的许可条款（保留版权声明）。

---

## 📄 License

MIT
