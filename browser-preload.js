// ============================================================
// Violet Browser - toolbar preload
// The toolbar (tabs + address bar) gets only these functions.
// Web pages themselves get NO preload at all.
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, cb) => {
  const h = (_e, d) => cb(d);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('vbrowser', {
  init: () => ipcRenderer.invoke('browser:init'),
  ready: () => ipcRenderer.send('browser:ready'),
  newTab: () => ipcRenderer.send('browser:new-tab'),
  closeTab: (id) => ipcRenderer.send('browser:close-tab', id),
  activate: (id) => ipcRenderer.send('browser:activate', id),
  navigate: (text) => ipcRenderer.send('browser:navigate', text),
  back: () => ipcRenderer.send('browser:back'),
  forward: () => ipcRenderer.send('browser:forward'),
  reload: () => ipcRenderer.send('browser:reload'),
  home: () => ipcRenderer.send('browser:home'),
  ask: () => ipcRenderer.send('browser:ask'),
  minimize: () => ipcRenderer.send('browser:minimize'),
  maximize: () => ipcRenderer.send('browser:maximize'),
  close: () => ipcRenderer.send('browser:close'),
  takeOver: () => ipcRenderer.send('browser:takeover'),
  giveBack: () => ipcRenderer.send('browser:giveback'),
  stopAgent: () => ipcRenderer.send('browser:agent-stop'),
  onAgent: (cb) => listen('browser:agent', cb),
  onState: (cb) => listen('browser:state', cb),
  onTheme: (cb) => listen('browser:theme', cb),
  onFocusAddress: (cb) => listen('browser:focus-address', cb),
  onError: (cb) => listen('browser:error', cb)
});
