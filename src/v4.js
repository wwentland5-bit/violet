// ============================================================
// Violet v4 UI
// - Command palette (Ctrl+K): every feature, chat, theme and style
// - Slash commands in the chat box (/theme, /remind, /timer, …)
// - Classic UI toggle (Ctrl+Shift+U): the original see-through panel
// - Reminders, Quick Ask from any app, chat export, daily briefing
// Loaded last; shares globals with renderer.js, v2.js and v3.js.
// ============================================================

// ---------- Small helpers ----------
function fuzzy(q, text) {
  q = q.toLowerCase().trim();
  const t = String(text).toLowerCase();
  if (!q) return 1;
  const at = t.indexOf(q);
  if (at !== -1) return 200 - at; // plain substring match wins
  let i = 0, score = 0, streak = 0;
  for (const ch of t) {
    if (ch === q[i]) { i++; streak++; score += 1 + streak; } else streak = 0;
    if (i === q.length) return score;
  }
  return 0;
}

function inWords(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'in under a minute';
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return `in ${h}h${r ? ` ${r}m` : ''}`;
  return new Date(Date.now() + ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function clockTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// Parse "/remind 20m stretch" or "/remind 5pm call mom" (same rules as reminders.js)
function parseDurationUi(s) {
  const m = String(s).trim().toLowerCase().match(/^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?|s)?)?)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000;
}
function parseClockUi(s) {
  const t = String(s).trim().toLowerCase();
  if (t === 'noon') return parseClockUi('12:00');
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
function parseRemind(arg) {
  const parts = String(arg || '').trim().split(/\s+/);
  for (const n of [2, 1]) {
    if (parts.length <= n) continue;
    const when = parts.slice(0, n).join(' ');
    const dur = parseDurationUi(when);
    const at = dur !== null ? Date.now() + dur : parseClockUi(when);
    if (at) return { at, text: parts.slice(n).join(' ') };
  }
  return null;
}

// ============================================================
// Actions shared by the palette and slash commands
// ============================================================
async function toggleClassic() {
  const res = await window.violet.win.setClassic(!settings.classicUi);
  if (res && !res.ok) toast(res.error);
  // The window rebuilds itself, so nothing else to do here
}

function prefill(text) {
  showView('chat');
  inputEl.value = text;
  autoGrow();
  inputEl.focus();
  inputEl.setSelectionRange(text.length, text.length);
  updateSlashMenu();
}

async function exportChat() {
  const res = await window.violet.chats.exportMd();
  if (res.ok) toast(`Saved to ${res.file}`, 4000);
  else if (!res.canceled) toast(res.error || 'Export failed');
}

function briefing() {
  if (dashView.hidden) openDashboard();
  const city = settings.weatherCity;
  const prompt = `Give me my briefing for right now: today's date, ${city ? `the weather in ${city}` : 'the weather (ask for my city if you don\'t know it)'}, ` +
    'the top 3 tech headlines, and my upcoming reminders. Keep it short and natural to listen to. ' +
    'Add widgets: a note with the headlines, and an article widget for the most interesting story.';
  window.sendMessage(prompt, { voice: true });
}

async function applyThemeById(id) {
  const t = themes.find(x => x.id === id);
  if (!t) return false;
  await saveSettings({ theme: t.id });
  applyTheme(t);
  renderThemeGrid();
  toast(`Theme: ${t.name}`);
  return true;
}

async function applyStyleByName(name) {
  const q = name.toLowerCase();
  const p = settings.prompts.find(x => x.name.toLowerCase() === q) || settings.prompts.find(x => x.name.toLowerCase().includes(q));
  if (!p) return false;
  await saveSettings({ activePrompt: p.id });
  renderPresetSelect();
  toast(`Style: ${p.name}`);
  return true;
}

// ============================================================
// COMMAND PALETTE (Ctrl+K)
// ============================================================
const palette = $('palette');
const palQ = $('pal-q');
const palList = $('pal-list');
let palItems = [];
let palIndex = 0;
let palChatTimer = null;
let palChats = [];
let palReminders = [];

const SHORTCUTS = [
  ['Show / hide Violet', () => settings.hotkey], ['Talk to Violet', () => settings.voiceHotkey], ['Quick Ask (selected text, any app)', () => settings.quickAskHotkey],
  ['Command palette', 'Ctrl+K'], ['New chat', 'Ctrl+N'], ['Voice dashboard', 'Ctrl+D'], ['Memory tree', 'Ctrl+Shift+M'],
  ['Classic UI', 'Ctrl+Shift+U'], ['Full window / panel', 'F11'], ['Chats sidebar', 'Ctrl+H'], ['Browser', 'Ctrl+B'], ['Code editor', 'Ctrl+E'],
  ['Settings', 'Ctrl+,'], ['Stop talking / listening, hide', 'Esc'], ['Talk (on the dashboard)', 'Space']
];

function baseActions() {
  const full = bodyEl.classList.contains('full');
  return [
    { label: 'New chat', key: 'Ctrl+N', icon: '＋', run: () => newChat() },
    { label: 'Voice dashboard', key: 'Ctrl+D', icon: '▦', run: openDashboard },
    { label: 'Daily briefing', icon: '☀', run: briefing },
    { label: 'Talk to Violet', key: settings.voiceHotkey, icon: '🎙', run: () => { if (!window.dashActive) showView('chat'); toggleListening(); } },
    { label: 'Memory tree', key: 'Ctrl+Shift+M', icon: '🧠', run: openMemory },
    { label: settings.classicUi ? 'Exit Classic UI' : 'Classic UI (see-through panel)', key: 'Ctrl+Shift+U', icon: '◐', run: toggleClassic },
    { label: full ? 'Shrink to corner panel' : 'Full window', key: 'F11', icon: '⤢', run: toggleMode },
    { label: 'Set a reminder…', icon: '⏰', run: () => prefill('/remind ') },
    { label: 'Start a timer…', icon: '⏱', run: () => prefill('/timer ') },
    { label: 'Open Violet\'s browser', key: 'Ctrl+B', icon: '🌐', run: () => window.violet.browser.open() },
    { label: 'Open code editor', key: 'Ctrl+E', icon: '</>', run: () => window.violet.projects.openEditor() },
    { label: 'Open a project folder…', icon: '📁', run: () => openProject() },
    { label: deep ? 'Turn off Deepthink' : 'Turn on Deepthink', icon: '💡', run: () => deepBtn.click() },
    { label: 'Browse mode (Violet uses its browser)', icon: '🧭', run: () => { showView('chat'); if (!browse) browseBtn.click(); } },
    { label: 'Control mode (mouse & keyboard)', icon: '🖱', run: () => { showView('chat'); if (!control) controlBtn.click(); } },
    { label: 'Look at my screen', icon: '👁', run: () => { showView('chat'); if (!look) lookBtn.click(); } },
    { label: 'Export this chat to Markdown', icon: '⬇', run: exportChat },
    { label: 'Settings', key: 'Ctrl+,', icon: '⚙', run: openSettings },
    { label: 'Keyboard shortcuts', key: '?', icon: '⌨', keep: true, run: () => { palQ.value = '?'; renderPalette(); } },
    { label: 'Hide Violet', key: 'Esc', icon: '—', run: () => window.violet.win.hide() }
  ].map(a => ({ ...a, group: 'Actions' }));
}

async function openPalette(prefillText = '') {
  palette.hidden = false;
  palQ.value = prefillText;
  palIndex = 0;
  palChats = await window.violet.chats.list('');
  palReminders = await window.violet.reminders.list();
  renderPalette();
  palQ.focus();
}

function closePalette() {
  palette.hidden = true;
  if (!chatView.hidden) inputEl.focus();
}

function buildPaletteItems() {
  const q = palQ.value;
  // "?" = shortcut cheat sheet
  if (q.trim().startsWith('?')) {
    const qq = q.trim().slice(1);
    return SHORTCUTS.map(([label, key]) => ({ group: 'Keyboard shortcuts', label, key: typeof key === 'function' ? key() : key, icon: '⌨', keep: true, run: () => {} }))
      .filter(i => fuzzy(qq, i.label + ' ' + i.key));
  }
  const items = [];
  const add = (list) => {
    for (const it of list) {
      const score = fuzzy(q, `${it.label} ${it.hint || ''}`);
      if (score) items.push({ ...it, score });
    }
  };
  add(baseActions());
  add(themes.map(t => ({ group: 'Themes', label: `Theme: ${t.name}`, icon: t.id === settings.theme ? '●' : '○', hint: t.author || '', run: () => applyThemeById(t.id) })));
  add(settings.prompts.map(p => ({ group: 'Talking style', label: `Style: ${p.name}`, icon: p.id === settings.activePrompt ? '●' : '○', run: () => applyStyleByName(p.name) })));
  add(palReminders.map(r => ({ group: 'Reminders (Enter deletes)', label: `${r.text}`, hint: `${clockTime(r.at)} · ${inWords(r.at - Date.now())}`, icon: '⏰', run: async () => { await window.violet.reminders.remove(r.id); toast('Reminder deleted'); } })));
  add(palChats.slice(0, q ? 40 : 5).map(c => ({ group: q ? 'Chats' : 'Recent chats', label: c.title, hint: timeAgo(c.updated), icon: '💬', run: () => openChat(c.id) })));
  // Best matches first, but keep groups together
  if (q.trim()) {
    const groupBest = {};
    for (const it of items) groupBest[it.group] = Math.max(groupBest[it.group] || 0, it.score);
    items.sort((a, b) => (groupBest[b.group] - groupBest[a.group]) || (b.score - a.score));
  }
  return items.slice(0, 60);
}

function renderPalette() {
  palItems = buildPaletteItems();
  palIndex = Math.min(palIndex, Math.max(0, palItems.length - 1));
  palList.innerHTML = '';
  if (!palItems.length) {
    palList.append(h('div', 'pal-empty', `No matches. Press Enter to ask Violet: "${palQ.value.trim()}"`));
    return;
  }
  let lastGroup = null;
  palItems.forEach((it, i) => {
    if (it.group !== lastGroup) { palList.append(h('div', 'pal-group', it.group)); lastGroup = it.group; }
    const row = h('div', 'pal-item' + (i === palIndex ? ' sel' : ''));
    row.append(h('span', 'pal-icon', it.icon || '•'), h('span', 'pal-label', it.label));
    if (it.hint) row.append(h('span', 'pal-hint', it.hint));
    if (it.key) row.append(h('kbd', '', it.key));
    row.addEventListener('mousemove', () => { if (palIndex !== i) { palIndex = i; markPalSel(); } });
    row.addEventListener('click', () => runPalItem(i));
    palList.append(row);
  });
  markPalSel();
}

function markPalSel() {
  palList.querySelectorAll('.pal-item').forEach((el, i) => el.classList.toggle('sel', i === palIndex));
  const sel = palList.querySelectorAll('.pal-item')[palIndex];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

async function runPalItem(i) {
  const it = palItems[i];
  if (!it) {
    // No match: treat what you typed as a question for Violet
    const q = palQ.value.trim();
    closePalette();
    if (q) { showView('chat'); window.sendMessage(q); }
    return;
  }
  if (!it.keep) closePalette();
  await it.run();
}

function setupPalette() {
  palQ.addEventListener('input', () => {
    palIndex = 0;
    renderPalette();
    // Search inside chat messages too (debounced)
    clearTimeout(palChatTimer);
    palChatTimer = setTimeout(async () => {
      if (palette.hidden) return;
      palChats = await window.violet.chats.list(palQ.value.trim().startsWith('?') ? '' : palQ.value.trim());
      renderPalette();
    }, 220);
  });
  palQ.addEventListener('keydown', (e) => {
    e.stopPropagation(); // don't trigger the app's global shortcuts while typing here
    if (e.key === 'ArrowDown') { e.preventDefault(); palIndex = Math.min(palItems.length - 1, palIndex + 1); markPalSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palIndex = Math.max(0, palIndex - 1); markPalSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalItem(palIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); closePalette(); }
  });
  palette.addEventListener('mousedown', (e) => { if (e.target === palette) closePalette(); });
  $('btn-palette').addEventListener('click', () => openPalette());
}

// ============================================================
// SLASH COMMANDS in the chat box
// ============================================================
const SLASH = [
  { cmd: '/new', desc: 'Start a new chat', run: () => newChat() },
  { cmd: '/theme', arg: 'name', desc: 'Switch theme (e.g. /theme nebula)', run: async (a) => {
    const q = a.toLowerCase();
    const t = themes.find(x => x.name.toLowerCase() === q || x.id === q) || themes.find(x => x.name.toLowerCase().includes(q));
    if (!t) { toast(`No theme like "${a}". Themes: ${themes.map(x => x.name).join(', ')}`, 4500); return; }
    applyThemeById(t.id);
  } },
  { cmd: '/style', arg: 'name', desc: 'Switch talking style (e.g. /style coder)', run: async (a) => { if (!(await applyStyleByName(a))) toast(`No style like "${a}"`); } },
  { cmd: '/remember', arg: 'fact', desc: 'Save a memory', run: async (a) => {
    if (!a) { toast('Usage: /remember I use VS Code'); return; }
    const item = await window.violet.memory.add(a, null);
    toast(item ? `🧠 Remembered: ${a}` : 'Already remembered.');
    loadMemory();
  } },
  { cmd: '/remind', arg: '20m stretch · 5pm call mom', desc: 'Set a reminder', run: async (a) => {
    const r = parseRemind(a);
    if (!r || !r.text) { toast('Try: /remind 20m stretch  ·  /remind 5:30pm call mom', 4000); return; }
    const res = await window.violet.reminders.add(r.text, r.at);
    if (!res.ok) { toast(res.error); return; }
    toast(`⏰ ${r.text}, ${clockTime(r.at)} (${inWords(r.at - Date.now())})`, 3500);
  } },
  { cmd: '/timer', arg: 'minutes [label]', desc: 'Start a timer on the dashboard', run: async (a) => {
    const m = a.match(/^(\d+(?:\.\d+)?)\s*(?:m|min|minutes?)?\s*(.*)$/i);
    if (!m) { toast('Try: /timer 10 pizza'); return; }
    const res = await window.violet.dashboard.add({ type: 'timer', title: m[2] || `${m[1]} min timer`, minutes: Number(m[1]), size: 'small' });
    if (!res.ok) { toast(res.error); return; }
    toast(`⏱ Timer started: ${m[1]} min`);
  } },
  { cmd: '/dash', desc: 'Open the voice dashboard', run: openDashboard },
  { cmd: '/briefing', desc: 'Daily briefing on the dashboard', run: briefing },
  { cmd: '/memory', desc: 'Open the memory tree', run: openMemory },
  { cmd: '/classic', desc: 'Toggle the classic see-through UI', run: toggleClassic },
  { cmd: '/full', desc: 'Full window', run: () => window.violet.win.setMode('full') },
  { cmd: '/panel', desc: 'Corner panel', run: () => window.violet.win.setMode('panel') },
  { cmd: '/deep', desc: 'Toggle Deepthink', run: () => deepBtn.click() },
  { cmd: '/browse', arg: 'task', desc: 'Do a web task in Violet\'s browser', run: (a) => {
    if (!a) { if (!browse) browseBtn.click(); return; }
    if (!browse) browseBtn.click();
    sendFromSlash(a);
  } },
  { cmd: '/export', desc: 'Export this chat to Markdown', run: exportChat },
  { cmd: '/help', desc: 'Show every command and shortcut', run: () => openPalette('?') }
];

let slashIndex = 0;
let slashMatches = [];
const slashMenu = $('slash-menu');
let sendFromSlash = null;

function updateSlashMenu() {
  const v = inputEl.value;
  const m = v.match(/^\/(\S*)$/); // still typing the command name
  if (!m) { slashMenu.hidden = true; slashMatches = []; return; }
  slashMatches = SLASH.filter(c => c.cmd.slice(1).startsWith(m[1].toLowerCase()) || fuzzy(m[1], c.cmd.slice(1)) > 0)
    .sort((a, b) => fuzzy(m[1], b.cmd) - fuzzy(m[1], a.cmd)).slice(0, 8);
  slashIndex = Math.min(slashIndex, Math.max(0, slashMatches.length - 1));
  slashMenu.innerHTML = '';
  if (!slashMatches.length) { slashMenu.hidden = true; return; }
  slashMatches.forEach((c, i) => {
    const row = h('div', 'slash-item' + (i === slashIndex ? ' sel' : ''));
    row.append(h('b', '', c.cmd), h('span', 'slash-arg', c.arg ? c.arg : ''), h('span', 'slash-desc', c.desc));
    row.addEventListener('mousedown', (e) => { e.preventDefault(); completeSlash(i); });
    slashMenu.append(row);
  });
  slashMenu.hidden = false;
}

function completeSlash(i) {
  const c = slashMatches[i];
  if (!c) return;
  if (c.arg) {
    inputEl.value = `${c.cmd} `;
    updateSlashMenu();
    inputEl.focus();
  } else {
    inputEl.value = '';
    autoGrow();
    slashMenu.hidden = true;
    c.run('');
  }
}

/** Returns true if the text was a slash command (and handled). */
async function runSlash(text) {
  const m = text.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!m) return false;
  const c = SLASH.find(x => x.cmd === `/${m[1].toLowerCase()}`) || (m[1] === 'clear' ? SLASH[0] : null);
  if (!c) { toast(`Unknown command /${m[1]}. Type /help to see them all.`, 3500); return true; }
  await c.run(m[2].trim());
  return true;
}

function setupSlash() {
  // Wrap the send function so "/commands" run here instead of going to Claude
  const sendBase = window.sendMessage;
  sendFromSlash = (t) => sendBase(t);
  window.sendMessage = async function (text, opts = {}) {
    const t = (text || '').trim();
    if (t.startsWith('/') && !opts.voice) {
      inputEl.value = '';
      autoGrow();
      slashMenu.hidden = true;
      await runSlash(t);
      return;
    }
    return sendBase(text, opts);
  };

  inputEl.addEventListener('input', () => { slashIndex = 0; updateSlashMenu(); });
  inputEl.addEventListener('blur', () => setTimeout(() => { slashMenu.hidden = true; }, 120));
  // Capture phase on the composer: runs BEFORE renderer.js's Enter-to-send
  composer.addEventListener('keydown', (e) => {
    if (slashMenu.hidden || e.target !== inputEl) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); slashIndex = (slashIndex + 1) % slashMatches.length; updateSlashMenu(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); slashIndex = (slashIndex - 1 + slashMatches.length) % slashMatches.length; updateSlashMenu(); }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); completeSlash(slashIndex); }
    else if (e.key === 'Enter' && !e.shiftKey) {
      const typed = inputEl.value.trim().toLowerCase();
      const sel = slashMatches[slashIndex];
      if (sel && typed !== sel.cmd) { e.preventDefault(); e.stopPropagation(); completeSlash(slashIndex); }
      // exact command: let Enter through so it runs via sendMessage
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slashMenu.hidden = true; }
  }, true);
}

