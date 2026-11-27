// ============================================================
// Violet - preload bridge
// The UI can't touch Node or your files directly (safer).
// It only gets this small `window.violet` API.
// ============================================================
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Helper: subscribe to an event from main, return an unsubscribe function.
function listen(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('violet', {
  chat: {
    send: (text, deep, withScreen, attachPage, dash) => ipcRenderer.invoke('chat:send', { text, deep, withScreen, attachPage, dash }),
    stop: () => ipcRenderer.invoke('chat:stop'),
    reset: () => ipcRenderer.invoke('chat:new'),
    onEvent: (cb) => listen('chat:event', cb)
  },
  control: {
    // Only called after the user clicks "Allow" on the permission card
    start: (text, deep) => ipcRenderer.invoke('control:start', { text, deep }),
    stop: () => ipcRenderer.invoke('control:stop')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch)
  },
  themes: {
    list: () => ipcRenderer.invoke('themes:list'),
    importDialog: () => ipcRenderer.invoke('themes:import-dialog'),
    // Dragged-in File objects -> real path on disk (Electron 32+ API)
    importFile: (file) => ipcRenderer.invoke('themes:import-path', webUtils.getPathForFile(file)),
    openFolder: () => ipcRenderer.invoke('themes:open-folder'),
    onChanged: (cb) => listen('themes:changed', cb)
  },
  browse: {
    // Violet drives its own browser
    start: (text, deep) => ipcRenderer.invoke('browse:start', { text, deep })
  },
  voice: {
    status: () => ipcRenderer.invoke('voice:status'),
    speak: (text, voiceId, speed) => ipcRenderer.invoke('voice:speak', { text, voiceId, speed }),
    transcribe: (wav, wake) => ipcRenderer.invoke('voice:transcribe', { wav, wake }),
    openFolder: (which) => ipcRenderer.invoke('voice:open-folder', which),
    wake: () => ipcRenderer.invoke('voice:wake'),
    install: () => ipcRenderer.invoke('voice:install'),
    onInstallProgress: (cb) => listen('voice:install-progress', cb),
    onHotkey: (cb) => listen('voice:hotkey', cb)
  },
  browser: {
    open: () => ipcRenderer.invoke('browser:open'),
    clearPage: () => ipcRenderer.invoke('page:clear'),
    onPageAttached: (cb) => listen('page:attached', cb)
  },
  widgets: {
    resetPositions: () => ipcRenderer.invoke('widgets:reset-positions')
  },
  reminders: {
    list: () => ipcRenderer.invoke('reminders:list'),
    add: (text, at) => ipcRenderer.invoke('reminders:add', text, at),
    remove: (id) => ipcRenderer.invoke('reminders:remove', id),
    onChanged: (cb) => listen('reminders:changed', cb),
    onAdded: (cb) => listen('reminder:added', cb),
    onDue: (cb) => listen('reminder:due', cb)
  },
  onQuickAsk: (cb) => listen('quick-ask', cb),
  updates: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    whatsNew: () => ipcRenderer.invoke('update:whats-new'),
    version: () => ipcRenderer.invoke('app:version'),
    onStatus: (cb) => listen('update:status', cb)
  },
  dashboard: {
    add: (w) => ipcRenderer.invoke('dashboard:add', w),
    list: () => ipcRenderer.invoke('dashboard:list'),
    remove: (id) => ipcRenderer.invoke('dashboard:remove', id),
    clear: () => ipcRenderer.invoke('dashboard:clear'),
    toggleItem: (id, i) => ipcRenderer.invoke('dashboard:toggle-item', id, i),
    resize: (id, size) => ipcRenderer.invoke('dashboard:resize', id, size),
    open: (url) => ipcRenderer.invoke('dashboard:open', url),
    onChanged: (cb) => listen('dashboard:changed', cb)
  },
  chats: {
    list: (q) => ipcRenderer.invoke('chats:list', q),
    current: () => ipcRenderer.invoke('chats:current'),
    open: (id) => ipcRenderer.invoke('chats:open', id),
    rename: (id, title) => ipcRenderer.invoke('chats:rename', id, title),
    exportMd: () => ipcRenderer.invoke('chats:export'),
    reveal: (file) => ipcRenderer.invoke('chats:reveal', file),
    pin: (id, pinned) => ipcRenderer.invoke('chats:pin', id, pinned),
    remove: (id) => ipcRenderer.invoke('chats:delete', id),
    onChanged: (cb) => listen('chats:changed', cb)
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (text, category) => ipcRenderer.invoke('memory:add', text, category),
    update: (id, text, category) => ipcRenderer.invoke('memory:update', id, text, category),
    remove: (id) => ipcRenderer.invoke('memory:remove', id),
    clear: () => ipcRenderer.invoke('memory:clear'),
    onChanged: (cb) => listen('memory:changed', cb)
  },
  projects: {
    info: () => ipcRenderer.invoke('projects:info'),
    open: (dir) => ipcRenderer.invoke('projects:open', dir),
    close: () => ipcRenderer.invoke('projects:close'),
    openEditor: () => ipcRenderer.invoke('ide:open'),
    onChanged: (cb) => listen('project:changed', cb)
  },
  changes: {
    action: (id, action) => ipcRenderer.invoke('change:action', id, action),
    review: (id) => ipcRenderer.invoke('change:review', id),
    statuses: (ids) => ipcRenderer.invoke('change:statuses', ids),
    onStatus: (cb) => listen('change:status', cb)
  },
  win: {
    setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
    setClassic: (on) => ipcRenderer.invoke('window:classic', on),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    fullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    onMode: (cb) => listen('window:mode', cb),
    onMaximized: (cb) => listen('window:maximized', cb),
    hide: () => ipcRenderer.invoke('window:hide'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    onVisibility: (cb) => listen('window:visibility', cb),
    onFocusInput: (cb) => listen('window:focus-input', cb),
    onCommand: (cb) => listen('command', cb)
  }
});
