// ============================================================
// Violet - built-in browser (main process side)
// One window with a custom toolbar (src/browser.html) and one
// WebContentsView per tab underneath it. Pages run sandboxed
// with no access to Violet or your files.
// "Ask Violet" grabs the current page's text and hands it to
// the chat panel.
// ============================================================
const { BrowserWindow, WebContentsView, session, Menu, clipboard, ipcMain } = require('electron');
const path = require('path');

const TOOLBAR_H = 84; // tabs row + address row, must match browser.css

const SEARCH = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  brave: 'https://search.brave.com/search?q='
};

/** Turn what you typed in the address bar into a URL. */
function toUrl(text, engine = 'duckduckgo') {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/^(https?|file|about|view-source):/i.test(t)) return t;
  if (/^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(t)) return `https://${t}`;
  return (SEARCH[engine] || SEARCH.duckduckgo) + encodeURIComponent(t);
}

class BrowserManager {
  /**
   * @param {object} o
   * @param {string} o.appDir           app folder (for html/preload/icon)
   * @param {() => object} o.getSettings
   * @param {() => object} o.getTheme   current theme object
   * @param {(page) => void} o.onAskPage  called with {title, url, text}
   */
  constructor({ appDir, getSettings, getTheme, onAskPage, onTakeOver, onGiveBack, onAgentStop }) {
    this.appDir = appDir;
    this.onTakeOver = onTakeOver || (() => {});
    this.onGiveBack = onGiveBack || (() => {});
    this.onAgentStop = onAgentStop || (() => {});
    this.agentState = { running: false, paused: false, status: '' };
    this.lockView = null;     // see-through layer that blocks clicks while Violet drives
    this.lockShown = false;
    this.getSettings = getSettings;
    this.getTheme = getTheme;
    this.onAskPage = onAskPage;
    this.win = null;
    this.tabs = [];
    this.activeId = null;
    this.nextId = 1;
    this.ses = null;
    this.setupIpc();
  }

  // ---------- Window ----------
  open(url) {
    if (!this.win || this.win.isDestroyed()) this.createWindow();
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
    if (url) this.newTab(url);
    else if (!this.tabs.length) this.newTab(this.getSettings().homePage || 'https://duckduckgo.com');
  }

  createWindow() {
    // Separate, persistent session: your browser logins survive restarts
    // and stay apart from Violet's own UI.
    this.ses = session.fromPartition('persist:violet-browser');
    this.ses.setPermissionRequestHandler((_wc, permission, cb) => {
      // Allow harmless stuff, deny camera/mic/location/etc. by default.
      cb(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission));
    });