// ============================================================
// Reminders UI
// ============================================================
function renderDashReminders(list) {
  const box = $('dash-reminders');
  box.innerHTML = '';
  for (const r of (list || []).slice(0, 6)) {
    const chip = h('div', 'rem-chip');
    chip.append(h('span', '', `⏰ ${r.text}`), h('span', 'rem-when', `${clockTime(r.at)} · ${inWords(r.at - Date.now())}`));
    const x = h('button', '', '×');
    x.title = 'Delete reminder';
    x.addEventListener('click', () => window.violet.reminders.remove(r.id));
    chip.append(x);
    box.append(chip);
  }
}

function setupReminders() {
  window.violet.reminders.onChanged(renderDashReminders);
  window.violet.reminders.onAdded((list) => {
    for (const r of list) toast(`⏰ Reminder set: ${r.text}, ${clockTime(r.at)}`, 3500);
  });
  window.violet.reminders.onDue((r) => {
    VV.chime();
    setTimeout(() => VV.chime(), 450);
    toast(`⏰ ${r.late ? 'Missed reminder' : 'Reminder'}: ${r.text}`, 8000);
    if (!speaker.speaking && settings.speakMode !== 'off') speaker.speak(`Reminder: ${r.text}`, settings).catch(() => {});
  });
  window.violet.reminders.list().then(renderDashReminders);
  setInterval(() => { if (window.dashActive) window.violet.reminders.list().then(renderDashReminders); }, 30000);
}

