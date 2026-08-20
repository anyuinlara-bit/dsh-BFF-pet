// smoke.mjs — 冒烟测试脚本（本地与 CI 共用）
// 运行：node scripts/smoke.mjs   或  npm run smoke
// 检查内容：
//   1. 所有 src/*.js 语法可解析（node --check 等价，捕获低级错误）
//   2. 运行 reducer 状态机契约测试（回归保护）
// 用途：快速"体检"，确认代码能加载、逻辑没坏，再部署到桌宠

import { execSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

let failures = 0

function log(ok, msg) {
  if (ok) console.log('  \x1b[32m✓\x1b[0m ' + msg)
  else { console.log('  \x1b[31m✗\x1b[0m ' + msg); failures++ }
}

console.log('dsh-BFF-pet 冒烟测试')
console.log('──────────────────────')

// 1. 语法检查 src/*.js（插件侧）
console.log('\n[1] 语法检查 src/*.js')
const srcFiles = readdirSync(resolve(root, 'src')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
for (const f of srcFiles) {
  try {
    execSync(`node --check "${resolve(root, 'src', f)}"`, { stdio: 'ignore' })
    log(true, `src/${f} 语法正确`)
  } catch (e) {
    log(false, `src/${f} 语法错误: ${e.message.split('\n')[0]}`)
  }
}

// 2. 语法检查 runtime 主进程 js（main + js/main/*）
console.log('\n[2] 语法检查 runtime 主进程 js')
const mainFiles = ['runtime/main.js', 'runtime/preload.js']
  .concat(readdirSync(resolve(root, 'runtime', 'js', 'main')).map((f) => `runtime/js/main/${f}`))
for (const f of mainFiles) {
  try {
    execSync(`node --check "${resolve(root, f)}"`, { stdio: 'ignore' })
    log(true, `${f} 语法正确`)
  } catch (e) {
    log(false, `${f} 语法错误: ${e.message.split('\n')[0]}`)
  }
}

// 3. 运行 reducer 契约测试
console.log('\n[3] reducer 契约测试')
try {
  execSync('node --test src/reducer.test.js', { stdio: 'inherit', cwd: root })
} catch (e) {
  failures++
  log(false, 'reducer 契约测试失败')
}

// 4. 运行 helper 纯逻辑测试（平台路径识别）
console.log('\n[4] helper 纯逻辑测试')
try {
  execSync('node --test src/helper-process.test.js', { stdio: 'inherit', cwd: root })
} catch (e) {
  failures++
  log(false, 'helper 纯逻辑测试失败')
}

console.log('\n──────────────────────')
if (failures > 0) {
  console.log(`\x1b[31m✗ 冒烟测试失败（${failures} 项）\x1b[0m`)
  process.exit(1)
} else {
  console.log('\x1b[32m✓ 冒烟测试全部通过\x1b[0m')
  process.exit(0)
}
