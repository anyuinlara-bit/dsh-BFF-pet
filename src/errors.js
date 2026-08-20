// errors.js — 轻量错误可视化辅助
// 收集最近的关键错误，供日志与状态端点暴露，避免静默吞错
// 用法：
//   import { noteError, lastError } from './errors.js'
//   try { ... } catch (e) { noteError('sync-failed', e) }
// 状态端点可调用 lastError() 返回最近错误，便于前端/调试发现

const MAX_HISTORY = 20
const history = []

const LOG = {
  debug: (msg) => safeLog('DEBUG', msg),
  info: (msg) => safeLog('INFO', msg),
  warn: (msg) => safeLog('WARN', msg),
  error: (msg) => safeLog('ERROR', msg),
}

function safeLog(level, msg) {
  try {
    // 若 DSH 提供了 logger 由插件注入，此处仅兜底 console
    if (typeof console !== 'undefined') {
      const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : level === 'DEBUG' ? console.debug : console.log
      if (typeof fn === 'function') fn(`[dsh-BFF-pet] ${msg}`)
    }
  } catch {}
}

/**
 * 记录一个错误/警告（含来源标签）
 * @param {string} source  来源，如 'sync'、'kill'、'spawn'
 * @param {Error|unknown} err 错误对象
 * @param {object} extra 附加信息
 */
export function noteError(source, err, extra = {}) {
  const now = new Date().toISOString()
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? (err.stack || '') : ''
  const entry = { at: now, source, message, stack, extra }
  history.unshift(entry)
  if (history.length > MAX_HISTORY) history.pop()
  LOG.error(`[${entry.at}] ${source}: ${message}${Object.keys(extra).length ? ' extra=' + JSON.stringify(extra) : ''}`)
  return entry
}

/**
 * 记录一条普通日志
 */
export function logInfo(message) {
  LOG.info(message)
}

/**
 * 返回最近的错误记录（新→旧）
 */
export function lastError(n = 1) {
  return history.slice(0, n)
}

/**
 * 返回全部错误历史
 */
export function errorHistory() {
  return [...history]
}
