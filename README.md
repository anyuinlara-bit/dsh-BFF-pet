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

## 🏗️ 架构

```
DSH (WSL)                        Windows Electron
─────────────────────            ─────────────────────
src/index.js  注册状态/退出端点     runtime/main.js   组装主进程
src/reducer.js 状态机推导   ───▶   js/main/*.js      PetWindow/PetTray/PetMenu
src/helper-process.js spawn同步    js/main/pet-state-poller.js   轮询状态
src/errors.js  错误收集            js/pet-*.js       渲染层动画/互动/彩蛋
```

- **状态通道**：DSH 插件在自身 webServer 注册 `GET /plugins/dsh-BFF-pet/state`；Electron（Windows 进程）通过 WSL2 localhost 转发，每 1s 轮询一次，去重后转发给渲染层。
- **退出控制**：`POST /plugins/dsh-BFF-pet/quit` 让 DSH helper 彻底停止（不再自动重启）。

---

## 🧩 模块结构（全部 class 化）

**主进程（Electron main）**
| 模块 | 职责 |
|---|---|
| `js/main/pet-window.js` | 透明窗口、拖拽、缩放(setBounds)、透明度、复位 |
| `js/main/pet-state-poller.js` | 轮询 DSH 状态端点、断连检测、恢复 |
| `js/main/pet-tray.js` | 系统托盘（点击切换、右键菜单） |
| `js/main/pet-menu.js` | 右键菜单构建 |

**渲染层（页面）**
| 模块 | 职责 |
|---|---|
| `js/pet-state.js` | 动画配置映射 |
| `js/pet-engine.js` | 双缓冲动画引擎 |
| `js/pet-scheduler.js` | 彩蛋调度 |
| `js/pet-interact.js` | 拖拽 + 点击互动 |
| `js/pet-init.js` | 主程序组装 |

**插件（DSH 侧）**
| 模块 | 职责 |
|---|---|
| `src/index.js` | 注册状态/退出端点 |
| `src/reducer.js` | Agent 事件 → 状态机 |
| `src/helper-process.js` | WSL→Windows spawn、runtime 同步、退出管理 |
| `src/errors.js` | 错误收集（暴露到状态端点） |

---

## 🖥️ 环境

- **WSL**：DSH 运行在 WSL2（Linux）
- **Windows**：透明 Electron 窗口 + WebM 动画
- Electron 二进制与 runtime 由 helper 自动从 WSL 同步到 `C:\Users\<user>\AppData\Local\dsh-BFF-pet\`

---

## ✅ 测试与 CI

- **契约测试**：`npm test`（Node 内置 `node --test`），覆盖 reducer 状态机的所有状态流转
- **冒烟测试**：`npm run smoke`（syntax 检查所有 src/runtime JS + 契约测试）
- **CI**：GitHub Actions 每次 push/PR 到 `main` 自动跑冒烟测试（`.github/workflows/ci.yml`）

```sh
npm test        # 跑 reducer 契约测试
npm run smoke   # 冒烟测试（语法 + 契约）
```

---

## 🙏 致谢 / Credits

本项目参考并借鉴了以下优秀的 DSH 桌宠插件，在此致谢：

- **[dsh-pet](https://github.com/PC2005-cloud/dsh-pet)** — by [PC2005-cloud](https://github.com/PC2005-cloud)，MIT License。参考其桌宠形态与动画组织思路。
- **[dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)** — by [QCYTSN](https://github.com/QCYTSN)，MIT License。参考其 WSL→Windows helper 桥接、状态机（reducer）与 webServer 端点设计。

> 注意：本项目为独立实现，与上述项目无代码归属关系；动画资源、架构与实现均有所不同。若涉及复用，请遵守各项目对应的 MIT License 许可条款（保留版权声明）。

---

## 📄 License

MIT
