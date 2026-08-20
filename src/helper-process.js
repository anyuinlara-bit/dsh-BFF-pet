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
const WIN_RUNTIME = WIN_BASE + '\\runtime'

// ── Electron 定位（多候选取第一个可用的）──
// 只负责"找对路径"，不负责拉取——拉取由使用者/Agent 按环境处理。
// 纯 Windows：npm install electron 后位于 node_modules/electron/dist/electron.exe，直接可用。
// WSL：需要 Windows 版 electron（bin/win32-x64 或已同步到 Windows 本地盘的 electron-dist）。
function electronExeName() {
  return process.platform === 'win32' ? 'electron.exe' : 'electron'
}

// 用户 npm install electron 后的标准位置（纯 Windows 场景）
function npmElectronPath() {
  return resolve(pluginRoot, 'node_modules', 'electron', 'dist', electronExeName())
}

// 兼容旧的本地 Windows 版 bin 目录
function bundledElectronPath() {
  return resolve(pluginRoot, 'bin', 'win32-x64', 'electron.exe')
}

// 返回定位到的 Electron 可执行文件路径，找不到返回 null
function locateElectron(options = {}) {
  const explicit = options.electronPath || process.env.ELECTRON_PATH
  if (explicit && existsSync(explicit)) return explicit
  if (process.platform === 'win32') {
    // 纯 Windows：npm 拉取的 electron
    const npm = npmElectronPath()
    if (existsSync(npm)) return npm
  }
  // WSL / 其他：Windows 版 bin（WSL 用它同步到 Windows 后由 cmd.exe 运行）
  const bundled = bundledElectronPath()
  if (existsSync(bundled)) return bundled
  // 兜底：任何已存在的 electron/electron.exe
  const npm = npmElectronPath()
  if (existsSync(npm)) return npm
  return null
}

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

// 同步 runtime（+ WSL 场景下的 Windows 版 electron）到 Windows 本地盘
// 纯 Windows：runtime 就在本地 C 盘同目录，无需跨盘同步，此函数为空操作。
// WSL：把 runtime 与 bin/win32-x64（Windows 版 electron）复制到 C:\Users\<user>\AppData\Local\dsh-BFF-pet\
function syncToWindows() {
  if (process.platform === 'win32') return // 纯 Windows：无需跨环境同步

  const wslRuntimeDir = windowsToWsl(WIN_RUNTIME)
  if (!wslRuntimeDir) return

  // runtime：增量覆盖（不删整个目录，避免 assets 被托盘图标占用导致 ENOTEMPTY）
  mkdirSync(wslRuntimeDir, { recursive: true })
  cpSync(runtimeDir, wslRuntimeDir, { recursive: true })

  // WSL：把 Windows 版 electron（bin/win32-x64）同步到 Windows 本地盘 electron-dist
  const bundled = resolve(pluginRoot, 'bin', 'win32-x64')
  if (existsSync(bundled)) {
    const wslElectronDir = windowsToWsl(WIN_BASE + '\\electron-dist')
    if (wslElectronDir) {
      try {
        rmSync(wslElectronDir, { recursive: true, force: true })
      } catch (e) { noteError('sync-rm-electron-dist', e) }
      mkdirSync(wslElectronDir, { recursive: true })
      cpSync(bundled, wslElectronDir, { recursive: true })
    }
  }
}

// 杀掉 BFF-pet 的 Electron 进程
// 说明：精确按命令行定位需 PowerShell，但 bash→cmd→powershell 多层转义会破坏
//       -Filter 引号导致查询失败，不可靠。为确保 sync 不被占用 DLL 卡住，
//       改用可靠的 taskkill /IM（与 dafeiyu 的清理策略一致）。
// 副作用：会一并结束用户的其他 electron.exe 应用（VS Code 等），
//         桌面宠物场景可接受；未来可改为记录自有 PID 精确清理。
function killBFFElectron() {
  try {
    // 纯 Windows 直接用 taskkill；WSL 通过 cmd.exe 调
    const killCmd = (process.platform === 'win32')
      ? 'taskkill /F /IM electron.exe'
      : '/mnt/c/Windows/System32/cmd.exe /c taskkill /F /IM electron.exe'
    execSync(killCmd, { stdio: 'ignore', timeout: 8000 })
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
    if (process.platform === 'win32') {
      // 纯 Windows：定位（npm electron 或 bin）后直接运行
      const electronPath = locateElectron(this.options)
      if (!electronPath) {
        throw new Error(
          'BFF-pet: Electron 未找到。请先拉取运行环境：\n' +
          '  npm install electron\n' +
          '  或用环境变量 ELECTRON_PATH 指定 electron(.exe) 路径'
        )
      }
      return { cmd: electronPath, args: [WIN_RUNTIME], cwd: null }
    }

    if (process.platform === 'linux' && isWSL()) {
      // WSL：需要 Windows 版 electron。优先用已同步到 Windows 本地盘的 electron-dist；
      // 否则回退 bin/win32-x64（同步函数会将其部署到 Windows 本地盘）
      const winElectron = WIN_BASE + '\\electron-dist\\electron.exe'
      const wslCheck = windowsToWsl(winElectron)
      if (wslCheck && existsSync(wslCheck)) {
        return { cmd: '/mnt/c/Windows/System32/cmd.exe', args: ['/c', winElectron, WIN_RUNTIME], cwd: '/mnt/c' }
      }
      const bundled = bundledElectronPath()
      if (existsSync(bundled)) {
        // bin/win32-x64 存在，会由 syncToWindows 部署到 Windows 本地盘
        logInfo('BFF-pet: electron-dist 尚未同步，期望由 syncToWindows 部署后再启动')
        throw new Error('BFF-pet: Windows 侧 electron-dist 未就绪（syncToWindows 将部署 bin/win32-x64）')
      }
      throw new Error(
        'BFF-pet: Windows 版 Electron 未找到。请将 Windows 版 electron 放到 bin/win32-x64/electron.exe' +
        '（或用 BFF_PET_WIN_BASE / 手动部署）。WSL 下 npm install electron 拉取的是 Linux 版，无法驱动 Windows 桌宠。'
      )
    }

    // 其他平台：不支持
    throw new Error(`BFF-pet: 当前平台 (${process.platform}) 不支持 Windows Electron 桌宠`)
  }

  start() {
    if (this.child || this.stopping) return
    killBFFElectron()
    syncToWindows()

    const { cmd, args, cwd } = this.#command()
    this.logger.info?.('BFF-pet: starting electron')

    // 传 DSH webServer 地址给 Electron，供其轮询状态端点
    const child = spawn(cmd, args, {
      cwd: cwd ?? (process.platform === 'win32' ? WIN_BASE : '/mnt/c'),
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

// 导出纯逻辑函数，便于单元测试（平台路径识别是本项目桥接的核心）
export { locateElectron, windowsToWsl, bundledElectronPath, npmElectronPath, electronExeName, isWSL }
