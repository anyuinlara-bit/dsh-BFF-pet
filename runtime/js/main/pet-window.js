/**
 * PetWindow — 主进程：透明桌宠窗口 + 拖拽
 * class PetWindow：
 *   - 创建透明置顶的桌宠窗口（双缓冲动画 + 气泡）
 *   - 通过 IPC 处理拖拽（主进程用 screen 计算位置）
 * 依赖：electron BrowserWindow/screen/ipcMain
 */
class PetWindow {
  /**
   * @param {object} opts
   * @param {string} opts.indexHtml  index.html 绝对路径
   * @param {string} opts.preload    preload.js 绝对路径
   * @param {{screen:object, ipcMain:object, BrowserWindow:object}} opts.electron
   * @param {number} [opts.width]   默认 462
   * @param {number} [opts.height]  默认 260
   */
  constructor({ indexHtml, preload, electron, width = 462, height = 260 }) {
    this.electron = electron
    this.indexHtml = indexHtml
    this.preload = preload
    this.baseWidth = width
    this.baseHeight = height
    this.width = width
    this.height = height
    this.scale = 1
    this.opacity = 1
    this.win = null
    this.dragOffset = { x: 0, y: 0 }
    this._registerDragIpc()
  }

  /** 创建并显示窗口 */
  create() {
    const { BrowserWindow, screen } = this.electron
    this.win = new BrowserWindow({
      width: this.width,
      height: this.height,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      show: true,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })
    this.win.loadFile(this.indexHtml)

    // 初始位置：右下角
    try {
      const wa = screen.getPrimaryDisplay().workArea
      const { width: ww, height: wh } = this.win.getBounds()
      this.win.setPosition(wa.x + wa.width - ww - 24, wa.y + wa.height - wh)
    } catch {}

    this.win.setMovable(false) // JS 拖拽控制
    return this.win
  }

  /** 窗口加载完成回调（供外部分发状态等） */
  onReady(callback) {
    if (!this.win) return
    this.win.webContents.once('did-finish-load', callback)
  }

  /** 已加载 with callback */
  send(channel, ...args) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, ...args)
  }

  isAlive() {
    return !!(this.win && !this.win.isDestroyed())
  }

  /** 当前是否可见 */
  isVisible() {
    return !!(this.win && !this.win.isDestroyed() && this.win.isVisible())
  }

  /** 切换显示/隐藏 */
  toggleVisible() {
    if (!this.isAlive()) return
    if (this.win.isVisible()) this.win.hide()
    else { this.win.show(); this.win.focus() }
  }

  /** 设置缩放：窗口 setBounds + 渲染层 stage transform scale 同步，避免裁剪 */
  setScale(ratio) {
    this.scale = ratio
    if (this.isAlive()) {
      const nw = Math.round(this.baseWidth * ratio)
      const nh = Math.round(this.baseHeight * ratio)
      const cur = this.win.getBounds()
      // 用 setBounds 保留当前位置、只改尺寸（不依赖 resizable）
      this.win.setBounds({ x: cur.x, y: cur.y, width: nw, height: nh })
      // 通知渲染层对 stage 应用 transform: scale（stage 布局尺寸保持 base）
      this.win.webContents.send('pet-action', { action: 'set-scale', value: ratio })
    }
  }

  /** 设置透明度 */
  setOpacity(opacity) {
    this.opacity = opacity
    if (!this.isAlive()) return
    this.win.setOpacity(opacity)
  }

  /** 复位到右下角 */
  resetPosition() {
    const { screen } = this.electron
    if (!this.isAlive()) return
    try {
      const wa = screen.getPrimaryDisplay().workArea
      const { width: ww, height: wh } = this.win.getBounds()
      this.win.setPosition(wa.x + wa.width - ww - 24, wa.y + wa.height - wh)
    } catch {}
  }

  /** 退出（销毁窗口） */
  close() {
    if (this.isAlive()) this.win.close()
  }

  // ── 拖拽 IPC ──
  _registerDragIpc() {
    const { ipcMain, screen } = this.electron

    ipcMain.on('drag-start', () => {
      if (!this.isAlive()) return
      const cursor = screen.getCursorScreenPoint()
      const [wx, wy] = this.win.getPosition()
      this.dragOffset = { x: cursor.x - wx, y: cursor.y - wy }
    })

    ipcMain.on('drag-move', () => {
      if (!this.isAlive()) return
      const cursor = screen.getCursorScreenPoint()
      const wa = screen.getPrimaryDisplay().workArea
      const { width: ww, height: wh } = this.win.getBounds()
      const cx = Math.min(Math.max(cursor.x - this.dragOffset.x, wa.x), wa.x + wa.width - ww)
      const cy = Math.min(Math.max(cursor.y - this.dragOffset.y, wa.y), wa.y + wa.height - wh)
      this.win.setPosition(cx, cy)
    })
  }
}

module.exports = { PetWindow }
