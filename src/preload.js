// Pont sécurisé entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['pty:data', 'pty:exit', 'tab:state', 'overlay:shown', 'indicator:update', 'app:warning'];

contextBridge.exposeInMainWorld('claudecraft', {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  spawn: (opts) => ipcRenderer.invoke('pty:spawn', opts),
  spawnShell: (opts) => ipcRenderer.invoke('pty:spawnShell', opts),
  write: (tabId, data) => ipcRenderer.send('pty:write', { tabId, data }),
  resize: (tabId, cols, rows) => ipcRenderer.send('pty:resize', { tabId, cols, rows }),
  kill: (tabId) => ipcRenderer.send('pty:kill', tabId),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  createProject: (name) => ipcRenderer.invoke('project:create', name),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.send('clipboard:write', text),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  hide: () => ipcRenderer.send('overlay:hide'),
  show: () => ipcRenderer.send('overlay:show'),
  toggle: () => ipcRenderer.send('overlay:toggle'),
  quit: () => ipcRenderer.send('app:quit'),
  openFolder: (p) => ipcRenderer.send('shell:openFolder', p),
  bubbleMove: (dx, dy) => ipcRenderer.send('bubble:move', { dx, dy }),
  bubbleDragEnd: () => ipcRenderer.send('bubble:dragEnd'),
  bubbleSize: (width, height) => ipcRenderer.send('bubble:size', { width, height }),
  on: (channel, cb) => {
    if (!EVENTS.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
