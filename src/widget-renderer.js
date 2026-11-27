// ============================================================
// Violet widgets - UI. One file, one renderer per widget type.
// ============================================================
const $ = (id) => document.getElementById(id);
const body = $('body');
const LABELS = { clock: 'Clock', system: 'System', weather: 'Weather', notes: 'Notes', servers: 'Servers' };
let type = null;
let options = { locked: false, clock24h: false };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const errorView = (msg) => { body.innerHTML = ''; body.append(el('div', 'err', msg)); };

// ---------- Clock (runs locally, no data from main) ----------
function startClock() {
  const time = el('div', 'clock-time');
  const date = el('div', 'clock-date');
  body.append(time, date);
  const tick = () => {
    const d = new Date();
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    time.innerHTML = '';
    if (options.clock24h) {
      time.append(`${String(h).padStart(2, '0')}:${m}`, el('span', 'sec', s));
    } else {
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      time.append(`${h}:${m}`, el('span', 'ampm', ampm));
    }
    date.textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- System ----------
function meter(label, pct, right) {
  const m = el('div', 'meter');
  const top = el('div', 'meter-top');
  top.append(el('span', '', label), el('b', '', right));
  const bar = el('div', 'bar');
  const fill = el('i', pct >= 85 ? 'hot' : '');
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bar.append(fill);
  m.append(top, bar);
  return m;
}
function formatUptime(sec) {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
function renderSystem(d) {
  if (!d) { errorView('Reading…'); return; }
  if (!d.ok) { errorView(d.error); return; }
  body.innerHTML = '';
  body.append(
    meter('CPU', d.cpu, `${d.cpu}%`),
    meter('Memory', d.memPct, `${d.memUsed.toFixed(1)} / ${d.memTotal.toFixed(0)} GB`),
    el('div', 'sys-foot', `Up ${formatUptime(d.uptime)} · ${d.cores} threads · ${d.cpuName}`)
  );
}

// ---------- Weather ----------
function renderWeather(d) {
  if (!d) { errorView('Loading weather…'); return; }
  if (!d.ok) { errorView(d.error); return; }
  body.innerHTML = '';
  const main = el('div', 'wx-main');
  const temp = el('div', 'wx-temp', String(d.temp));
  temp.append(el('small', '', d.unit));
  main.append(el('div', 'wx-icon', d.icon), temp);
  const meta = el('div', 'wx-meta');
  meta.append(el('span', '', `H ${d.high}° L ${d.low}°`), el('span', '', `Feels ${d.feels}°`), el('span', '', `💨 ${d.wind} ${d.windUnit}`), el('span', '', `💧 ${d.humidity}%`));
  body.append(main, el('div', 'wx-desc', d.desc), meta, el('div', 'wx-place', d.place));
}

// ---------- Notes ----------
function startNotes(text) {
  const ta = el('textarea', 'notes');
  ta.placeholder = 'Jot something down…';
  ta.value = text || '';
  let t;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => window.vwidget.saveNotes(ta.value), 400); // autosave
  });
  body.append(ta);
}

// ---------- Servers ----------
function renderServers(d) {
  if (!d) { errorView('Checking…'); return; }
  if (!d.ok) { errorView(d.error); return; }
  body.innerHTML = '';
  const list = el('div', 'srv-list');
  for (const s of d.items) {
    const row = el('div', 'srv');
    row.title = `${s.url} - ${s.up ? `HTTP ${s.status}` : 'not responding'}`;
    row.append(el('span', 'dot' + (s.up ? ' up' : '')), el('span', 'name', s.name), el('span', 'ms', s.up ? `${s.ms} ms` : 'down'));
    list.append(row);
  }
  const up = d.items.filter(s => s.up).length;
  body.append(list, el('div', 'srv-foot', `${up}/${d.items.length} up · checked ${new Date(d.checked).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`));
}

const RENDER = { system: renderSystem, weather: renderWeather, servers: renderServers };

// ---------- Drag the widget window ----------
// Pointer capture keeps the moves coming even when the pointer leaves the
// small window during a fast drag. Buttons and text fields keep working.
(function setupDrag() {
  const box = $('widget');
  let dragging = false;
  box.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || options.locked || e.target.closest('button, textarea, input, select, a')) return;
    dragging = true;
    box.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
    window.vwidget.dragStart(e.screenX, e.screenY);
  });
  box.addEventListener('pointermove', (e) => { if (dragging) window.vwidget.dragMove(e.screenX, e.screenY); });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    box.classList.remove('dragging');
    window.vwidget.dragEnd();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('lostpointercapture', end);
})();

function applyOptions(o) {
  options = { ...options, ...o };
  $('widget').classList.toggle('locked', !!options.locked);
}

async function init() {
  const d = await window.vwidget.init();
  if (!d) return;
  type = d.type;
  $('label').textContent = LABELS[type] || type;
  window.applyThemeColors(d.theme);
  applyOptions(d.options);
  $('btn-refresh').hidden = !['weather', 'servers'].includes(type);

  if (type === 'clock') startClock();
  else if (type === 'notes') startNotes(d.notes);
  else RENDER[type](d.data);

  window.vwidget.onData((data) => { if (RENDER[type]) RENDER[type](data); });
  window.vwidget.onTheme((t) => window.applyThemeColors(t));
  window.vwidget.onOptions((o) => applyOptions(o));
}

$('btn-hide').addEventListener('click', () => window.vwidget.hide());
$('btn-refresh').addEventListener('click', () => window.vwidget.refresh());
init();
