/**
 * pet-init.js — 主程序：装配引擎 + 气泡 + 状态/错误消息
 * 全局命名空间 window.PetInit
 *
 * class PetInit：主程序，组合各功能模块（engine/interact/scheduler）
 * 已接入：PetEngine（class）、PetScheduler（class）、PetInteract（class）
 */
class PetInit {
  // 状态 → 中文文案
  static STATE_LABELS = {
    IDLE: '空闲',
    THINKING: '思考中',
    WORKING: '工作中',
    WAITING: '等待确认',
    SUCCESS: '完成',
    ERROR: '错误',
    DISCONNECTED: '未连接',
  }
  // 活动类型 → 中文
  static ACTIVITY_LABELS = {
    searching: '搜索',
    editing: '编辑',
    testing: '测试',
    commanding: '命令',
    working: '工作',
  }

  constructor({ bridge } = {}) {
    this.bridge = bridge
    this.va = document.getElementById('va')
    this.vb = document.getElementById('vb')
    this.bubbleEl = document.getElementById('bubble')
    this.hit = document.getElementById('hit')

    this.currentState = 'IDLE'
    this.currentActivity = undefined
    this.bubbleVisible = true

    // 引擎（class）
    this.engine = new window.PetEngine(this.va, this.vb)

    // 彩蛋调度器（class）：读取当前状态，独立定时触发彩蛋
    this.scheduler = new window.PetScheduler(this.engine, () => ({
      state: this.currentState,
      activity: this.currentActivity,
    }))

    // 互动（class）：拖拽 + 点击，作用于 hit 区域
    this.interact = new window.PetInteract({
      bridge: this.bridge,
      hitEl: this.hit,
      engine: this.engine,
    })

    this._bindEvents()
    this._bindActions()
    this._init()
  }

  _init() {
    this.engine.setState('IDLE')
    this.scheduler.start()
    this._updateBubble()
  }

  _destroy() {
    this.scheduler.stop()
  }

  _bindEvents() {
    // 接收 DSH 消息（state / error）
    this.bridge.onMessage((msg) => {
      if (!msg || !msg.kind) return
      if (msg.kind === 'error') {
        this.engine.playOnce(this._pickErrorAnim(), () => this._restoreToState())
        return
      }
      if (msg.kind === 'state') {
        const state = msg.state || ''
        if (!state) return
        this.currentState = state
        this.currentActivity = state === 'WORKING' ? (msg.phase || 'working') : undefined
        this.engine.setState(state, this.currentActivity)
        this._updateBubble()
      }
    })
  }

  // 接收主进程动作（菜单触发彩蛋 / 气泡开关）
  _bindActions() {
    if (!this.bridge.onAction) return
    this.bridge.onAction((payload) => {
      if (!payload || !payload.action) return
      switch (payload.action) {
        case 'trigger-egg': this.randomEgg(); break
        case 'bubble-show': this.setBubble(true); break
        case 'bubble-hide': this.setBubble(false); break
        case 'set-scale': this.setScale(payload.value); break
      }
    })
  }

  // 渲染层缩放：对 #stage 应用 transform（窗口尺寸不变）
  setScale(ratio) {
    const stage = document.getElementById('stage')
    const r = Number(ratio)
    if (!stage || !(r > 0)) return
    stage.style.transform = 'scale(' + r + ')'
  }

  // ── 彩蛋 ──
  randomEgg() {
    const list = window.PetState.IDLE_EGG_ANIMS || []
    const anim = list[Math.floor(Math.random() * list.length)]
    if (anim) this.engine.playOnce(anim, () => this._restoreToState())
  }

  // ── 气泡 ──
  _updateBubble() {
    let label = PetInit.STATE_LABELS[this.currentState] || this.currentState
    if (this.currentState === 'WORKING' && this.currentActivity) {
      const act = PetInit.ACTIVITY_LABELS[this.currentActivity] || this.currentActivity
      label = label + ' · ' + act
    }
    if (this.bubbleEl) {
      this.bubbleEl.textContent = label
      this.bubbleEl.classList.toggle('visible', this.bubbleVisible)
    }
  }

  setBubble(visible) {
    this.bubbleVisible = visible
    this._updateBubble()
  }

  // ── ERROR 闪现 ──
  _pickErrorAnim() {
    const list = window.PetState.STATE_TO_ANIM.ERROR || []
    return list[Math.floor(Math.random() * list.length)] || window.PetState.FALLBACK
  }

  _restoreToState() {
    this.engine.setState(this.currentState || 'IDLE', this.currentActivity)
    this._updateBubble()
  }
}

window.PetInit = PetInit
