// dsh-BFF-pet 插件入口
// 监听 DSH session 事件 → PetReducer 推导状态 → 通过 DSH webServer HTTP 端点暴露
// Windows Electron 通过轮询 GET /plugins/dsh-BFF-pet/state 获取状态并驱动桌宠
import { BFFHelper } from './helper-process.js'
import { PetReducer } from './reducer.js'
import { noteError, lastError } from './errors.js'

export const name = 'dsh-BFF-pet'
export const inject = ['sessions']

// 状态端点路径（Electron 轮询用）
export const STATE_ENDPOINT = '/plugins/dsh-BFF-pet/state'
// 退出控制端点（Electron 点“退出宠物”时调用，彻底停止不再重启）
export const QUIT_ENDPOINT = '/plugins/dsh-BFF-pet/quit'

// 状态优先级（多 session 并发时选最高）
const PRIORITY = Object.freeze({
  WAITING: 60,
  ERROR: 50,
  WORKING: 30,
  THINKING: 20,
  SUCCESS: 10,
  IDLE: 0,
})

// 仅允许本机（loopback）访问
function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr === undefined
}

function json(res, code, obj) {
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  } catch (e) { noteError('http-respond', e) }
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const enabled = config.enabled !== false
  // 无活动超时自动回落 IDLE（毫秒）。0=禁用；默认 12000ms（约 12 秒完成任务后无新活动回落空闲）
  const idleTimeoutMs = Number(config.idleTimeoutMs) > 0
    ? Number(config.idleTimeoutMs)
    : 12000

  // 该插件只有一个 Electron helper；helper 重建时 httpCtx/桥需重建
  let helper
  let reducer

  // 最新状态（Electron 轮询读取）
  let latest = { kind: 'state', state: 'IDLE', phase: 'no-session' }
  // 一次性消息队列（如 ERROR 闪现），GET 时消费
  let pending = []

  // 更新最新状态并去重（不直接 send，靠端点暴露）
  const updateState = (msg) => {
    const key = `${msg.state}:${msg.phase ?? ''}`
    if (latest.kind === 'state' && `${latest.state}:${latest.phase ?? ''}` === key) return
    latest = msg
  }

  const pushState = (phase = 'update') => {
    if (!reducer) return
    const agg = reducer.getPriorityState()
    updateState({
      kind: 'state',
      state: agg.state,
      phase: agg.phase || phase,
      toolName: agg.toolName,
    })
  }

  // 发起 Electron 连接（helper 负责 spawn + 轮询端点）
  const start = () => {
    if (!enabled) {
      logger.info?.('dsh-BFF-pet is disabled')
      return
    }
    try {
      reducer = new PetReducer({
        includeSubagents: config.includeSubagents === true,
        idleTimeoutMs,
        onEmit: () => { pushState('idle-timeout') },
      })
      helper = new BFFHelper(config, logger)
      helper.start()
      pushState('plugin-start')
      logger.info?.('dsh-BFF-pet started')
    } catch (error) {
      logger.error?.(`dsh-BFF-pet: ${error.message}`)
    }
  }

  const stop = () => {
    helper?.stop('plugin-dispose')
    helper = undefined
    reducer = undefined
  }

  start()

  // session 事件 → reducer 推导状态
  const offEvent = ctx.on('session/event', (session, event) => {
    if (!helper || !reducer) return
    try {
      const messages = reducer.handle(session, event)
      for (const msg of messages) {
        if (msg.kind === 'error') pending.push(msg) // 一次性闪现，端点消费
      }
      pushState('event')
    } catch (error) {
      logger.warn?.(`dsh-BFF-pet: reducer error: ${error.message}`)
    }
  }, { global: true })

  const offDisposed = ctx.on('session/disposed', (session) => {
    if (!helper || !reducer) return
    reducer.disposeSession(session)
  }, { global: true })

  // 在 DSH webServer 上注册状态/控制端点（共生：Electron 轮询状态、调用控制）
  const offServer = typeof ctx.inject === 'function'
    ? ctx.inject(['webServer'], (httpCtx) => {
        const offState = httpCtx.effect(
          () => httpCtx.webServer.register({
            kind: 'exact',
            path: STATE_ENDPOINT,
            handler: (req, res) => {
              if (!isLoopback(req.socket?.remoteAddress)) {
                json(res, 403, { error: 'local access only' })
                return
              }
              if (req.method !== 'GET') { json(res, 405, { error: 'method not allowed' }); return }
              // 一次性消息优先（如 ERROR 闪现），否则返回最新状态
              // 附上最近错误（若有），便于前端/调试发现静默失败
              if (pending.length > 0) {
                const msg = pending.shift()
                msg.errors = lastError()
                json(res, 200, msg)
                return
              }
              const out = { ...latest }
              out.errors = lastError()
              json(res, 200, out)
            },
          }),
          'dsh-BFF-pet: state endpoint',
        )
        // 用户主动退出：彻底停止 Electron，不再自动重启
        const offQuit = httpCtx.effect(
          () => httpCtx.webServer.register({
            kind: 'exact',
            path: QUIT_ENDPOINT,
            handler: (req, res) => {
              if (!isLoopback(req.socket?.remoteAddress)) {
                json(res, 403, { error: 'local access only' })
                return
              }
              if (req.method !== 'POST' && req.method !== 'GET') {
                json(res, 405, { error: 'method not allowed' })
                return
              }
              try { helper?.permanentStop('user-quit') } catch (e) { noteError('user-quit', e) }
              json(res, 200, { ok: true, stopped: true })
            },
          }),
          'dsh-BFF-pet: quit endpoint',
        )
        return () => { offState?.(); offQuit?.() }
      })
    : null

  return () => {
    offEvent()
    offDisposed()
    offServer?.()
    stop()
  }
}
