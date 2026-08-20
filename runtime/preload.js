const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('petBridge', {
  send: (msg) => ipcRenderer.send('to-dsh', msg),
  // DSH 状态消息
  onMessage: (callback) => {
    ipcRenderer.on('dsh-message', (e, msg) => callback(msg))
  },
  // 菜单动作（触发彩蛋/气泡开关）
  onAction: (callback) => {
    ipcRenderer.on('pet-action', (e, payload) => callback(payload))
  },
  // 拖拽（主进程计算位置）
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
})
