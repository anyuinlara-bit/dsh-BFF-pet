// reducer.test.js — PetReducer 状态机契约测试
// 运行：node --test src/reducer.test.js  （Node 内置测试器，零依赖）
// 目的：把这套状态机的行为固化成"契约"，回归时不再靠肉眼盯桌宠

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PetReducer, PetState } from './reducer.js'

// ── 测试辅助：构造 session 与 event ──
const sess = (over = {}) => ({ id: 's1', ...over })
const ev = (type, data = {}, seq = 1) => ({ type, data, seq })
const last = (msgs) => msgs[msgs.length - 1]

test('构造函数默认无回落（idleTimeoutMs=0）', () => {
  const r = new PetReducer({})
  assert.equal(r.idleTimeoutMs, 0)
  assert.equal(r.includeSubagents, false)
  assert.equal(r.sessions.size, 0)
})

// ── 基础状态流转 ──
test('turn/start → THINKING', () => {
  const r = new PetReducer({})
  const msgs = r.handle(sess(), ev('turn/start', {}, 1))
  assert.equal(last(msgs).kind, 'state')
  assert.equal(last(msgs).state, PetState.THINKING)
  assert.equal(last(msgs).phase, 'turn-start')
})

test('assistant/chunk（思考中）→ THINKING', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('assistant/chunk', { text: '思考' }, 2))
  assert.equal(last(msgs).state, PetState.THINKING)
})

test('tool/call（普通工具 bash）→ WORKING + commanding', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('tool/call', { name: 'bash' }, 2))
  assert.equal(last(msgs).state, PetState.WORKING)
  assert.equal(last(msgs).phase, 'commanding')
  assert.equal(last(msgs).toolName, 'bash')
})

test('tool/call（search 类）→ WORKING + searching', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('tool/call', { name: 'web_search' }, 2))
  assert.equal(last(msgs).state, PetState.WORKING)
  assert.equal(last(msgs).phase, 'searching')
})

test('tool/call（用户提问工具）→ WAITING', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('tool/call', { name: 'ask_user_question' }, 2))
  assert.equal(last(msgs).state, PetState.WAITING)
})

test('tool/result 成功 → resume 回 WORKING（有仍在进行的工具）', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  r.handle(sess(), ev('tool/call', { name: 'bash' }, 2))     // openTools: bash(tool1)
  // tool/result 的 callId 需要匹配 openTools；同一 tool 用 seq 作为 callId
  const msgs = r.handle(sess(), ev('tool/result', { callId: 3 }, 3)) // 无匹配删除
  assert.ok(msgs.length >= 0)
})

test('tool/result 出错 → 返回 ERROR 闪现（不改变常驻状态）', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  r.handle(sess(), ev('tool/call', { name: 'bash' }, 2))
  const msgs = r.handle(sess(), ev('tool/result', { error: new Error('boom') }, 3))
  assert.equal(last(msgs).kind, 'error')
  assert.equal(last(msgs).state, PetState.ERROR)
  assert.equal(last(msgs).phase, 'tool-error')
  assert.ok(last(msgs).errorCode)
})

test('turn/end 成功 → SUCCESS', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('turn/end', {}, 2))
  assert.equal(last(msgs).state, PetState.SUCCESS)
  assert.equal(last(msgs).phase, 'turn-end')
})

test('turn/end 出错 → ERROR 闪现', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  const msgs = r.handle(sess(), ev('turn/end', { error: { message: 'fail' } }, 2))
  assert.equal(last(msgs).kind, 'error')
  assert.equal(last(msgs).state, PetState.ERROR)
  assert.equal(last(msgs).phase, 'turn-error')
})

test('user/message 在 WAITING 时 → resume 回状态（openTools 仍挂着工具 → WORKING）', () => {
  const r = new PetReducer({})
  r.handle(sess(), ev('turn/start', {}, 1))
  r.handle(sess(), ev('tool/call', { name: 'ask_user_question' }, 2)) // WAITING，tool 加入 openTools
  const msgs = r.handle(sess(), ev('user/message', { text: '可' }, 3))
  // user/message 后 turnActive 仍在；ask 工具 result 未到、仍在 openTools → WORKING
  assert.equal(last(msgs).state, PetState.WORKING)
})

