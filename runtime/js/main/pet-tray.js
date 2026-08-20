/**
 * PetTray — 主进程：系统托盘
 * class PetTray：
 *   - 创建系统托盘图标（Windows 通知区域）
 *   - 点击托盘图标 → 切换桌宠显示/隐藏
 *   - 右键托盘 → 弹出构建的菜单（通过 menuBuilder 回调）
 * 依赖：electron Tray/nativeImage
 */
class PetTray {
  /**
   * @param {object} opts
   * @param {string} opts.iconPath 托盘图标路径（.ico）
   * @param {() => boolean} opts.isVisible  窗口当前是否可见
   * @param {() => void} opts.toggleVisible 切换显示/隐藏回调
   * @param {() => object} opts.menuBuilder 构建菜单（返回 Menu），右键弹出
   * @param {object} opts.electron { Tray, nativeImage }
   */
  constructor({ iconPath, isVisible = () => false, toggleVisible = () => {}, menuBuilder = null, electron }) {
    this.iconPath = iconPath
    this.isVisible = isVisible
    this.toggleVisible = toggleVisible
    this.menuBuilder = menuBuilder
    this.electron = electron
    this.tray = null
    this.tooltip = 'DSH BFF 桌宠'
  }

  /** 创建托盘 */
  setup() {
    const { Tray, nativeImage } = this.electron
    let icon
    try { icon = nativeImage.createFromPath(this.iconPath) } catch {}
    this.tray = new Tray(icon || nativeImage.createEmpty())
    this.tray.setToolTip(this.tooltip)

    // 点击托盘 → 显示/隐藏桌宠
    this.tray.on('click', () => {
      try { this.toggleVisible() } catch (e) {}
    })

    // 右键托盘 → 弹出菜单
    if (this.menuBuilder) {
      this.tray.on('right-click', () => {
        try {
          const menu = this.menuBuilder()
          if (menu) menu.popup({ tray: this.tray })
        } catch (e) {}
      })
    }
  }

  /** 设置 tooltip */
  setTooltip(text) {
    this.tooltip = text
    if (this.tray) this.tray.setToolTip(text)
  }

  destroy() {
    if (this.tray) { try { this.tray.destroy() } catch {} this.tray = null }
  }
}

module.exports = { PetTray }
