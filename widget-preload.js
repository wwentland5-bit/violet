// ============================================================
// Violet widgets - preload (tiny API for widget windows)
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');
const listen = (ch, cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('vwidget', {
  init: () => ipcRenderer.invoke('widget:init'),
  saveNotes: (text) => ipcRenderer.send('widget:notes-save', text),
  refresh: () => ipcRenderer.send('widget:refresh'),
  hide: () => ipcRenderer.send('widget:hide'),
  onData: (cb) => listen('widget:data', cb),
  onTheme: (cb) => listen('widget:theme', cb),
  onOptions: (cb) => listen('widget:options', cb)
});
