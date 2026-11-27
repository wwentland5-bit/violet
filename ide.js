// ============================================================
// Violet - code editor window (main process side)
// A small IDE for your project folder using Monaco, the editor
// that powers VS Code: file tree, tabs, save, side-by-side review
// of Violet's proposed changes, and "Ask Violet" on a selection.
// ============================================================
const { BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

class IdeManager {
  /**
   * @param {object} o
   * @param {string} o.appDir
   * @param {Projects} o.projects
   * @param {() => object} o.getTheme
   * @param {(snippet) => void} o.onAsk         send code to the chat
   * @param {(id, action) => object} o.onChangeAction  apply/reject from the review tab
   * @param {(dir) => void} o.onOpenFolder
   */
  constructor({ appDir, projects, getTheme, onAsk, onChangeAction, onOpenFolder }) {
    this.appDir = appDir;
    this.projects = projects;
    this.getTheme = getTheme;
    this.onAsk = onAsk;
    this.onChangeAction = onChangeAction;
    this.onOpenFolder = onOpenFolder;
    this.win = null;
    this.queue = [];      // messages to send once the editor has loaded
    this.ready = false;
    this.setupIpc();
  }

  open() {
    if (this.win && !this.win.isDestroyed()) {
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      return;
    }
    this.ready = false;
    this.win = new BrowserWindow({
      width: 1280, height: 820, minWidth: 700, minHeight: 450,
      frame: false,
      backgroundColor: '#100b1c',
      title: 'Violet Code',
      icon: path.join(this.appDir, 'assets', 'icon.png'),
      show: false,
      webPreferences: {
        preload: path.join(this.appDir, 'ide-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    this.win.loadFile(path.join(this.appDir, 'src', 'ide.html'));
    this.win.once('ready-to-show', () => this.win.show());
    this.win.on('closed', () => { this.win = null; this.ready = false; });
  }

  send(channel, payload) {
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.ready) { this.queue.push([channel, payload]); return; }
    this.win.webContents.send(channel, payload);
  }

  /** Open the side-by-side review of a proposed change. */
  review(changeId) {
    this.open();
    try { this.send('ide:review', this.projects.reviewData(changeId)); } catch (err) { this.send('ide:toast', err.message); }
  }

  /** A file changed on disk (Apply/Undo): let the editor reload it. */
  fileChanged(root, relPath) {
    if (root === this.projects.root) this.send('ide:file-changed', relPath);
  }

  projectChanged() { this.send('ide:project', this.projects.info()); }
  sendTheme() { this.send('ide:theme', this.getTheme()); }

  setupIpc() {
    const ok = (e) => this.win && e.sender === this.win.webContents;
    const handle = (ch, fn) => ipcMain.handle(ch, async (e, ...a) => {
      if (!ok(e)) return { ok: false, error: 'Not allowed' };
      try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message }; }
    });

    handle('ide:init', () => {
      this.ready = true;
      setTimeout(() => { for (const [c, p] of this.queue.splice(0)) this.win.webContents.send(c, p); }, 50);
      return { project: this.projects.info(), theme: this.getTheme() };
    });
    handle('ide:list', (rel) => this.projects.listDir(rel || ''));
    handle('ide:read', (rel) => this.projects.readFile(rel));
    handle('ide:save', (rel, content) => this.projects.writeFile(rel, content));
    handle('ide:open-folder', async () => {
      const res = await dialog.showOpenDialog(this.win, { title: 'Open a project folder', properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths[0]) return null;
      this.onOpenFolder(res.filePaths[0]);
      return this.projects.info();
    });
    handle('ide:ask', (snippet) => this.onAsk(snippet));
    handle('ide:change', (id, action) => this.onChangeAction(id, action));
    handle('ide:window', (action) => {
      if (action === 'min') this.win.minimize();
      if (action === 'max') this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize();
      if (action === 'close') this.win.close();
    });
  }
}

module.exports = { IdeManager };