    this.win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      frame: false,
      show: false,
      backgroundColor: '#120c1e',
      title: 'Violet Browser',
      icon: path.join(this.appDir, 'assets', 'icon.png'),
      webPreferences: {
        preload: path.join(this.appDir, 'browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.win.loadFile(path.join(this.appDir, 'src', 'browser.html'));
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('resize', () => this.layout());
    this.win.on('maximize', () => this.sendState());
    this.win.on('unmaximize', () => this.sendState());
    this.win.on('closed', () => {
      for (const t of this.tabs) { try { t.view.webContents.close(); } catch { /* already gone */ } }
      if (this.lockView) { try { this.lockView.webContents.close(); } catch { /* gone */ } }
      this.lockView = null;
      this.lockShown = false;
      this.tabs = [];
      if (this.agentState.running) this.onAgentStop();
      this.activeId = null;
      this.win = null;
    });
    // Toolbar shortcuts (when the page itself has focus they're caught in newTab)
    this.win.webContents.on('before-input-event', (e, input) => { if (this.handleShortcut(input)) e.preventDefault(); });
  }

  // ---------- Tabs ----------
  get active() { return this.tabs.find(t => t.id === this.activeId) || null; }

  newTab(url) {
    if (!this.win) return;
    const view = new WebContentsView({
      webPreferences: { session: this.ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    const tab = { id: this.nextId++, view, title: 'New tab', url: '', favicon: '', loading: true };
    this.tabs.push(tab);
    this.win.contentView.addChildView(view);
    const wc = view.webContents;

    const update = () => {
      tab.url = wc.getURL();
      tab.title = wc.getTitle() || tab.url;
      this.sendState();
    };
    wc.on('page-title-updated', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
    wc.on('page-favicon-updated', (_e, favs) => { tab.favicon = favs[0] || ''; this.sendState(); });
    wc.on('did-start-loading', () => { tab.loading = true; this.sendState(); });
    wc.on('did-stop-loading', () => { tab.loading = false; update(); });
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMain) => {
      if (isMain && code !== -3) { // -3 = aborted (normal when you navigate away)
        tab.loading = false;
        tab.title = `Couldn't load page`;
        this.sendState();
        this.send('browser:error', { id: tab.id, message: `${desc} (${failedUrl})` });
      }
    });
    // Links that open new windows -> new tab instead.
    wc.setWindowOpenHandler(({ url: u }) => {
      if (/^https?:/i.test(u)) this.newTab(u);
      return { action: 'deny' };
    });
    wc.on('before-input-event', (e, input) => { if (this.handleShortcut(input)) e.preventDefault(); });
    wc.on('context-menu', (_e, params) => this.showContextMenu(tab, params));
    wc.on('enter-html-full-screen', () => { this.fullscreen = true; this.layout(); });
    wc.on('leave-html-full-screen', () => { this.fullscreen = false; this.layout(); });

    this.raiseLock(); // keep the lock layer above the new tab while Violet drives
    const target = toUrl(url, this.getSettings().searchEngine) || 'https://duckduckgo.com';
    wc.loadURL(target).catch(() => { /* handled by did-fail-load */ });
    this.activate(tab.id);
    return tab;
  }

  activate(id) {
    if (!this.tabs.some(t => t.id === id)) return;
    this.activeId = id;
    for (const t of this.tabs) t.view.setVisible(t.id === id);
    this.layout();
    this.sendState();
  }

  closeTab(id) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i === -1) return;
    const [tab] = this.tabs.splice(i, 1);
    this.win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    if (!this.tabs.length) { this.win.close(); return; }
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else this.sendState();
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    const top = this.fullscreen ? 0 : TOOLBAR_H;
    for (const t of this.tabs) t.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
    if (this.lockView) this.lockView.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
  }

  // ---------- Agent lock ----------
  // While Violet drives, a transparent view sits over the page: you can watch,
  // but clicks land on the lock (which tells you to use "Take control").
  showLock() {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.lockView) {
      this.lockView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      this.lockView.setBackgroundColor('#00000000');
      this.lockView.webContents.loadFile(path.join(this.appDir, 'src', 'browse-lock.html'));
    }
    this.win.contentView.addChildView(this.lockView); // adding again moves it to the top
    this.lockShown = true;
    this.layout();
  }

  hideLock() {
    if (this.lockView && this.lockShown && this.win && !this.win.isDestroyed()) {
      this.win.contentView.removeChildView(this.lockView);
    }
    this.lockShown = false;
  }

  raiseLock() {
    if (this.lockShown) this.showLock();
  }

  /** Called by the browser agent: {running, paused, status} */
  setAgentState(state) {
    this.agentState = { ...this.agentState, ...state };
    if (this.agentState.running && !this.agentState.paused) this.showLock();
    else this.hideLock();
    this.send('browser:agent', this.agentState);
  }

  // ---------- Navigation ----------
  navigate(text) {
    const tab = this.active;
    const url = toUrl(text, this.getSettings().searchEngine);
    if (!tab || !url) return;
    tab.view.webContents.loadURL(url).catch(() => {});
    tab.view.webContents.focus();
  }

  history(wc) {
    // navigationHistory is the newer API; fall back for older Electron.
    const h = wc.navigationHistory;
    return {
      canBack: h ? h.canGoBack() : wc.canGoBack(),
      canFwd: h ? h.canGoForward() : wc.canGoForward(),
      back: () => (h ? h.goBack() : wc.goBack()),
      fwd: () => (h ? h.goForward() : wc.goForward())
    };
  }

