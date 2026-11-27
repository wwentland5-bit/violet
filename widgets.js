// ============================================================
// Violet - desktop widgets (main process side)
// Each widget is its own small, frameless, see-through window,
// so you can drag them anywhere. Positions are saved.
// Data (CPU, weather, servers) is gathered here and pushed to
// the widget windows; the widgets themselves are just UI.
// ============================================================
const { BrowserWindow, screen, ipcMain, net } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');

const WIDGETS = {
  clock: { name: 'Clock', width: 260, height: 128 },
  system: { name: 'System', width: 260, height: 176 },
  weather: { name: 'Weather', width: 260, height: 176 },
  notes: { name: 'Notes', width: 260, height: 230 },
  servers: { name: 'Servers', width: 260, height: 210 }
};

const WEATHER_CODES = [
  [[0], 'Clear', '☀️'], [[1], 'Mostly clear', '🌤️'], [[2], 'Partly cloudy', '⛅'], [[3], 'Overcast', '☁️'],
  [[45, 48], 'Fog', '🌫️'], [[51, 53, 55, 56, 57], 'Drizzle', '🌦️'], [[61, 63, 65, 66, 67], 'Rain', '🌧️'],
  [[71, 73, 75, 77], 'Snow', '🌨️'], [[80, 81, 82], 'Showers', '🌦️'], [[85, 86], 'Snow showers', '🌨️'],
  [[95, 96, 99], 'Thunderstorm', '⛈️']
];
function describeWeather(code) {
  const hit = WEATHER_CODES.find(([codes]) => codes.includes(code));
  return hit ? { desc: hit[1], icon: hit[2] } : { desc: 'Unknown', icon: '🌡️' };
}