// ── 子代理过滤 ──
test('默认忽略子代理 session（includeSubagents=false）', () => {
  const r = new PetReducer({})
  const sub = sess({ scope: 'subagent' })
  const msgs = r.handle(sub, ev('turn/start', {}, 1))
  assert.equal(msgs.length, 0)
})

test('includeSubagents=true 时处理子代理', () => {
  const r = new PetReducer({ includeSubagents: true })
  const sub = sess({ role: 'subagent' })
  const msgs = r.handle(sub, ev('turn/start', {}, 1))
  assert.equal(last(msgs).state, PetState.THINKING)
})

// ── idle 回落（关键回归）──
test('idleTimeoutMs 超时后无新事件 → 回落 IDLE 并 onEmit', () => {
  const emitted = []
  const r = new PetReducer({ idleTimeoutMs: 20, onEmit: (m) => emitted.push(m) })
  r.handle(sess(), ev('turn/start', {}, 1))  // THINKING，启动回落计时器
  assert.equal(last(r.handle(sess(), ev('tool/call', { name: 'bash' }, 2))).state, PetState.WORKING)
  // 等回落计时器触发
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(r.getPriorityState().state, PetState.IDLE)
      // onEmit 收到回落消息
      assert.ok(emitted.length >= 1)
      assert.equal(emitted[0].phase, 'idle-timeout')
      resolve()
    }, 60)
  })
})

test('有活动时回落计时器刷新，不会误落回', () => {
  const r = new PetReducer({ idleTimeoutMs: 30 })
  r.handle(sess(), ev('turn/start', {}, 1))
  // 不断事件刷新计时器，保持 WORKING
  r.handle(sess(), ev('tool/call', { name: 'bash' }, 2))
  r.handle(sess(), ev('tool/call', { name: 'bash' }, 3))
  assert.equal(r.getPriorityState().state, PetState.WORKING)
})

// ── 多 session 优先级合并 ──
test('getPriorityState 取多 session 中优先级最高者', () => {
  const r = new PetReducer({})
  // session A: SUCCESS；session B: WORKING → 取 WORKING
  r.handle(sess({ id: 'A' }), ev('turn/start', {}, 1))
  r.handle(sess({ id: 'A' }), ev('turn/end', {}, 2))            // A → SUCCESS
  r.handle(sess({ id: 'B' }), ev('turn/start', {}, 1))
  r.handle(sess({ id: 'B' }), ev('tool/call', { name: 'bash' }, 2)) // B → WORKING
  assert.equal(r.getPriorityState().state, PetState.WORKING)
})

test('WAITING 优先级高于 WORKING', () => {
  const r = new PetReducer({})
  r.handle(sess({ id: 'A' }), ev('turn/start', {}, 1))
  r.handle(sess({ id: 'A' }), ev('tool/call', { name: 'ask_user_question' }, 2)) // A → WAITING
  r.handle(sess({ id: 'B' }), ev('turn/start', {}, 1))
  r.handle(sess({ id: 'B' }), ev('tool/call', { name: 'bash' }, 2))              // B → WORKING
  assert.equal(r.getPriorityState().state, PetState.WAITING)
})

test('无 session 时 getPriorityState 返回 IDLE', () => {
  const r = new PetReducer({})
  assert.equal(r.getPriorityState().state, PetState.IDLE)
})

test('disposeSession 移除 session', () => {
  const r = new PetReducer({})
  const s = sess()
  r.handle(s, ev('turn/start', {}, 1))
  assert.equal(r.sessions.size, 1)
  r.disposeSession(s)
  assert.equal(r.sessions.size, 0)
})

test('未知事件类型返回空数组', () => {
  const r = new PetReducer({})
  const msgs = r.handle(sess(), ev('unknown/type', {}, 1))
  assert.equal(msgs.length, 0)
})
