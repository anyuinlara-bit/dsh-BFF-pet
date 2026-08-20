/**
 * pet-interact.js — 互动逻辑（拖拽 + 点击）
 * 全局命名空间 window.PetInteract
 *
 * class PetInteract：
 *   - 拖拽：mousedown/move/up，阈值判定，触发 DRAG_ANIM 悬空反馈，通过 bridge 移动窗口
 *   - 点击：非拖动时点击 → 随机互动动画（一次性，播完恢复当前状态）
 */
class PetInteract {
  static PRESS_THRESHOLD = 5

  /** @param {{bridge:object, hitEl:HTMLElement, engine:PetEngine}} */
  constructor({ bridge, hitEl, engine }) {
    this.bridge = bridge
    this.hitEl = hitEl
    this.engine = engine
    this.dragging = false
    this.dragMoved = false
    this.startX = 0
    this.startY = 0

    this._bindEvents()
  }

  _bindEvents() {
    if (!this.hitEl) return

    this.hitEl.addEventListener('mousedown', (e) => {
      this.dragging = true
      this.dragMoved = false
      this.startX = e.screenX
      this.startY = e.screenY
      this.hitEl.classList.add('dragging')
      this.bridge.dragStart()
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.dragging) return
      if (Math.abs(e.screenX - this.startX) > PetInteract.PRESS_THRESHOLD
        || Math.abs(e.screenY - this.startY) > PetInteract.PRESS_THRESHOLD) {
        if (!this.dragMoved && window.PetState.DRAG_ANIM) {
          this.dragMoved = true
          // 拖拽开始 → 播悬空反馈动画（一次性，结束后恢复由 mouseup 处理）
          this.engine.playOnce(window.PetState.DRAG_ANIM, () => {})
        }
      }
      if (this.dragMoved) this.bridge.dragMove()
      e.preventDefault()
    })

    document.addEventListener('mouseup', (e) => {
      if (!this.dragging) return
      this.dragging = false
      this.hitEl.classList.remove('dragging')

      if (this.dragMoved) {
        // 拖拽结束 → 恢复当前 Agent 状态的动画序列
        this.engine.setState(this.engine.getState(), this.engine.getActivity())
      } else {
        // 点击 → 随机互动动画（一次性，播完恢复当前状态）
        const list = window.PetState.INTERACT_ANIMS || []
        const rand = list[Math.floor(Math.random() * list.length)]
        if (rand) {
          this.engine.playOnce(rand, () => {
            this.engine.setState(this.engine.getState(), this.engine.getActivity())
          })
        }
      }
      this.dragMoved = false
      this.bridge.dragEnd()
      e.preventDefault()
    })
  }
}

window.PetInteract = PetInteract