// ============================================================
// Classic UI + settings + wiring
// ============================================================
function setupV4() {
  bodyEl.classList.toggle('classic', !!settings.classicUi);
  setupPalette();
  setupSlash();
  setupReminders();

  // Settings: Classic toggle + Quick Ask hotkey
  const openSettingsV3 = window.openSettings;
  window.openSettings = function () {
    openSettingsV3();
    $('set-classic').checked = !!settings.classicUi;
    $('set-quickhotkey').value = settings.quickAskHotkey;
  };
  $('set-classic').addEventListener('change', toggleClassic);
  setupHotkeyRecorder('set-quickhotkey', 'quickAskHotkey', 'quickAskHotkeyOk');

  $('dash-briefing').addEventListener('click', briefing);

  window.violet.onQuickAsk((d) => {
    if (d.empty) toast(`Select some text in any app first, then press ${settings.quickAskHotkey}.`, 4000);
  });

  // Global keys (capture phase so they work from anywhere in the window)
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.ctrlKey && !e.shiftKey && k === 'k') { e.preventDefault(); e.stopPropagation(); palette.hidden ? openPalette() : closePalette(); }
    else if (e.ctrlKey && e.shiftKey && k === 'u') { e.preventDefault(); e.stopPropagation(); toggleClassic(); }
    else if (e.key === 'Escape' && !palette.hidden) { e.preventDefault(); e.stopPropagation(); closePalette(); }
  }, true);
}

// ---------- Startup (all versions, in order) ----------
initV2().then(() => {
  setupV3();
  loadWidgets();
  setupV4();
  if (window.setupV5) window.setupV5(); // v5.js: updates
});
