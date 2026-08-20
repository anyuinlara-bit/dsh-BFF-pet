/**
 * pet-engine.js — 动画播放引擎（双缓冲交叉淡入）
 * 全局命名空间 window.PetEngine
 *
 * class PetEngine：
 *   - 状态动画不循环，播完自动随机抽同组下一个（状态内轮播）
 *   - 兜底超时：单个动画超过 maxStatePlayMs 未播完 → 强制切下一个（防卡死）
 *   - 一次性动画（ERROR 闪现 / 彩蛋）播完 → 回调恢复状态
 */
class PetEngine {
  /** @param {HTMLVideoElement} va @param {HTMLVideoElement} vb */
  constructor(va, vb, options = {}) {
    this.va = va
    this.vb = vb
    this.maxStatePlayMs = options.maxStatePlayMs ?? 15000

    this.front = 0 // 0 = va 在前
    this.currentState = 'IDLE'
    this.currentActivity = undefined
    this.lastPickedAnim = null
    this.playTimeout = null

    // 初始
    this.setState('IDLE')
  }

  // ── 工具 ──
  _pickAnim(value, lastPicked) {
    if (Array.isArray(value) && value.length > 0) {
      let idx = Math.floor(Math.random() * value.length)
      if (value.length > 1 && value[idx] === lastPicked) {
        idx = (idx + 1) % value.length
      }
      return value[idx]
    }
    if (typeof value === 'string') return value
    return window.PetState.FALLBACK
  }

  _resolveAnim(state, activity, lastPicked) {
    const cfg = window.PetState.STATE_TO_ANIM[state]
    if (state === 'WORKING') {
      const actMap = window.PetState.WORK_ACTIVITY || {}
      const key = activity || 'working'
      return this._pickAnim(actMap[key] || actMap.working || actMap.default, lastPicked)
    }
    return this._pickAnim(cfg || window.PetState.FALLBACK, lastPicked)
  }

  _clearPlayTimer() {
    if (this.playTimeout) { clearTimeout(this.playTimeout); this.playTimeout = null }
  }

  // 底层的双缓冲切换
  _play(animFile, loop, onEnded) {
    this._clearPlayTimer()
    const currentFront = this.front === 0 ? this.va : this.vb
    const nextBack = this.front === 0 ? this.vb : this.va
    // 被顶成后台的旧视频：清掉 onended 回调并暂停，避免它播完触发
    // advanceState 把当前播放（如彩蛋）中途打断
    currentFront.onended = null
    if (!currentFront.paused) currentFront.pause()
    nextBack.src = animFile
    nextBack.loop = loop
    nextBack.onloadeddata = () => {
      nextBack.classList.add('is-front')
      currentFront.classList.remove('is-front')
      this.front = this.front === 0 ? 1 : 0
      nextBack.play().catch(() => {})
    }
    nextBack.onended = () => {
      this._clearPlayTimer()
      if (onEnded) onEnded()
    }
    nextBack.onerror = () => {
      console.error('VIDEO-ERROR:', animFile, 'code=', nextBack.error ? nextBack.error.code : 'n/a',
        'networkState=', nextBack.networkState, 'readyState=', nextBack.readyState)
      this._clearPlayTimer()
      if (onEnded) onEnded() // 加载失败也继续流程
    }
    nextBack.load()
  }

  // 状态动画：播完自动随机同组下一个（状态内轮播）
  _playState(animFile) {
    this.lastPickedAnim = animFile
    this._clearPlayTimer()
    this.playTimeout = setTimeout(() => {
      this.playTimeout = null
      this._advanceState()
    }, this.maxStatePlayMs)
    this._play(animFile, false, () => this._advanceState())
  }

  _advanceState() {
    if (!this.currentState) return
    const next = this._resolveAnim(this.currentState, this.currentActivity, this.lastPickedAnim)
    this._playState(next)
  }

  // 一次性动画（ERROR 闪现 / 彩蛋），播完回调
  playOnce(animFile, onFinished) {
    this._clearPlayTimer()
    this._play(animFile, false, () => { if (onFinished) onFinished() })
  }

  // 设置状态：信号驱动切动画
  setState(state, activity) {
    if (!state) return
    this.currentState = state
    if (activity !== undefined) this.currentActivity = activity
    const anim = this._resolveAnim(state, this.currentActivity, this.lastPickedAnim)
    this.lastPickedAnim = anim
    this._playState(anim)
  }

  getState() { return this.currentState }
  getActivity() { return this.currentActivity }
}

window.PetEngine = PetEngine
