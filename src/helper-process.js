// BFF-pet helper 进程管理：从 WSL spawn Windows Electron，并同步 runtime
import { spawn, execSync } from 'node:child_process'
import { existsSync, readFileSync, cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { userInfo } from 'node:os'
import { noteError, logInfo } from './errors.js'

const here = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(here, '..')

// 插件内置的 runtime 目录
const runtimeDir = resolve(pluginRoot, 'runtime')

// 自动探测 Windows 用户名：优先 /mnt/c/Users 下与当前 WSL 用户匹配的目录
function detectWindowsUser() {
  try {
    const candidates = ['/mnt/c/Users', '/mnt/c/用户']
    for (const base of candidates) {
      if (!existsSync(base)) continue
      const users = readdirSync(base)
      // 1) 精确匹配当前 WSL 用户
      const u = userInfo().username
      if (u && users.includes(u)) return u
      // 2) 取非系统目录（排除 All Users/Default/Public 等）
      const skip = new Set(['All Users', 'Default', 'Default User', 'Public', 'desktop.ini', 'AllUsers'])
      const real = users.find((x) => !skip.has(x) && !x.startsWith('.'))
      if (real) return real
    }
  } catch (e) { noteError('detect-windows-user', e) }
  return null
}

// Windows 本地目录（Electron 无法从 WSL/UNC 路径加载应用和二进制）
function defaultWinBase() {
  const user = detectWindowsUser()
  // C:\Users\<user>\AppData\Local\dsh-BFF-pet
  if (user) return `C:\\Users\\${user}\\AppData\\Local\\dsh-BFF-pet`
  // 兜底：WSL home 映射（很少发生）
  return 'C:\\Users\\dsh-BFF-pet'
}
const WIN_BASE = process.env.BFF_PET_WIN_BASE || defaultWinBase()
const WIN_ELECTRON = WIN_BASE + '\\electron-dist\\electron.exe'
const WIN_RUNTIME = WIN_BASE + '\\runtime'

function isWSL() {
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')
  } catch (e) { noteError('isWSL-check', e); return false }
}