  // ---------- Keyboard shortcuts ----------
  handleShortcut(input) {
    if (input.type !== 'keyDown') return false;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    const tab = this.active;
    if (ctrl && key === 't') { this.newTab(this.getSettings().homePage); this.send('browser:focus-address'); return true; }
    if (ctrl && key === 'w') { if (tab) this.closeTab(tab.id); return true; }
    if (ctrl && key === 'l') { this.win.webContents.focus(); this.send('browser:focus-address'); return true; }
    if ((ctrl && key === 'r') || key === 'f5') { if (tab) tab.view.webContents.reload(); return true; }
    if (ctrl && key === 'tab') {
      const i = this.tabs.findIndex(t => t.id === this.activeId);
      const next = this.tabs[(i + (input.shift ? -1 : 1) + this.tabs.length) % this.tabs.length];
      if (next) this.activate(next.id);
      return true;
    }
    if (input.alt && key === 'arrowleft' && tab) { const h = this.history(tab.view.webContents); if (h.canBack) h.back(); return true; }
    if (input.alt && key === 'arrowright' && tab) { const h = this.history(tab.view.webContents); if (h.canFwd) h.fwd(); return true; }
    if (key === 'f12' && tab) { tab.view.webContents.toggleDevTools(); return true; }
    return false;
  }

  showContextMenu(tab, p) {
    const wc = tab.view.webContents;
    const h = this.history(wc);
    const items = [];
    if (p.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => this.newTab(p.linkURL) });
      items.push({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.selectionText) {
      items.push({ label: 'Copy', role: 'copy' });
      items.push({ label: `Ask Violet about "${p.selectionText.slice(0, 25)}${p.selectionText.length > 25 ? '…' : ''}"`, click: () => this.askPage(p.selectionText) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ label: 'Cut', role: 'cut' }, { label: 'Copy', role: 'copy' }, { label: 'Paste', role: 'paste' }, { type: 'separator' });
    }
    items.push(
      { label: 'Back', enabled: h.canBack, click: h.back },
      { label: 'Forward', enabled: h.canFwd, click: h.fwd },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Ask Violet about this page', click: () => this.askPage() },
      { label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) }
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // ---------- Ask Violet ----------
  async askPage(selection) {
    const tab = this.active;
    if (!tab) return;
    const wc = tab.view.webContents;
    let text = selection || '';
    if (!text) {
      try {
        // innerText = what you can actually see, without scripts/styles
        text = await wc.executeJavaScript('document.body ? document.body.innerText : ""', true);
      } catch {
        text = '';
      }
    }
    text = String(text).replace(/\n{3,}/g, '\n\n').trim().slice(0, 15000);
    this.onAskPage({ title: wc.getTitle(), url: wc.getURL(), text, isSelection: !!selection });
  }

  // ---------- Toolbar <-> main ----------
  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  sendState() {
    const tab = this.active;
    const h = tab ? this.history(tab.view.webContents) : { canBack: false, canFwd: false };
    this.send('browser:state', {
      tabs: this.tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon, loading: t.loading })),
      activeId: this.activeId,
      canBack: h.canBack,
      canFwd: h.canFwd,
      maximized: this.win ? this.win.isMaximized() : false
    });
  }

  sendTheme() {
    this.send('browser:theme', this.getTheme());
  }

  setupIpc() {
    // Only accept these from the browser toolbar window.
    const fromToolbar = (e) => this.win && e.sender === this.win.webContents;
    const on = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (fromToolbar(e)) fn(...args); });

    ipcMain.handle('browser:init', (e) => (fromToolbar(e) ? { theme: this.getTheme() } : null));
    on('browser:ready', () => { this.sendState(); this.sendTheme(); this.send('browser:agent', this.agentState); });
    on('browser:takeover', () => this.onTakeOver());
    on('browser:giveback', () => this.onGiveBack());
    on('browser:agent-stop', () => this.onAgentStop());
    on('browser:new-tab', () => { this.newTab(this.getSettings().homePage); this.send('browser:focus-address'); });
    on('browser:close-tab', (id) => this.closeTab(id));
    on('browser:activate', (id) => this.activate(id));
    on('browser:navigate', (text) => this.navigate(text));
    on('browser:back', () => { const t = this.active; if (t) { const h = this.history(t.view.webContents); if (h.canBack) h.back(); } });
    on('browser:forward', () => { const t = this.active; if (t) { const h = this.history(t.view.webContents); if (h.canFwd) h.fwd(); } });
    on('browser:reload', () => { const t = this.active; if (t) (t.loading ? t.view.webContents.stop() : t.view.webContents.reload()); });
    on('browser:home', () => this.navigate(this.getSettings().homePage || 'https://duckduckgo.com'));
    on('browser:ask', () => this.askPage());
    on('browser:minimize', () => this.win.minimize());
    on('browser:maximize', () => (this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize()));
    on('browser:close', () => this.win.close());
  }
}

module.exports = { BrowserManager, toUrl, TOOLBAR_H };