/** fetch with a timeout, using Electron's network stack (respects system proxy). */
async function fetchWithTimeout(url, ms = 8000, method = 'GET') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await net.fetch(url, { method, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/** "Plex | http://192.168.1.20:32400" or just a URL, one per line. */
function parseServers(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 8).map(line => {
    const [a, b] = line.includes('|') ? line.split('|').map(s => s.trim()) : [null, line];
    let url = b;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    let name = a;
    if (!name) { try { name = new URL(url).host; } catch { name = url; } }
    return { name, url };
  });
}

class WidgetManager {
  constructor({ appDir, userDir, getSettings, saveSettings, getTheme }) {
    this.appDir = appDir;
    this.notesFile = path.join(userDir, 'notes.txt');
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.getTheme = getTheme;
    this.windows = {};          // type -> BrowserWindow
    this.cache = {};            // type -> last data sent
    this.timers = {};
    this.prevCpu = null;
    this.geo = null;            // cached weather location
    this.setupIpc();
  }

  // ---------- Open / close based on settings ----------
  sync() {
    const s = this.getSettings();
    for (const type of Object.keys(WIDGETS)) {
      const on = !!(s.widgets && s.widgets[type] && s.widgets[type].enabled);
      if (on && !this.windows[type]) this.open(type);
      if (!on && this.windows[type]) this.windows[type].close();
    }
    this.applyOptions();
    this.updateTimers();
  }

  applyOptions() {
    const s = this.getSettings();
    for (const [type, w] of Object.entries(this.windows)) {
      w.setAlwaysOnTop(!!s.widgetsOnTop);
      this.send(type, 'widget:options', { locked: !!s.widgetsLocked, clock24h: !!s.clock24h });
    }
  }

  defaultPosition(type) {
    const a = screen.getPrimaryDisplay().workArea;
    const order = Object.keys(WIDGETS);
    let y = a.y + 20;
    for (const t of order) {
      if (t === type) break;
      y += WIDGETS[t].height + 12;
    }
    // Wrap to a second column if it would go off the bottom
    let x = a.x + a.width - WIDGETS[type].width - 20;
    if (y + WIDGETS[type].height > a.y + a.height) { x -= WIDGETS[type].width + 12; y = a.y + 20; }
    return { x, y };
  }

  savedPosition(type) {
    const p = (this.getSettings().widgetPositions || {})[type];
    if (!p) return null;
    const ok = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return p.x >= a.x - 20 && p.y >= a.y - 20 && p.x + 60 <= a.x + a.width && p.y + 40 <= a.y + a.height;
    });
    return ok ? p : null;
  }

  open(type) {
    const def = WIDGETS[type];
    const pos = this.savedPosition(type) || this.defaultPosition(type);
    const w = new BrowserWindow({
      x: pos.x, y: pos.y, width: def.width, height: def.height,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      alwaysOnTop: !!this.getSettings().widgetsOnTop,
      backgroundColor: '#00000000',
      title: `Violet ${def.name}`,
      webPreferences: {
        preload: path.join(this.appDir, 'widget-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    w.loadFile(path.join(this.appDir, 'src', 'widget.html'), { query: { type } });
    w.once('ready-to-show', () => w.showInactive());
    w.on('moved', () => {
      const [x, y] = w.getPosition();
      const s = this.getSettings();
      s.widgetPositions = { ...(s.widgetPositions || {}), [type]: { x, y } };
      this.saveSettings();
    });
    w.on('closed', () => { delete this.windows[type]; this.updateTimers(); });
    this.windows[type] = w;
  }

  closeAll() {
    for (const w of Object.values(this.windows)) w.close();
  }

  resetPositions() {
    this.getSettings().widgetPositions = {};
    this.saveSettings();
    for (const [type, w] of Object.entries(this.windows)) {
      const p = this.defaultPosition(type);
      w.setPosition(p.x, p.y);
    }
  }

  send(type, channel, payload) {
    const w = this.windows[type];
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }

  broadcastTheme() {
    const theme = this.getTheme();
    for (const type of Object.keys(this.windows)) this.send(type, 'widget:theme', theme);
  }

  // ---------- Data refresh timers (only run for open widgets) ----------
  updateTimers() {
    const want = {
      system: this.windows.system ? 2000 : 0,
      weather: this.windows.weather ? 15 * 60 * 1000 : 0,
      servers: this.windows.servers ? 60 * 1000 : 0
    };
    for (const [type, ms] of Object.entries(want)) {
      if (ms && !this.timers[type]) {
        this.refresh(type);
        this.timers[type] = setInterval(() => this.refresh(type), ms);
      } else if (!ms && this.timers[type]) {
        clearInterval(this.timers[type]);
        delete this.timers[type];
      }
    }
  }

  async refresh(type) {
    try {
      let data = null;
      if (type === 'system') data = this.readSystem();
      if (type === 'weather') data = await this.readWeather();
      if (type === 'servers') data = await this.readServers();
      if (data) { this.cache[type] = data; this.send(type, 'widget:data', data); }
    } catch (err) {
      const data = { ok: false, error: err.message };
      this.cache[type] = data;
      this.send(type, 'widget:data', data);
    }
  }

  readSystem() {
    // CPU % = share of non-idle time since the last reading
    const cpus = os.cpus();
    const totals = cpus.reduce((acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    }, { idle: 0, total: 0 });
    let cpu = 0;
    if (this.prevCpu) {
      const dIdle = totals.idle - this.prevCpu.idle;
      const dTotal = totals.total - this.prevCpu.total;
      cpu = dTotal > 0 ? Math.round(100 * (1 - dIdle / dTotal)) : 0;
    }
    this.prevCpu = totals;
    const total = os.totalmem();
    const used = total - os.freemem();
    return {
      ok: true,
      cpu,
      cpuName: (cpus[0] && cpus[0].model || '').replace(/\s+/g, ' ').trim(),
      cores: cpus.length,
      memUsed: used / 1024 ** 3,
      memTotal: total / 1024 ** 3,
      memPct: Math.round((used / total) * 100),
      uptime: os.uptime()
    };
  }

  async readWeather() {
    const s = this.getSettings();
    const city = String(s.weatherCity || '').trim();
    if (!city) return { ok: false, error: 'Set your city in Violet → Settings → Widgets.' };

    // Free Open-Meteo APIs: no account or API key needed.
    if (!this.geo || this.geo.query !== city) {
      const g = await fetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`);
      const gj = await g.json();
      const hit = gj.results && gj.results[0];
      if (!hit) return { ok: false, error: `Couldn't find "${city}". Try just the city name.` };
      this.geo = { query: city, lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.admin1].filter(Boolean).join(', ') };
    }
    const f = s.weatherUnits !== 'c';
    const url = 'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${this.geo.lat}&longitude=${this.geo.lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m' +
      '&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto' +
      (f ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '');
    const r = await fetchWithTimeout(url);
    const j = await r.json();
    const c = j.current || {};
    const { desc, icon } = describeWeather(c.weather_code);
    return {
      ok: true,
      place: this.geo.name,
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      unit: f ? '°F' : '°C',
      desc, icon,
      high: Math.round(j.daily.temperature_2m_max[0]),
      low: Math.round(j.daily.temperature_2m_min[0]),
      wind: Math.round(c.wind_speed_10m),
      windUnit: f ? 'mph' : 'km/h',
      humidity: c.relative_humidity_2m
    };
  }

  async readServers() {
    const list = parseServers(this.getSettings().servers);
    if (!list.length) return { ok: false, error: 'Add servers in Violet → Settings → Widgets.' };
    const items = await Promise.all(list.map(async (srv) => {
      const t0 = Date.now();
      try {
        const res = await fetchWithTimeout(srv.url, 5000);
        // Any answer below 500 means the server is up (401/403 login pages count as up).
        return { ...srv, up: res.status < 500, status: res.status, ms: Date.now() - t0 };
      } catch {
        return { ...srv, up: false, status: 0, ms: null };
      }
    }));
    return { ok: true, items, checked: Date.now() };
  }

  // ---------- IPC from widget windows ----------
  typeOf(sender) {
    return Object.keys(this.windows).find(t => this.windows[t].webContents === sender) || null;
  }

  setupIpc() {
    ipcMain.handle('widget:init', (e) => {
      const type = this.typeOf(e.sender);
      if (!type) return null;
      const s = this.getSettings();
      let notes = '';
      if (type === 'notes') { try { notes = fs.readFileSync(this.notesFile, 'utf8'); } catch { notes = ''; } }
      return {
        type,
        theme: this.getTheme(),
        options: { locked: !!s.widgetsLocked, clock24h: !!s.clock24h },
        data: this.cache[type] || null,
        notes
      };
    });
    ipcMain.on('widget:notes-save', (e, text) => {
      if (this.typeOf(e.sender) !== 'notes' || typeof text !== 'string') return;
      try { fs.writeFileSync(this.notesFile, text.slice(0, 100000), 'utf8'); } catch (err) { console.error(err); }
    });
    ipcMain.on('widget:refresh', (e) => {
      const type = this.typeOf(e.sender);
      if (type === 'weather') this.geo = null;
      if (type) this.refresh(type);
    });
    // Dragging: the widget tells us where the pointer is on screen and we move
    // the window by the same amount. (CSS "app-region: drag" is unreliable on
    // transparent windows in Windows, so widgets couldn't always be moved.)
    const drags = new Map(); // type -> { px, py, wx, wy }
    ipcMain.on('widget:drag-start', (e, x, y) => {
      const type = this.typeOf(e.sender);
      if (!type || this.getSettings().widgetsLocked || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const [wx, wy] = this.windows[type].getPosition();
      drags.set(type, { px: x, py: y, wx, wy });
    });
    ipcMain.on('widget:drag-move', (e, x, y) => {
      const type = this.typeOf(e.sender);
      const d = type && drags.get(type);
      if (!d || !Number.isFinite(x) || !Number.isFinite(y)) return;
      this.windows[type].setPosition(Math.round(d.wx + x - d.px), Math.round(d.wy + y - d.py));
    });
    ipcMain.on('widget:drag-end', (e) => {
      const type = this.typeOf(e.sender);
      if (!type || !drags.delete(type)) return;
      const [x, y] = this.windows[type].getPosition();
      const s = this.getSettings();
      s.widgetPositions = { ...(s.widgetPositions || {}), [type]: { x, y } };
      this.saveSettings();
    });
    ipcMain.on('widget:hide', (e) => {
      const type = this.typeOf(e.sender);
      if (!type) return;
      const s = this.getSettings();
      s.widgets = { ...s.widgets, [type]: { ...(s.widgets[type] || {}), enabled: false } };
      this.saveSettings();
      this.windows[type].close();
    });
  }
}

module.exports = { WidgetManager, WIDGETS, parseServers, describeWeather };
