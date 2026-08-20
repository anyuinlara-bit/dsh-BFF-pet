/**
 * PetStatePoller — 主进程：轮询 DSH 状态端点并转发给渲染层
 * class PetStatePoller：
 *   - 定期 HTTP GET DSH webServer 的状态端点（WSL2 localhost 转发可达）
 *   - 去重后通过 'dsh-message' 转发给渲染进程（preload 的 onMessage）
 *   - 断连检测：连续多次请求失败 → 推送 DISCONNECTED；恢复后推送真实状态
 * 依赖：node:http，无需额外通信管道
 */
const http = require('http')

class PetStatePoller {
  /**
   * @param {object} opts
   * @param {() => boolean} opts.isReady  窗口是否就绪（就绪后才轮询）
   * @param {(...args:any[]) => void} opts.send  转发消息给渲染层（如 win.send）
   * @param {string} [opts.url]  DSH webServer 地址
   * @param {string} [opts.path] 状态端点路径
   * @param {number} [opts.pollMs] 轮询间隔，默认 1000ms
   * @param {number} [opts.timeoutMs] 单次请求超时，默认 2000ms
   * @param {number} [opts.disconnectThreshold] 连续失败几次判定断连，默认 3
   */
  constructor({ isReady = () => false, send = () => {}, url, path, pollMs = 1000, timeoutMs = 2000, disconnectThreshold = 3 } = {}) {
    this.url = url || process.env.DSH_WEB_URL || 'http://127.0.0.1:3080'
    this.path = path || process.env.BFF_PET_STATE_PATH || '/plugins/dsh-BFF-pet/state'
    this.pollMs = pollMs
    this.timeoutMs = timeoutMs
    this.disconnectThreshold = disconnectThreshold
    this.isReady = isReady
    this.send = send
    this.timer = null
    this.lastSentKey = ''
    this.lastState = null       // 最近一次成功解析的状态消息（恢复时重发）
    this.consecutiveFailures = 0
    this.isDisconnected = false
  }

  /** 开始轮询 */
  start() {
    if (this.timer) return
    this.timer = setInterval(() => this._poll(), this.pollMs)
    this._poll() // 立即来一次
    if (this.timer.unref) this.timer.unref()
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  _poll() {
    if (!this.isReady()) return
    const req = http.get(this.url + this.path, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const msg = JSON.parse(data)
          if (!msg || !msg.kind) return
          this._onSuccess(msg)
        } catch (e) {
          this._onFailure('bad-response')
        }
      })
    })
    req.on('error', () => this._onFailure('network'))
    req.on('timeout', () => { req.destroy(); this._onFailure('timeout') })
    req.setTimeout(this.timeoutMs)
  }

  /** 请求成功 */
  _onSuccess(msg) {
    this.consecutiveFailures = 0
    this.lastState = msg
    // 从断连恢复 → 先推一次真实状态（覆盖 DISCONNECTED）
    if (this.isDisconnected) {
      this.isDisconnected = false
      this.lastSentKey = '' // 强制推送当前状态
    }
    const key = `${msg.kind}:${msg.state || ''}:${msg.phase || ''}`
    if (msg.kind === 'state' && key === this.lastSentKey) return // 状态去重
    this.lastSentKey = key
    this.send('dsh-message', msg)
  }

  /** 请求失败 → 计数，达阈值则断连 */
  _onFailure(reason) {
    this.consecutiveFailures++
    if (!this.isDisconnected && this.consecutiveFailures >= this.disconnectThreshold) {
      this.isDisconnected = true
      this.send('dsh-message', { kind: 'state', state: 'DISCONNECTED', phase: 'lost-connection', reason })
    }
  }
}

module.exports = { PetStatePoller }
