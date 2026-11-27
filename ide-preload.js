// ============================================================
// Violet Code (editor window) - preload
// Every call goes through main, which keeps all file access
// inside your open project folder.
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');
const listen = (ch, cb) => { const h = (_e, d) => cb(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };
const call = async (ch, ...args) => {
  const res = await ipcRenderer.invoke(ch, ...args);
  if (!res || !res.ok) throw new Error((res && res.error) || 'Failed');
  return res.data;
};

contextBridge.exposeInMainWorld('vide', {
  init: () => call('ide:init'),
  list: (rel) => call('ide:list', rel),
  read: (rel) => call('ide:read', rel),
  save: (rel, content) => call('ide:save', rel, content),
  openFolder: () => call('ide:open-folder'),
  ask: (snippet) => call('ide:ask', snippet),
  change: (id, action) => call('ide:change', id, action),
  win: (action) => call('ide:window', action),
  onReview: (cb) => listen('ide:review', cb),
  onFileChanged: (cb) => listen('ide:file-changed', cb),
  onProject: (cb) => listen('ide:project', cb),
  onTheme: (cb) => listen('ide:theme', cb),
  onToast: (cb) => listen('ide:toast', cb)
});
