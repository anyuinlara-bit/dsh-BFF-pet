/**
 * PetMenu — 主进程：构建桌宠右键/托盘菜单
 * class PetMenu：
 *   - 单一菜单模板（托盘 + 窗口右键共用）
 *   - 菜单项通过注入回调执行真实操作（解耦，不直接依赖窗口/桥）
 * 依赖：electron Menu
 */
class PetMenu {
  /**
   * @param {object} actions 菜单动作 → 真实实现
   * @param {() => void}         [actions.triggerEgg]    触发彩蛋
   * @param {() => void}         [actions.bubbleShow]    显示气泡
   * @param {() => void}         [actions.bubbleHide]    隐藏气泡
   * @param {() => void}         [actions.toggleVisible] 切换显示/隐藏
   * @param {(ratio:number)=>void} [actions.setOpacity]  设置透明度
   * @param {(ratio:number)=>void} [actions.setScale]    设置大小
   * @param {() => void}         [actions.resetPosition] 复位位置
   * @param {() => void}         [actions.quit]          退出
   * @param {() => number}       [getOpacity]  当前透明度 0-1（radio 勾选）
   * @param {() => number}       [getScale]    当前大小比例（radio 勾选）
   * @param {object} opts.electron { Menu }
   */
  constructor({ actions = {}, getOpacity = () => 1, getScale = () => 1, electron }) {
    this.actions = actions
    this.getOpacity = getOpacity
    this.getScale = getScale
    this.Menu = electron.Menu
  }

  /** 构建当前菜单（每次调用重读 radio 勾选状态） */
  build() {
    const a = this.actions
    const { Menu } = this
    return Menu.buildFromTemplate([
      { label: '触发彩蛋', click: () => a.triggerEgg?.() },
      { type: 'separator' },
      {
        label: '显示/隐藏宠物',
        click: () => a.toggleVisible?.(),
      },
      {
        label: '气泡',
        submenu: [
          { label: '显示气泡', click: () => a.bubbleShow?.() },
          { label: '隐藏气泡', click: () => a.bubbleHide?.() },
        ],
      },
      {
        label: '透明度',
        submenu: [100, 75, 50, 25].map((pct) => ({
          label: pct + '%',
          type: 'radio',
          checked: Math.round((this.getOpacity() || 0) * 100) === pct,
          click: () => a.setOpacity?.(pct / 100),
        })),
      },
      {
        label: '大小',
        submenu: [150, 125, 100, 75, 50].map((pct) => ({
          label: pct + '%',
          type: 'radio',
          checked: Math.round((this.getScale() || 0) * 100) === pct,
          click: () => a.setScale?.(pct / 100),
        })),
      },
      { type: 'separator' },
      { label: '复位位置', click: () => a.resetPosition?.() },
      { type: 'separator' },
      { label: '退出宠物', click: () => a.quit?.() },
    ])
  }
}

module.exports = { PetMenu }
