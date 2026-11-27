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
  // Moving the widget window (screen coordinates, from the pointer)
  dragStart: (x, y) => ipcRenderer.send('widget:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('widget:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('widget:drag-end'),
  onData: (cb) => listen('widget:data', cb),
  onTheme: (cb) => listen('widget:theme', cb),
  onOptions: (cb) => listen('widget:options', cb)
});
