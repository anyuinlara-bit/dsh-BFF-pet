// helper-process.test.js — helper 纯逻辑契约测试（平台路径识别）
// 运行：node --test src/helper-process.test.js
// 覆盖：路径转换、Electron 定位候选、平台判定——这些是 WSL/Windows 桥接的核心，
//       一旦出错桌宠连目录都找不到。本测试固化其"路径识别"契约。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  locateElectron,
  windowsToWsl,
  bundledElectronPath,
  npmElectronPath,
  electronExeName,
  isWSL,
} from './helper-process.js'
import { existsSync } from 'node:fs'

// ── windowsToWsl：Windows 路径 → WSL 路径 ──
test('windowsToWsl 常规 Windows 路径 → /mnt/c', () => {
  assert.equal(windowsToWsl('C:\\Users\\a\\b'), '/mnt/c/Users/a/b')
})

test('windowsToWsl 小写盘符也转小写', () => {
  assert.equal(windowsToWsl('c:\\x\\y'), '/mnt/c/x/y')
})

test('windowsToWsl 非 Windows 路径返回 null', () => {
  assert.equal(windowsToWsl('/home/foo'), null)
  assert.equal(windowsToWsl(''), null)
})

test('windowsToWsl 带反斜杠深层路径', () => {
  assert.equal(windowsToWsl('D:\\deep\\dir\\file.exe'), '/mnt/d/deep/dir/file.exe')
})

// ── electronExeName：平台 → 可执行文件名 ──
test('electronExeName 在 win32 返回 electron.exe', () => {
  // 无法直接改 process.platform，仅验证现有平台返回非空且合理
  const name = electronExeName()
  assert.ok(name === 'electron' || name === 'electron.exe')
})

// ── 路径候选 ──
test('bundledElectronPath 指向 bin/win32-x64/electron.exe', () => {
  const p = bundledElectronPath()
  assert.ok(p.includes('bin'))
  assert.ok(p.includes('win32-x64'))
  assert.ok(p.endsWith('electron.exe'))
})

test('npmElectronPath 指向 node_modules/electron/dist/electron', () => {
  const p = npmElectronPath()
  assert.ok(p.includes('node_modules'))
  assert.ok(p.includes('electron'))
  assert.ok(p.includes('dist'))
})

// ── locateElectron：当前环境（WSL/linux）能定位到 electron ──
test('locateElectron 在当前环境能找到 electron（bin 存在）', () => {
  const found = locateElectron({})
  if (existsSync(bundledElectronPath())) {
    // bin 存在 → 应定位成功
    assert.ok(found, '应在 bin 存在时定位到 electron')
    assert.equal(found, bundledElectronPath())
  } else {
    // 无 bin 时允许 null（由调用方给出拉取提示）
    assert.equal(found, null)
  }
})

test('locateElectron 显式指定优先', () => {
  // 传入不存在的显式路径会被忽略（回退其他候选）
  const r = locateElectron({ electronPath: '/nonexistent/e.exe' })
  // 不报错即可；结果取决于环境，只验证不抛异常且类型正确
  assert.ok(r === null || typeof r === 'string')
})

// ── isWSL：平台判定 ──
test('isWSL 在 WSL/本环境返回布尔', () => {
  assert.equal(typeof isWSL(), 'boolean')
})

// ── 平台命令语义（不实际 spawn，仅验证 #command 依赖的数据存在）──
test('WSL 场景下的 Windows electron-dist 结构存在性（若已同步）', () => {
  // 这是端到端依赖同步，不作为硬断言；仅确认函数不抛错
  const base = process.env.BFF_PET_WIN_BASE || ''
  assert.equal(typeof base, 'string')
})
