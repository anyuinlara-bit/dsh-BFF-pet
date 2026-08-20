// BFF-pet 精简状态机：DSH session 事件 → 宠物状态
// 参考 dafeiyu companion-reducer，只保留状态推导，去掉气泡/任务卡复杂度

export const PetState = Object.freeze({
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  WORKING: 'WORKING',
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
})

const statePriority = Object.freeze({
  WAITING: 60,
  ERROR: 50,
  WORKING: 30,
  THINKING: 20,
  SUCCESS: 10,
  IDLE: 0,
})

function isSubagent(session) {
  return Boolean(session?.scope === 'subagent' || session?.role === 'subagent')
}

function sessionIdOf(session) {
  return session?.id ?? session?.sid ?? session?.sessionId ?? 'default'
}

function isUserQuestionTool(name) {
  const value = String(name || '').toLowerCase()
  const tokens = value.split(/[^a-z0-9]+/u).filter(Boolean)
  const asks = new Set(['ask', 'request', 'prompt', 'seek', 'get', 'require'])
  const nouns = new Set(['question', 'input', 'answer', 'decision', 'confirmation', 'approval', 'permission', 'help'])
  const userWords = new Set(['user', 'human', 'me'])
  const hasUserNoun = tokens.some((t, i) => userWords.has(t) && nouns.has(tokens[i + 1] ?? ''))
  const hasAskNoun = tokens.some((t, i) => asks.has(t) && nouns.has(tokens[i + 1] ?? ''))
  return hasUserNoun || hasAskNoun
}

function toolActivity(name) {
  const value = String(name || '').toLowerCase()
  if (/search|grep|find|glob|web|read|fetch|open/.test(value)) return 'searching'
  if (/write|edit|patch|replace|create|move|delete/.test(value)) return 'editing'
  if (/test|check|lint|build|verify/.test(value)) return 'testing'
  if (/shell|bash|exec|command|terminal/.test(value)) return 'commanding'
  return 'working'
}

export class PetReducer {
  constructor({ includeSubagents = false, idleTimeoutMs = 0, onEmit = null } = {}) {
    this.includeSubagents = includeSubagents
    // 状态超时：超过该时长无任何状态事件 → 回落到 IDLE（0 = 禁用）
    this.idleTimeoutMs = idleTimeoutMs
    this.onEmit = onEmit || (() => {})
    this.sessions = new Map()
  }

  handle(session, event) {
    if (!event || typeof event.type !== 'string') return []
    if (!this.includeSubagents && isSubagent(session)) return []

    const sessionId = sessionIdOf(session)
    const record = this.sessions.get(sessionId) || {
      id: sessionId,
      state: PetState.IDLE,
      turnActive: false,
      openTools: new Set(),
      waitingCallId: undefined,
      idleTimer: undefined,
    }
    record.subagent = isSubagent(session)
    record.lastSeq = Number(event.seq ?? record.lastSeq ?? 0)
    this.sessions.set(sessionId, record)
    this.#refreshIdleTimer(record)

    switch (event.type) {
      case 'turn/start':
        record.turnActive = true
        record.openTools.clear()
        record.waitingCallId = undefined
        record.state = PetState.THINKING
        return this.#render(record, 'turn-start')

      case 'step/start':
      case 'assistant/chunk':
      case 'assistant/message':
        if (!record.turnActive || record.openTools.size > 0) return []
        record.state = PetState.THINKING
        return this.#render(record, 'thinking')

      case 'tool/call': {
        const callId = String(event.data?.name ?? event.data?.message?.name ?? event.seq ?? 'tool')
        const name = String(event.data?.name ?? event.data?.message?.name ?? 'tool')
        record.openTools.add(callId)
        if (isUserQuestionTool(name)) {
          record.waitingCallId = callId
          record.state = PetState.WAITING
          return this.#render(record, 'waiting', name)
        }
        record.state = PetState.WORKING
        return this.#render(record, toolActivity(name), name)
      }

      case 'tool/result': {
        const callId = String(event.data?.message?.source?.callId
          ?? event.data?.message?.toolCallId
          ?? event.data?.callId
          ?? event.seq ?? '')
        if (callId) record.openTools.delete(callId)
        if (callId && callId === record.waitingCallId) record.waitingCallId = undefined
        // 工具出错 → 返回一次性 error 闪现消息（不改变常驻状态）
        if (event.data?.error) {
          return [this.#renderError('tool-error', event.data.error, record.lastSeq)]
        }
        return this.#resume(record)
      }

      case 'user/message':
        if (!record.waitingCallId) return []
        record.waitingCallId = undefined
        return this.#resume(record)

      case 'turn/end': {
        record.turnActive = false
        record.openTools.clear()
        // 整轮出错 → 一次性 ERROR 闪现；否则 SUCCESS
        if (event.data?.error) {
          return [this.#renderError('turn-error', event.data.error, record.lastSeq)]
        }
        record.state = PetState.SUCCESS
        return this.#render(record, 'turn-end')
      }

      default:
        return []
    }
  }

  #resume(record) {
    if (!record.turnActive) return []
    record.state = record.openTools.size > 0 ? PetState.WORKING : PetState.THINKING
    return this.#render(record, 'resume')
  }

  #render(record, phase, toolName) {
    record.phase = phase
    record.toolName = toolName
    return [{
      kind: 'state',
      state: record.state,
      phase,
      toolName,
      seq: record.lastSeq,
    }]
  }

  // 一次性错误闪现消息（不影响常驻状态）
  #renderError(phase, error, seq) {
    return {
      kind: 'error',
      state: PetState.ERROR,
      phase,
      errorCode: error?.code || error?.message || 'unknown',
      seq,
    }
  }

  // 状态超时：每次事件刷新定时器，超时后回到 IDLE
  #refreshIdleTimer(record) {
    if (!this.idleTimeoutMs || this.idleTimeoutMs <= 0) return
    if (record.idleTimer) { clearTimeout(record.idleTimer); record.idleTimer = undefined }
    if (record.state === PetState.IDLE) return
    record.idleTimer = setTimeout(() => {
      record.idleTimer = undefined
      if (record.state === PetState.IDLE) return
      const prev = record.state
      // 回到空闲（不强制打断 WAITING 之外的特殊态，统一回落 IDLE）
      record.state = PetState.IDLE
      record.turnActive = false
      record.openTools.clear()
      record.waitingCallId = undefined
      const msgs = this.#render(record, 'idle-timeout')
      for (const m of msgs) this.onEmit(m)
      if (prev !== PetState.IDLE) {
        // 记录回落日志由上层处理
      }
    }, this.idleTimeoutMs)
    record.idleTimer.unref?.()
  }

  disposeSession(session) {
    const sessionId = sessionIdOf(session)
    const record = this.sessions.get(sessionId)
    if (record?.idleTimer) { clearTimeout(record.idleTimer); record.idleTimer = undefined }
    return this.sessions.delete(sessionId)
  }

  // 多 session 合并：返回当前优先级最高的会话状态
  getPriorityState() {
    let best = null
    let bestPrio = -Infinity
    for (const record of this.sessions.values()) {
      const prio = statePriority[record.state] ?? 0
      if (prio > bestPrio) {
        bestPrio = prio
        best = record
      }
    }
    if (!best) return { state: PetState.IDLE, phase: 'no-session' }
    return {
      state: best.state,
      phase: best.phase,
      toolName: best.toolName,
    }
  }
}
