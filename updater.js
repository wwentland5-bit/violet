// ============================================================
// Violet - automatic updates
// How it works:
//   1. A new version is published as a GitHub Release on your repo
//      (GitHub builds it for you; see .github/workflows/release.yml).
//   2. Violet checks for it a minute after starting and every 4 hours.
//   3. It downloads in the background, then installs itself:
//      - when Violet is hidden and not busy (if "install automatically" is on), or
//      - when you click "Restart & update", or
//      - the next time you quit Violet.
//   4. After the update, Violet shows "What's new".
// Updates only run in the installed app (not when started with npm start).
// ============================================================
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 60 * 1000;
const IDLE_CHECK_MS = 60 * 1000;

/** "wyatt" -> {owner:"wyatt", repo:"violet"}; "wyatt/my-violet" -> both; URLs work too */
function parseRepo(text) {
  let t = String(text || '').trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (!t) return null;
  const [owner, repo] = t.split('/');
  const ok = (s) => /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(s || '');
  if (!ok(owner)) return null;
  const r = repo || 'violet';
  return ok(r) ? { owner, repo: r } : null;
}

function notesToText(notes) {
  if (!notes) return '';
  if (Array.isArray(notes)) return notes.map(n => (n && n.note) || '').join('\n\n');
  // GitHub gives HTML; keep it readable as plain text / markdown
  return String(notes)
    .replace(/<\/(p|li|h\d)>/gi, '\n').replace(/<li>/gi, '- ').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** GitHub's build writes update-source.json into the app, so updates work with zero setup. */
function bakedRepo(app) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'update-source.json'), 'utf8'));
    return d.owner && d.repo ? `${d.owner}/${d.repo}` : '';
  } catch { return ''; }
}

class Updater {
  /**
   * @param {object} o
   * @param {Electron.App} o.app
   * @param {() => object} o.getSettings
   * @param {() => void} o.saveSettings
   * @param {(channel, payload) => void} o.send
   * @param {() => boolean} o.isBusy       true while Violet is answering/controlling
   * @param {() => boolean} o.isVisible    true while Violet's window is on screen
   * @param {() => void} o.beforeInstall   lets main.js allow the app to quit
   */
  constructor({ app, getSettings, saveSettings, send, isBusy, isVisible, beforeInstall }) {
    this.app = app;
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.send = send;
    this.isBusy = isBusy;
    this.isVisible = isVisible;
    this.beforeInstall = beforeInstall;
    this.state = { state: 'idle', current: app.getVersion() };
    this.timer = null;
    this.idleTimer = null;
    this.wired = false;
  }

  setState(patch) {
    this.state = { ...this.state, ...patch, current: this.app.getVersion() };
    this.send('update:status', this.state);
  }

  status() { return this.state; }

  /** Call once at startup and whenever the repo setting changes. */
  configure() {
    const s = this.getSettings();
    clearInterval(this.timer);
    if (!this.app.isPackaged) {
      this.setState({ state: 'dev', message: 'Updates work in the installed app (not npm start).' });
      return;
    }
    const repo = this.repo();
    if (!repo) {
      this.setState({ state: 'not-set-up', message: 'Add your GitHub username in Settings → Updates to turn on updates.' });
      return;
    }
    if (s.autoUpdate === false) {
      this.setState({ state: 'off', message: 'Automatic updates are off.' });
      return;
    }
    this.wire();
    autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo, releaseType: 'release' });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    this.setState({ state: 'idle', repo: `${repo.owner}/${repo.repo}`, message: '' });
    setTimeout(() => this.check(false), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(false), CHECK_EVERY_MS);
  }

  wire() {
    if (this.wired) return;
    this.wired = true;
    autoUpdater.on('checking-for-update', () => this.setState({ state: 'checking', message: 'Checking for updates…' }));
    autoUpdater.on('update-not-available', () => this.setState({ state: 'up-to-date', message: 'Violet is up to date.', lastChecked: Date.now() }));
    autoUpdater.on('update-available', (info) => this.setState({
      state: 'downloading', version: info.version, percent: 0, notes: notesToText(info.releaseNotes),
      message: `Downloading version ${info.version}…`, lastChecked: Date.now()
    }));
    autoUpdater.on('download-progress', (p) => this.setState({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      const s = this.getSettings();
      // Remember the notes so we can show "What's new" after the restart
      s.pendingUpdateNotes = { version: info.version, notes: notesToText(info.releaseNotes) };
      this.saveSettings();
      this.setState({ state: 'ready', version: info.version, percent: 100, message: `Version ${info.version} is ready to install.` });
      this.startIdleWatch();
    });
    autoUpdater.on('error', (err) => {
      const msg = String((err && err.message) || err);
      // A repo with no releases yet isn't really an error
      const friendly = /404|no published versions|Cannot find latest|HttpError: 404/i.test(msg)
        ? 'No updates published yet (or the repo name is wrong).'
        : `Update check failed: ${msg.split('\n')[0].slice(0, 160)}`;
      this.setState({ state: 'error', message: friendly, lastChecked: Date.now() });
    });
  }

  /** Your typed setting wins; otherwise the repo GitHub baked in at build time. */
  repo() { return parseRepo(this.getSettings().updateRepo) || parseRepo(bakedRepo(this.app)); }

  async check(manual = true) {
    if (!this.app.isPackaged || !this.repo()) { this.configure(); return this.state; }
    if (['downloading', 'ready'].includes(this.state.state)) return this.state;
    try { await autoUpdater.checkForUpdates(); }
    catch (err) { if (manual) this.setState({ state: 'error', message: `Update check failed: ${err.message}` }); }
    return this.state;
  }

  /** Install quietly once Violet is hidden and idle (so it never interrupts you). */
  startIdleWatch() {
    clearInterval(this.idleTimer);
    if (this.getSettings().autoInstallUpdates === false) return;
    this.idleTimer = setInterval(() => {
      if (this.state.state !== 'ready') { clearInterval(this.idleTimer); return; }
      if (!this.isBusy() && !this.isVisible()) this.install(true);
    }, IDLE_CHECK_MS);
  }

  /** Quit, run the installer silently, and start the new version. */
  install(quietRestart = false) {
    if (this.state.state !== 'ready') return false;
    const s = this.getSettings();
    s.restartHidden = !!quietRestart; // after an automatic update, come back hidden in the tray
    this.saveSettings();
    clearInterval(this.idleTimer);
    this.beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }
}

module.exports = { Updater, parseRepo, notesToText };
