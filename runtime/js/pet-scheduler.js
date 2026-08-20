/**
 * pet-scheduler.js — 定时彩蛋调度
 * 全局命名空间 window.PetScheduler
 *
 * class PetScheduler：
 *   - 空闲每 60s 必触发一次彩蛋
 *   - 吃饭时间彩蛋（早餐/午餐/晚餐，仅空闲，每天每餐一次）
 *   - 长时间 WORKING → 吃 Token
 */
class PetScheduler {
  static IDLE_EGG_INTERVAL = 60 * 1000   // 空闲每 60 秒必触发一次彩蛋
  static WORK_TOKEN_INTERVAL = 60 * 1000  // WORKING > 60s 触发吃 Token
  static CHECK_INTERVAL = 15 * 1000       // 每 15 秒检查

  /** @param {PetEngine} engine @param {() => {state:string,activity?:string}} stateProvider */
  constructor(engine, stateProvider, options = {}) {
    this.engine = engine
    this.stateProvider = stateProvider
    this.lastMeal = {}          // 每餐每天一次
    this.lastTokenAt = 0        // 上次吃 Token
    this.lastIdleEggAt = Date.now()  // 上次空闲彩蛋时间
    this.lastNonIdleAt = Date.now()  // 上次离开 IDLE 时间
    this.longWorkAt = 0
    this.timer = null
  }

  _state() { return this.stateProvider() || {} }

  _mealForHour(hour) {
    const meals = window.PetState.MEAL_EVENTS || []
    for (const m of meals) {
      if (hour >= m.startHour && hour < m.endHour) return m
    }
    return null
  }

  _restoreState() {
    const s = this._state()
    const st = s.state || 'IDLE'
    const act = st === 'WORKING' ? s.activity : undefined
    this.engine.setState(st, act)
  }

  _tick() {
    const s = this._state()
    const st = s.state
    const hour = new Date().getHours()
    const now = Date.now()

    // 状态跟踪
    if (st !== 'IDLE') {
      this.lastNonIdleAt = now
    } else if (this.lastNonIdleAt === 0) {
      this.lastNonIdleAt = now
    }

    // 1) 长时间 WORKING → 吃 Token（工作 > 60s 触发一次）
    if (st === 'WORKING') {
      if (!this.longWorkAt) this.longWorkAt = now
      if (now - this.longWorkAt > PetScheduler.WORK_TOKEN_INTERVAL) {
        this.longWorkAt = now // 重置，允许反复触发（但每个 WORKING 周期至少一次）
        this.lastTokenAt = now
        this.engine.playOnce(window.PetState.LONG_WORK_ANIM, () => this._restoreState())
        return
      }
    } else {
      this.longWorkAt = 0
    }

    // 2) 吃饭时间彩蛋（仅空闲，每天每餐一次）
    const meal = this._mealForHour(hour)
    const today = new Date().toDateString()
    if (meal && st === 'IDLE') {
      const key = meal.name + ':' + today
      if (this.lastMeal[key] !== true) {
        this.lastMeal[key] = true
        this.engine.playOnce(meal.anim, () => this._restoreState())
        return
      }
    }

    // 3) 空闲每 60 秒必触发一次彩蛋
    if (st === 'IDLE' && !meal) {
      if (now - this.lastIdleEggAt >= PetScheduler.IDLE_EGG_INTERVAL) {
        this.lastIdleEggAt = now
        const list = window.PetState.IDLE_EGG_ANIMS || []
        const anim = list[Math.floor(Math.random() * list.length)]
        if (anim) { this.engine.playOnce(anim, () => this._restoreState()); return }
      }
    }
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this._tick(), PetScheduler.CHECK_INTERVAL)
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }
}

window.PetScheduler = PetScheduler