// 路径方向辅助函数（重点）
// Windows 路径 → WSL 路径  C:\a\b → /mnt/c/a/b
function windowsToWsl(winPath) {
  const m = winPath.match(/^([a-zA-Z]):\\(.*)$/)
  if (!m) return null
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

// 同步 electron 整个目录 + runtime 到 Windows 本地盘
// 采用增量覆盖，避免 rmSync 整个目录（Electron 运行时可能占用文件导致 ENOTEMPTY）
function syncToWindows() {
  // WSL 视角的目标路径
  const wslElectronDir = windowsToWsl(WIN_BASE + '\\electron-dist')
  const wslRuntimeDir = windowsToWsl(WIN_BASE + '\\runtime')
  if (!wslElectronDir || !wslRuntimeDir) return

  // electron-dist：先尝试删旧目录（二进制被占用时可跳过），再保证存在并覆盖
  try {
    rmSync(wslElectronDir, { recursive: true, force: true })
  } catch (e) { noteError('sync-rm-electron-dist', e) }
  mkdirSync(wslElectronDir, { recursive: true })
  cpSync(resolve(pluginRoot, 'bin', 'win32-x64'), wslElectronDir, { recursive: true })

  // runtime：增量覆盖（不删整个目录，避免 assets 被托盘图标占用导致 ENOTEMPTY）
  mkdirSync(wslRuntimeDir, { recursive: true })
  cpSync(runtimeDir, wslRuntimeDir, { recursive: true })

  // electron.exe 最终位置（若 electron-dist 删除被跳过，确保覆盖）
  try {
    const srcExe = resolve(pluginRoot, 'bin', 'win32-x64', 'electron.exe')
    cpSync(srcExe, wslElectronDir + '\\electron.exe', { force: true })
  } catch (e) { noteError('sync-electron-exe', e) }
}

// 杀掉 BFF-pet 的 Electron 进程
// 说明：精确按命令行定位需 PowerShell，但 bash→cmd→powershell 多层转义会破坏
//       -Filter 引号导致查询失败，不可靠。为确保 sync 不被占用 DLL 卡住，
//       改用可靠的 taskkill /IM（与 dafeiyu 的清理策略一致）。
// 副作用：会一并结束用户的其他 electron.exe 应用（VS Code 等），
//         桌面宠物场景可接受；未来可改为记录自有 PID 精确清理。
function killBFFElectron() {
  try {
    execSync('/mnt/c/Windows/System32/cmd.exe /c taskkill /F /IM electron.exe', { stdio: 'ignore', timeout: 8000 })
  } catch (e) {
    // taskkill 在没有匹配进程时返回 128（"没有运行的任务"）——这是正常情况，忽略
    // 其余非零为真实失败，记录以便排查
    const status = typeof e?.status === 'number' ? e.status : e?.code
    const isNoProcess = status === 128 || (e && /not found|没有运行|no tasks/i.test(String(e.message || '')))
    if (!isNoProcess) noteError('kill-electron', e)
  }
}

export class BFFHelper {
  constructor(options = {}, logger = console) {
    this.options = options
    this.logger = logger
    this.child = undefined
    this.spawned = false
    this.stopping = false
    this.restartTimer = undefined
    this.restartAttempts = 0
    this.#registerExitHook()
  }

  #registerExitHook() {
    const cleanup = () => {
      if (this.child && !this.stopping) {
        this.stopping = true
        if (this.restartTimer) clearTimeout(this.restartTimer)
        killBFFElectron()
      }
    }
    process.on('exit', cleanup)
    process.on('SIGTERM', () => { cleanup(); process.exit(0) })
    process.on('SIGINT', () => { cleanup(); process.exit(0) })
  }

  #command() {
    const electronPath = this.options.electronPath || WIN_ELECTRON

    if (process.platform === 'linux' && isWSL()) {
      // WSL 中检查 Windows 路径用 /mnt/c/...
      const wslCheck = windowsToWsl(electronPath)
      if (wslCheck && !existsSync(wslCheck)) {
        throw new Error(`BFF-pet: electron not found: ${electronPath}`)
      }
      return { cmd: '/mnt/c/Windows/System32/cmd.exe', args: ['/c', electronPath, WIN_RUNTIME] }
    }
    if (!existsSync(electronPath)) {
      throw new Error(`BFF-pet: electron not found: ${electronPath}`)
    }
    return { cmd: electronPath, args: [WIN_RUNTIME] }
  }

  start() {
    if (this.child || this.stopping) return
    killBFFElectron()
    syncToWindows()

    const { cmd, args } = this.#command()
    this.logger.info?.('BFF-pet: starting electron')

    // 传 DSH webServer 地址给 Electron，供其轮询状态端点
    const child = spawn(cmd, args, {
      cwd: '/mnt/c',
      env: {
        ...process.env,
        DSH_WEB_URL: this.options.webUrl || process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
        BFF_PET_STATE_PATH: this.options.statePath || '/plugins/dsh-BFF-pet/state',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    child.once('spawn', () => {
      this.spawned = true
      this.restartAttempts = 0 // 启动成功，重置重试计数
    })
    child.once('error', (error) => {
      this.logger.error?.(`BFF-pet: helper failed: ${error.message}`)
      this.child = undefined
      this.spawned = false
      this.#scheduleRestart()
    })
    child.once('exit', (code) => {
      this.child = undefined
      this.spawned = false
      if (!this.stopping) {
        this.logger.warn?.(`BFF-pet: helper exited (code=${code}); restarting`)
        this.#scheduleRestart()
      }
    })
    return child
  }

  // 退避重试：1s → 2s → 4s → 8s → 上限 16s
  #scheduleRestart() {
    if (this.stopping || this.child || this.restartTimer) return
    const delay = Math.min(1000 * (2 ** Math.min(this.restartAttempts, 4)), 16000)
    this.restartAttempts++
    this.logger.info?.(`BFF-pet: restart in ${delay / 1000}s (attempt ${this.restartAttempts})`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined
      if (!this.stopping) this.start()
    }, delay)
    this.restartTimer.unref?.()
  }

  // 兼容保留：现由 Electron 主动轮询端点，send 不再写 stdin
  send(_message) {}

  stop(reason = 'stop') {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    if (this.child) {
      try { this.child.stdin.end() } catch (e) { noteError('stop-stdin-end', e) }
      killBFFElectron()
      try { this.child.kill() } catch (e) { noteError('stop-child-kill', e) }
      this.child = undefined
    }
    this.spawned = false
  }

  // 用户主动退出：彻底停止，不再自动重启（直到插件下次 apply 重建）
  permanentStop(reason = 'user-quit') {
    this.logger.info?.(`BFF-pet: permanent stop (${reason}); will not auto-restart`)
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = undefined
    }
    if (this.child) {
      killBFFElectron()
      try { this.child.kill() } catch (e) { noteError('quit-child-kill', e) }
      this.child = undefined
    }
    this.spawned = false
  }
}
