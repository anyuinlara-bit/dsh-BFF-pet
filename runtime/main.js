/**
 * main.js — Electron 主进程入口（纯组装）
 * 组合各主进程 class：
 *   - PetWindow   窗口 + 拖拽
 *   - PetStatePoller  轮询 DSH 状态端点 → 转发渲染层
 *   - PetTray     系统托盘
 *   - PetMenu     托盘/窗口右键菜单
 * 渲染层逻辑（preload.js / js/pet-*.js）保持独立
 */
const path = require('path')
const { app, BrowserWindow, screen, ipcMain, Tray, nativeImage, Menu } = require('electron')
const { PetWindow } = require(path.join(__dirname, 'js', 'main', 'pet-window.js'))
const { PetStatePoller } = require(path.join(__dirname, 'js', 'main', 'pet-state-poller.js'))
const { PetTray } = require(path.join(__dirname, 'js', 'main', 'pet-tray.js'))
const { PetMenu } = require(path.join(__dirname, 'js', 'main', 'pet-menu.js'))

app.whenReady().then(() => {
  // 窗口
  const petWindow = new PetWindow({
    indexHtml: path.join(__dirname, 'index.html'),
    preload: path.join(__dirname, 'preload.js'),
    electron: { BrowserWindow, screen, ipcMain },
  })
  const win = petWindow.create()

  // 发送动作给渲染层（菜单项：触发彩蛋 / 气泡开关）
  const sendAction = (action) => petWindow.send('pet-action', { action })

  // 菜单（托盘右键共用）
  const petMenu = new PetMenu({
    actions: {
      triggerEgg: () => sendAction('trigger-egg'),
      bubbleShow: () => sendAction('bubble-show'),
      bubbleHide: () => sendAction('bubble-hide'),
      toggleVisible: () => petWindow.toggleVisible(),
      setOpacity: (ratio) => petWindow.setOpacity(ratio),
      setScale: (ratio) => petWindow.setScale(ratio),
      resetPosition: () => petWindow.resetPosition(),
      quit: () => {
        // 先通知 DSH 彻底停止（不再自动重启），再退出
        const http = require('http')
        const url = (process.env.DSH_WEB_URL || 'http://127.0.0.1:3080') + '/plugins/dsh-BFF-pet/quit'
        const req = http.request(url, { method: 'POST' }, () => {
          try { app.quit() } catch (e) {}
        })
        req.on('error', () => { try { app.quit() } catch (e) {} })
        req.end()
        // 兜底：即使请求失败也退出
        setTimeout(() => { try { app.quit() } catch (e) {} }, 1500)
      },
    },
    getOpacity: () => petWindow.opacity,
    getScale: () => petWindow.scale,
    electron: { Menu },
  })

  // 托盘（点击切换显示/隐藏，右键弹出菜单）
  const petTray = new PetTray({
    iconPath: path.join(__dirname, 'assets', 'DeepSeek Harness.ico'),
    isVisible: () => petWindow.isVisible(),
    toggleVisible: () => petWindow.toggleVisible(),
    menuBuilder: () => petMenu.build(),
    electron: { Tray, nativeImage },
  })
  petTray.setup()

  // 状态轮询：窗口就绪后开始
  const poller = new PetStatePoller({
    isReady: () => petWindow.isAlive(),
    send: (channel, msg) => petWindow.send(channel, msg),
  })

  petWindow.onReady(() => {
    poller.start()
  })
})
