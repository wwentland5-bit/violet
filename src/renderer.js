// ============================================================
// Violet - UI logic (renderer)
// Talks to main only through window.violet (see preload.js).
// ============================================================
const $ = (id) => document.getElementById(id);

const appEl = $('app');
const bgEl = $('bg');
const videoEl = $('bg-video');
const themeCssEl = $('theme-css');
const messagesEl = $('messages');
const emptyEl = $('empty');
const inputEl = $('input');
const sendBtn = $('btn-send');
const deepBtn = $('btn-deep');
const statusEl = $('status');
const statusText = $('status-text');
const presetSelect = $('preset-select');
const chatView = $('chat-view');
const settingsView = $('settings-view');
const composer = $('composer');

let settings = null;
let themes = [];
let busy = false;
let deep = false;
let current = null;        // the assistant message being streamed
let renderQueued = false;
let selectedPromptId = null;

// Phase 2: Look + Control
const lookBtn = $('btn-look');
const controlBtn = $('btn-control');
const modeBanner = $('mode-banner');
let look = false;          // attach a screenshot to the next message (one-shot)
let control = false;       // control mode (stays on until you turn it off)
let browse = false;        // browse mode: Violet drives its own browser
const browseBtn = $('btn-browse');
let visionOk = false;      // you allowed screenshots for this chat
let controlOk = false;     // you allowed control for this chat (when "ask every task" is off)
let waitingForPermission = false;

// Phase 3: page sent from Violet's browser
let pageAttached = false;
function setPageChip(info) {
  pageAttached = !!info;
  $('page-chip').hidden = !info;
  if (info) {
    $('page-chip-title').textContent = (info.isSelection ? 'Selection from: ' : '') + (info.title || info.url);
    $('page-chip').title = info.url;
  }
}

// ============================================================
// Small helpers
// ============================================================
function toast(text, ms = 2200) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function nearBottom() {
  return chatView.scrollHeight - chatView.scrollTop - chatView.clientHeight < 80;
}
function scrollToBottom() {
  chatView.scrollTop = chatView.scrollHeight;
}

async function saveSettings(patch) {
  const res = await window.violet.settings.set(patch);
  if (res && res.settings) settings = res.settings;
  return res;
}

// ============================================================
// Themes
// Theme JSON keys -> CSS variables. Anything missing falls back
// to the defaults in styles.css.
// ============================================================
const VAR_MAP = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  text: '--text',
  muted: '--muted',
  accent: '--accent',
  accent2: '--accent-2',
  border: '--border',
  userBubble: '--user-bubble',
  userText: '--user-text',
  assistantBubble: '--assistant-bubble',
  codeBg: '--code-bg',
  glow: '--glow'
};

function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  root.removeAttribute('style'); // clear the previous theme's variables

  for (const [key, value] of Object.entries(theme.colors || {})) {
    if (VAR_MAP[key] && typeof value === 'string') root.style.setProperty(VAR_MAP[key], value);
  }
  if (typeof theme.font === 'string') root.style.setProperty('--font', theme.font);
  if (typeof theme.radius === 'number') root.style.setProperty('--radius', `${theme.radius}px`);

  // ----- Background -----
  const bg = theme.background || { type: 'solid' };
  const colors = Array.isArray(bg.colors) ? bg.colors.filter(c => typeof c === 'string') : [];
  bgEl.className = 'bg';
  bgEl.removeAttribute('style');
  videoEl.pause();
  videoEl.removeAttribute('src');
  videoEl.load();
  if (typeof bg.speed === 'number') root.style.setProperty('--bg-speed', `${bg.speed}s`);
  const gradient = colors.length >= 2 ? `linear-gradient(${Number(bg.angle) || 135}deg, ${colors.join(', ')})` : null;

  switch (bg.type) {
    case 'gradient':
      if (gradient) bgEl.style.background = gradient;
      break;
    case 'animated-gradient':
      if (gradient) { bgEl.style.background = gradient; bgEl.classList.add('bg-animated'); }
      break;
    case 'aurora':
      bgEl.classList.add('bg-aurora');
      colors.slice(0, 3).forEach((c, i) => root.style.setProperty(`--blob${i + 1}`, c));
      if (typeof bg.base === 'string') bgEl.style.background = bg.base;
      break;
    case 'image':
      if (bg.url) { bgEl.style.backgroundImage = `url("${bg.url}")`; bgEl.classList.add('bg-image'); }
      break;
    case 'video':
      if (bg.url) {
        bgEl.classList.add('bg-video');
        videoEl.src = bg.url;
        if (!appEl.classList.contains('paused')) videoEl.play().catch(() => {});
      }
      break;
    default:
      break; // solid: just uses --bg
  }

  // Optional extra CSS for advanced themes
  themeCssEl.textContent = typeof theme.css === 'string' ? theme.css : '';
}

function swatchFor(theme) {
  const bg = theme.background || {};
  const colors = Array.isArray(bg.colors) ? bg.colors : [];
  if (colors.length >= 2) return `linear-gradient(135deg, ${colors.join(', ')})`;
  const c = theme.colors || {};
  return `linear-gradient(135deg, ${c.accent || '#a78bfa'}, ${c.accent2 || '#f0abfc'})`;
}

function renderThemeGrid() {
  const grid = $('theme-grid');
  grid.innerHTML = '';
  for (const theme of themes) {
    const card = document.createElement('button');
    card.className = 'theme-card' + (theme.id === settings.theme ? ' active' : '');
    const animated = ['animated-gradient', 'aurora', 'video'].includes(theme.background && theme.background.type);
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = swatchFor(theme);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = theme.name;
    const author = document.createElement('div');
    author.className = 'author';
    author.textContent = theme.author ? `by ${theme.author}` : 'Custom theme';
    meta.append(name, author);
    card.append(swatch, meta);
    if (animated) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Animated';
      card.append(badge);
    }
    card.addEventListener('click', async () => {
      await saveSettings({ theme: theme.id });
      applyTheme(theme);
      renderThemeGrid();
    });
    grid.append(card);
  }
}

async function loadThemes() {
  themes = await window.violet.themes.list();
  let active = themes.find(t => t.id === settings.theme);
  if (!active && themes.length) {
    active = themes[0];
    await saveSettings({ theme: active.id });
  }
  applyTheme(active);
  renderThemeGrid();
}

async function handleImportResult(res) {
  if (!res || res.canceled) return;
  if (!res.ok) { toast(res.error || 'Import failed.', 3500); return; }
  await saveSettings({ theme: res.id });
  await loadThemes();
  toast('Theme imported');
}

// ============================================================
// Chat
// ============================================================
function setBusy(value) {
  busy = value;
  appEl.classList.toggle('busy', value);
  sendBtn.title = value ? 'Stop' : 'Send (Enter)';
  if (!value) statusEl.hidden = true;
}

function showStatus(text) {
  statusText.textContent = text;
  statusEl.hidden = false;
}

function addUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  messagesEl.append(el);
}

function addAssistantMessage(isDeep, kind = '') {
  const el = document.createElement('div');
  el.className = 'msg assistant streaming' +
    (kind === 'control' ? ' control-msg' : kind === 'browse' ? ' browse-msg' : isDeep ? ' deep' : '');
  const steplog = document.createElement('div');
  steplog.className = 'steplog';
  const content = document.createElement('div');
  content.className = 'content';
  el.append(steplog, content);
  messagesEl.append(el);
  return { el, content, steplog, raw: '' };
}

// One entry in the control log: "Step 2 · thought" + the actions it took.
function addStep(ev) {
  if (!current) return;
  const step = document.createElement('div');
  step.className = 'step';
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = `Step ${ev.step}`;
  const thought = document.createElement('span');
  thought.textContent = ev.thought || '';
  step.append(num, thought);
  if (ev.actions && ev.actions.length) {
    const ul = document.createElement('ul');
    for (const a of ev.actions) {
      const li = document.createElement('li');
      li.textContent = a;
      ul.append(li);
    }
    step.append(ul);
  }
  current.steplog.append(step);
}

// ------------------------------------------------------------
// Permission cards. Nothing touches your screen until you click Allow.
// Resolves true (allowed) or false (denied).
// ------------------------------------------------------------
const ICON_EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_CURSOR = '<svg viewBox="0 0 24 24"><path d="M4 3l7 17 2.5-7.5L21 10z"/></svg>';

function askPermission({ kind, task }) {
  return new Promise((resolve) => {
    waitingForPermission = true;
    emptyEl.hidden = true;
    const card = document.createElement('div');
    card.className = 'perm-card' + (kind === 'control' ? ' control' : '');

    const h = document.createElement('h4');
    h.innerHTML = kind === 'control' ? ICON_CURSOR : ICON_EYE; // static icons only
    h.append(kind === 'control' ? 'Let Violet control your PC?' : 'Let Violet see your screen?');

    const p1 = document.createElement('p');
    if (kind === 'control') {
      p1.textContent = 'Violet will take screenshots and use your mouse and keyboard to do this:';
    } else {
      p1.textContent = 'Violet will take one screenshot of your main monitor and send it to Claude with your message.';
    }
    card.append(h, p1);

    if (task) {
      const t = document.createElement('p');
      t.className = 'task';
      t.textContent = `"${task.length > 160 ? task.slice(0, 160) + '…' : task}"`;
      card.append(t);
    }
    if (kind === 'control') {
      const p2 = document.createElement('p');
      p2.textContent = 'A glowing border shows while it\'s in control. Press Esc anytime to stop. It will ask before buying, sending, or deleting anything.';
      card.append(p2);
    }

    const row = document.createElement('div');
    row.className = 'row-buttons';
    const allow = document.createElement('button');
    allow.className = 'btn';
    allow.textContent = kind === 'control' ? 'Allow' : 'Allow for this chat';
    const deny = document.createElement('button');
    deny.className = 'btn ghost';
    deny.textContent = 'Not now';
    row.append(allow, deny);
    card.append(row);
    messagesEl.append(card);
    scrollToBottom();
    allow.focus();

    const answer = (ok) => {
      waitingForPermission = false;
      card.classList.add('answered');
      const a = document.createElement('div');
      a.className = 'answer';
      a.textContent = ok ? 'Allowed' : 'Not allowed';
      card.append(a);
      resolve(ok);
    };
    allow.addEventListener('click', () => answer(true));
    deny.addEventListener('click', () => answer(false));
  });
}

function updateModeUi() {
  lookBtn.classList.toggle('on', look);
  controlBtn.classList.toggle('on', control);
  controlBtn.classList.toggle('control-on', control);
  browseBtn.classList.toggle('on', browse);
  browseBtn.classList.toggle('browse-on', browse);
  if (browse) {
    modeBanner.innerHTML = '<b>Browse:</b> Violet does it in its own browser. You can take over anytime.';
    inputEl.placeholder = 'e.g. Find the cheapest RTX 4070 on Newegg';
  } else if (control) {
    modeBanner.innerHTML = '<b>Control mode:</b> tell Violet what to do on your PC.';
    inputEl.placeholder = 'e.g. Open Spotify and play my liked songs';
  } else if (look) {
    modeBanner.innerHTML = '<b>Look:</b> a screenshot will be attached to your next message.';
    inputEl.placeholder = 'Ask about what\'s on your screen…';
  } else {
    inputEl.placeholder = 'Ask Violet…';
  }
  modeBanner.hidden = !control && !look && !browse;
}

// What you see: hide memory tags, and show file-change blocks as short notes
// (the full change appears as a card with Apply/Reject under the message).
function displayText(raw) {
  let t = String(raw || '')
    .replace(/<remember\b[^>]*>[\s\S]*?<\/remember>/gi, '')
    .replace(/<forget>\s*m\d+\s*<\/forget>/gi, '')
    .replace(/<violet_widget>[\s\S]*?<\/violet_widget>/gi, '')
    .replace(/<(remember|forget|violet_widget)\b[\s\S]*$/i, '');
  t = t.replace(/<violet_file\s+path="([^"]+)"(?:\s+action="(\w+)")?\s*>[\s\S]*?<\/violet_file>/gi,
    (_, p, a) => `\n\n> ${a === 'delete' ? '🗑️' : '📝'} **${p}**: ${a === 'delete' ? 'delete' : 'change'} ready below\n\n`);
  // A block that's still streaming in
  t = t.replace(/<violet_file\s+path="([^"]+)"[^>]*>[\s\S]*$/i, (_, p) => `\n\n> ✍️ Writing **${p}**…\n`);
  t = t.replace(/<violet_file[^>]*$/i, '').replace(/<\/?(r(e(m(e(m(b(e(r)?)?)?)?)?)?)?|f(o(r(g(e(t)?)?)?)?)?|v(i(o(l(e(t(_(f(i(l(e)?)?)?)?)?)?)?)?)?)?)?$/i, '');
  return t.trimEnd();
}

// Re-render markdown at most once per frame while streaming (smooth + cheap).
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!current) return;
    const stick = nearBottom();
    current.content.innerHTML = window.renderMarkdown(displayText(current.raw));
    if (stick) scrollToBottom();
  });
}

function finishMessage(stopped, { speak = true } = {}) {
  if (!current) return;
  const msg = current;
  current = null;
  const hasSteps = msg.steplog && msg.steplog.children.length;
  if (!msg.raw.trim() && !hasSteps) msg.raw = stopped ? '*Stopped.*' : '*No response.*';
  else if (stopped) msg.raw += '\n\n*Stopped.*';
  msg.content.innerHTML = window.renderMarkdown(displayText(msg.raw));
  msg.el.classList.remove('streaming');
  if (speak) maybeSpeak({ raw: displayText(msg.raw) });

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copy = document.createElement('button');
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(displayText(msg.raw));
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
  });
  actions.append(copy);
  msg.el.append(actions);
}

async function sendMessage(text, opts = {}) {
  text = (text || '').trim();
  if (!text || busy || waitingForPermission) return;
  lastInputVoice = !!opts.voice; // decides whether the reply is read aloud ("when I talk")
  speaker.stop();

  emptyEl.hidden = true;
  addUserMessage(text);
  inputEl.value = '';
  autoGrow();
  scrollToBottom();

  // ----- Browse mode: Violet drives its own browser (no screen access needed) -----
  if (browse) {
    current = addAssistantMessage(deep, 'browse');
    setBusy(true);
    showStatus('Opening Violet\'s browser…');
    const res = await window.violet.browse.start(text, deep);
    if (!res.ok) {
      current.raw = res.error || 'Could not start browsing.';
      current.el.classList.add('error');
      finishMessage(false);
      setBusy(false);
    } else {
      showStatus('Browsing… (open the browser to watch or take control)');
    }
    return;
  }

  // ----- Control mode: ask first, then hand off to the agent -----
  if (control) {
    const needsAsk = settings.askEveryControl || !controlOk;
    if (needsAsk) {
      const ok = await askPermission({ kind: 'control', task: text });
      if (!ok) return;
      controlOk = true;
    }
    current = addAssistantMessage(deep, 'control');
    setBusy(true);
    showStatus('Taking control…');
    const res = await window.violet.control.start(text, deep);
    if (!res.ok) {
      current.raw = res.error || 'Could not start control mode.';
      current.el.classList.add('error');
      finishMessage(false);
      setBusy(false);
    }
    return;
  }

  // ----- Normal chat, optionally with a screenshot (Look) -----
  let withScreen = false;
  if (look) {
    if (!visionOk) {
      const ok = await askPermission({ kind: 'look' });
      if (ok) visionOk = true;
    }
    withScreen = visionOk;
    look = false; // Look is one-shot
    updateModeUi();
  }

  current = addAssistantMessage(deep);
  setBusy(true);
  showStatus(withScreen ? 'Looking at your screen…' : deep ? 'Thinking deeply…' : 'Thinking…');
  scrollToBottom();

  const attachPage = pageAttached;
  if (attachPage) { setPageChip(null); updateModeUi(); } // the page goes with this message only
  const res = await window.violet.chat.send(text, deep, withScreen, attachPage, !!window.dashActive);
  if (!res.ok) {
    current.raw = res.error || 'Could not send.';
    current.el.classList.add('error');
    finishMessage(false);
    setBusy(false);
  }
}

window.violet.chat.onEvent((ev) => {
  if (!current && ev.type !== 'done') return;
  switch (ev.type) {
    case 'delta':
      statusEl.hidden = true;
      current.raw += ev.text;
      scheduleRender();
      break;
    case 'status':
      showStatus(ev.text);
      break;
    case 'step':
      addStep(ev);
      scheduleRender();
      break;
    case 'changes':
      if (window.renderChanges) window.renderChanges(current.el, ev.changes);
      break;
    case 'ask':
      // Violet paused to ask you something. Reply with Control still on to continue.
      break;
    case 'error':
      current.el.classList.add('error');
      current.raw += (current.raw ? '\n\n' : '') + ev.text;
      scheduleRender();
      break;
    case 'done':
      finishMessage(!!ev.stopped);
      setBusy(false);
      break;
  }
});

async function newChat() {
  await window.violet.chat.reset();
  current = null;
  setBusy(false);
  visionOk = false;   // permissions reset with every new chat
  controlOk = false;
  waitingForPermission = false;
  if (pageAttached) { window.violet.browser.clearPage(); setPageChip(null); updateModeUi(); }
  messagesEl.querySelectorAll('.msg, .perm-card').forEach(m => m.remove());
  if (window.onNewChat) window.onNewChat();
  emptyEl.hidden = false;
  closeSettings();
  inputEl.focus();
}

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 140) + 'px';
}

// ============================================================
// Custom prompts (presets)
// ============================================================
function renderPresetSelect() {
  presetSelect.innerHTML = '';
  for (const p of settings.prompts) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.append(opt);
  }
  presetSelect.value = settings.activePrompt;
}

function renderPromptList() {
  const list = $('prompt-list');
  list.innerHTML = '';
  for (const p of settings.prompts) {
    const item = document.createElement('div');
    item.className = 'prompt-item' + (p.id === selectedPromptId ? ' selected' : '');
    const name = document.createElement('span');
    name.textContent = p.name;
    item.append(name);
    if (p.id === settings.activePrompt) {
      const tag = document.createElement('span');
      tag.className = 'active-tag';
      tag.textContent = 'Active';
      item.append(tag);
    }
    item.addEventListener('click', () => selectPrompt(p.id));
    list.append(item);
  }
}

function selectPrompt(id) {
  selectedPromptId = id;
  const p = settings.prompts.find(x => x.id === id);
  $('prompt-editor').hidden = !p;
  if (p) {
    $('prompt-name').value = p.name;
    $('prompt-text').value = p.prompt;
  }
  renderPromptList();
}

async function savePrompt() {
  const name = $('prompt-name').value.trim();
  const prompt = $('prompt-text').value.trim();
  if (!name) { toast('Give the prompt a name.'); return; }
  const prompts = settings.prompts.map(p => p.id === selectedPromptId ? { ...p, name, prompt } : p);
  await saveSettings({ prompts });
  renderPresetSelect();
  renderPromptList();
  toast('Prompt saved');
}

async function deletePrompt() {
  if (settings.prompts.length <= 1) { toast('You need at least one prompt.'); return; }
  const prompts = settings.prompts.filter(p => p.id !== selectedPromptId);
  const patch = { prompts };
  if (settings.activePrompt === selectedPromptId) patch.activePrompt = prompts[0].id;
  await saveSettings(patch);
  selectedPromptId = null;
  $('prompt-editor').hidden = true;
  renderPresetSelect();
  renderPromptList();
}

async function addPrompt() {
  const id = 'p' + Date.now();
  const prompts = [...settings.prompts, { id, name: 'New prompt', prompt: '' }];
  await saveSettings({ prompts });
  renderPresetSelect();
  selectPrompt(id);
  $('prompt-name').select();
}

// ============================================================
// Settings view
// ============================================================
function openSettings() {
  chatView.hidden = true;
  composer.hidden = true;
  settingsView.hidden = false;
  fillSettingsForm();
}

function closeSettings() {
  settingsView.hidden = true;
  chatView.hidden = false;
  composer.hidden = false;
  inputEl.focus();
}

function fillSettingsForm() {
  $('set-size').value = settings.size;
  $('set-lowpower').checked = settings.lowPower;
  $('set-reducemotion').checked = settings.reduceMotion;
  $('set-hotkey').value = settings.hotkey;
  $('set-ontop').checked = settings.alwaysOnTop;
  $('set-hideblur').checked = settings.hideOnBlur;
  $('set-websearch').checked = settings.allowWebSearch;
  $('set-normal-model').value = settings.normalModel;
  $('set-deep-model').value = settings.deepModel;
  $('set-claude-path').value = settings.claudePath;
  $('set-askcontrol').checked = settings.askEveryControl;
  $('set-browserlinks').checked = settings.browserLinks;
  $('set-search').value = settings.searchEngine;
  $('set-homepage').value = settings.homePage;
  document.querySelectorAll('[data-widget]').forEach(cb => {
    cb.checked = !!(settings.widgets[cb.dataset.widget] && settings.widgets[cb.dataset.widget].enabled);
  });
  $('set-widgets-ontop').checked = settings.widgetsOnTop;
  $('set-widgets-locked').checked = settings.widgetsLocked;
  $('set-clock24').checked = settings.clock24h;
  $('set-weather-city').value = settings.weatherCity;
  $('set-weather-units').value = settings.weatherUnits;
  $('set-servers').value = settings.servers;
  $('set-browseshots').checked = settings.browseScreenshots;
  fillVoiceSettings();
  $('set-maxsteps').value = settings.maxSteps;
  $('set-actiondelay').value = String(settings.actionDelay);
  renderThemeGrid();
  renderPromptList();
}

function applyMotionSettings() {
  appEl.classList.toggle('no-motion', !!settings.reduceMotion);
}

// Convert a key press into an Electron accelerator key name.
function acceleratorKey(e) {
  const code = e.code;
  if (/^(Control|Alt|Shift|Meta|OS)/.test(code)) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code)) return code;
  const map = {
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', ArrowUp: 'Up', ArrowDown: 'Down',
    ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End',
    PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete'
  };
  return map[code] || null;
}

function setupHotkeyRecorder(inputId = 'set-hotkey', key = 'hotkey', okKey = 'hotkeyOk') {
  const input = $(inputId);
  let recording = false;
  const stop = () => {
    recording = false;
    input.classList.remove('recording');
    input.value = settings[key];
  };
  input.addEventListener('click', () => {
    recording = true;
    input.classList.add('recording');
    input.value = 'Press keys…';
  });
  input.addEventListener('blur', stop);
  input.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stop(); input.blur(); return; }
    const key = acceleratorKey(e);
    if (!key) return; // only a modifier so far
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    if (!mods.length) { toast('Add Ctrl, Alt, or Shift to the combo.'); return; }
    const accelerator = [...mods, key].join('+');
    const res = await saveSettings({ [key]: accelerator });
    if (res[okKey] === false) toast(`${accelerator} is taken by another app. Try another.`, 3000);
    else toast(`Hotkey set to ${accelerator}`);
    $('hotkey-hint').textContent = settings.hotkey;
    stop();
    input.blur();
  });
}

function setupSettingsControls() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.tab-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });

  const bindToggle = (id, key, after) => {
    $(id).addEventListener('change', async (e) => {
      await saveSettings({ [key]: e.target.checked });
      if (after) after();
    });
  };
  bindToggle('set-lowpower', 'lowPower');
  bindToggle('set-reducemotion', 'reduceMotion', applyMotionSettings);
  bindToggle('set-ontop', 'alwaysOnTop');
  bindToggle('set-hideblur', 'hideOnBlur');
  bindToggle('set-websearch', 'allowWebSearch');
  bindToggle('set-askcontrol', 'askEveryControl');
  bindToggle('set-browserlinks', 'browserLinks');
  bindToggle('set-widgets-ontop', 'widgetsOnTop');
  bindToggle('set-widgets-locked', 'widgetsLocked');
  bindToggle('set-clock24', 'clock24h');
  bindToggle('set-browseshots', 'browseScreenshots');
  $('set-search').addEventListener('change', (e) => saveSettings({ searchEngine: e.target.value }));
  $('set-weather-units').addEventListener('change', (e) => saveSettings({ weatherUnits: e.target.value }));
  document.querySelectorAll('[data-widget]').forEach(cb => {
    cb.addEventListener('change', async () => {
      const type = cb.dataset.widget;
      const widgetsCfg = { ...settings.widgets, [type]: { ...(settings.widgets[type] || {}), enabled: cb.checked } };
      await saveSettings({ widgets: widgetsCfg });
      if (cb.checked && type === 'weather' && !settings.weatherCity) toast('Set your city below so the weather widget works.', 3000);
      if (cb.checked && type === 'servers' && !settings.servers.trim()) toast('Add your servers below.', 3000);
    });
  });
  $('btn-reset-widgets').addEventListener('click', () => { window.violet.widgets.resetPositions(); toast('Widgets moved back'); });

  $('set-maxsteps').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 25));
    e.target.value = n;
    saveSettings({ maxSteps: n });
  });
  $('set-actiondelay').addEventListener('change', (e) => saveSettings({ actionDelay: Number(e.target.value) }));

  $('set-size').addEventListener('change', (e) => saveSettings({ size: e.target.value }));

  const bindText = (id, key) => {
    $(id).addEventListener('change', (e) => saveSettings({ [key]: e.target.value.trim() }));
  };
  bindText('set-normal-model', 'normalModel');
  bindText('set-deep-model', 'deepModel');
  bindText('set-claude-path', 'claudePath');
  bindText('set-homepage', 'homePage');
  bindText('set-weather-city', 'weatherCity');
  $('set-servers').addEventListener('change', (e) => saveSettings({ servers: e.target.value }));

  $('btn-import-theme').addEventListener('click', async () => {
    handleImportResult(await window.violet.themes.importDialog());
  });
  $('btn-open-themes').addEventListener('click', () => window.violet.themes.openFolder());

  $('btn-add-prompt').addEventListener('click', addPrompt);
  $('btn-save-prompt').addEventListener('click', savePrompt);
  $('btn-delete-prompt').addEventListener('click', deletePrompt);

  setupHotkeyRecorder();
  setupHotkeyRecorder('set-voicehotkey', 'voiceHotkey', 'voiceHotkeyOk');
  setupVoiceSettings();
}

// ============================================================
// Drag & drop theme import
// ============================================================
function setupDragDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depth++;
    appEl.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) appEl.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    appEl.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    handleImportResult(await window.violet.themes.importFile(file));
  });
}

// ============================================================
// Wiring
// ============================================================
function setupEvents() {
  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  sendBtn.addEventListener('click', () => {
    if (busy) window.violet.chat.stop();
    else sendMessage(inputEl.value);
  });

  deepBtn.addEventListener('click', () => {
    deep = !deep;
    deepBtn.classList.toggle('on', deep);
    toast(deep ? 'Deepthink on: slower, smarter' : 'Deepthink off');
  });

  browseBtn.addEventListener('click', () => {
    browse = !browse;
    if (browse) { look = false; control = false; }
    updateModeUi();
    toast(browse ? 'Browse mode: Violet uses its own browser' : 'Browse mode off');
    inputEl.focus();
  });

  lookBtn.addEventListener('click', () => {
    look = !look;
    if (look) { control = false; browse = false; } // modes are separate
    updateModeUi();
    inputEl.focus();
  });

  controlBtn.addEventListener('click', () => {
    control = !control;
    if (control) { look = false; browse = false; }
    updateModeUi();
    toast(control ? 'Control mode on: Violet will ask before acting' : 'Control mode off');
    inputEl.focus();
  });

  presetSelect.addEventListener('change', async () => {
    await saveSettings({ activePrompt: presetSelect.value });
    toast(`Style: ${presetSelect.selectedOptions[0].textContent}`);
  });

  $('btn-new').addEventListener('click', newChat);
  $('btn-browser').addEventListener('click', () => window.violet.browser.open());
  $('page-chip-x').addEventListener('click', () => { window.violet.browser.clearPage(); setPageChip(null); });
  window.violet.browser.onPageAttached((info) => {
    closeSettings();
    if (control || browse) { control = false; browse = false; updateModeUi(); } // asking about a page is a chat thing
    setPageChip(info);
    if (info.empty) toast('Couldn\'t read text from that page, but you can still ask about it.', 3000);
    inputEl.placeholder = info.isSelection ? 'Ask about the selected text…' : 'Ask about this page…';
    inputEl.focus();
  });
  $('btn-settings').addEventListener('click', () => (settingsView.hidden ? openSettings() : closeSettings()));
  $('btn-hide').addEventListener('click', () => window.violet.win.hide());

  // Clicks inside messages: copy code, open links, suggestions
  messagesEl.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-code');
    if (copyBtn) {
      const code = copyBtn.closest('.codeblock').querySelector('code').textContent;
      navigator.clipboard.writeText(code);
      copyBtn.textContent = 'Copied';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
      return;
    }
    const link = e.target.closest('a[data-href]');
    if (link) { e.preventDefault(); window.violet.win.openExternal(link.dataset.href); return; }
    const suggestion = e.target.closest('.suggestion');
    if (suggestion) sendMessage(suggestion.dataset.prompt || suggestion.textContent);
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (speaker.speaking) { speaker.stop(); return; }
      if (listening) { cancelListening(); return; }
      if (window.closeOverlayViews && window.closeOverlayViews()) return; // sidebar drawer / memory
      if (!settingsView.hidden) closeSettings();
      else window.violet.win.hide();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newChat();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      window.violet.browser.open();
    } else if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      settingsView.hidden ? openSettings() : closeSettings();
    }
  });

  // Pause animations while hidden (saves GPU/RAM)
  window.violet.win.onVisibility((visible) => {
    const pause = !visible && settings.lowPower;
    appEl.classList.toggle('paused', pause);
    if (pause) videoEl.pause();
    else if (videoEl.getAttribute('src')) videoEl.play().catch(() => {});
  });

  window.violet.win.onFocusInput(() => { if (settingsView.hidden) inputEl.focus(); });

  window.violet.win.onCommand((cmd) => {
    if (cmd === 'new-chat') newChat();
    if (cmd === 'open-settings') openSettings();
  });

  // Theme folder changed (file dropped in or edited): reload live.
  window.violet.themes.onChanged(() => loadThemes());
}

// ============================================================
// Phase 4: voice
// ============================================================
const VV = window.VioletVoice;
const speaker = new VV.Speaker();
const micBtn = $('btn-mic');
let listening = false;
let listenCtl = null;
let lastInputVoice = false;
let wake = null;

speaker.onChange = (on) => {
  appEl.classList.toggle('speaking', on);
  if (wake) wake.paused = on; // don't let Violet wake itself up
};

function maybeSpeak(msg) {
  const mode = settings.speakMode;
  if (mode === 'always' || (mode === 'voice' && lastInputVoice)) {
    speaker.speak(msg.raw, settings).catch(err => toast(`Voice: ${err.message}`, 3500));
  }
}

function cancelListening() {
  if (listenCtl) { listenCtl.cancelled = true; listenCtl.stop && listenCtl.stop(); }
}

// Click the mic (or press the talk hotkey): listen until you stop talking.
async function toggleListening() {
  if (listening) { if (listenCtl && listenCtl.stop) listenCtl.stop(); return; }
  if (busy || waitingForPermission) { toast('Violet is busy. Try again in a sec.'); return; }
  speaker.stop();
  listening = true;
  listenCtl = {};
  if (wake) wake.paused = true;
  appEl.classList.add('listening');
  showStatus('Listening… (click the mic or pause to finish)');
  let wav = null;
  try {
    wav = await VV.record({ onLevel: (l) => micBtn.style.setProperty('--level', l.toFixed(2)), control: listenCtl });
  } catch (err) {
    toast(err.message, 4500);
  }
  const cancelled = listenCtl.cancelled;
  listening = false;
  appEl.classList.remove('listening');
  micBtn.style.setProperty('--level', 0);
  if (wake) wake.paused = false;
  if (cancelled || !wav) {
    statusEl.hidden = true;
    if (!cancelled && wav === null) toast('Didn\'t hear anything.');
    return;
  }
  appEl.classList.add('transcribing');
  showStatus('Transcribing…');
  const res = await window.violet.voice.transcribe(wav, false);
  appEl.classList.remove('transcribing');
  statusEl.hidden = true;
  if (!res.ok) { toast(res.error, 5000); return; }
  if (!res.text) { toast('Didn\'t catch that. Try again?'); return; }
  if (settings.voiceAutoSend) sendMessage(res.text, { voice: true });
  else { inputEl.value = res.text; autoGrow(); inputEl.focus(); lastInputVoice = true; }
}

// "Hey Violet": each short burst of speech is transcribed with the smallest model.
async function onWakeSegment(wav) {
  if (busy || listening || speaker.speaking) return;
  const res = await window.violet.voice.transcribe(wav, true);
  if (!res.ok || !res.text) return;
  const hit = VV.matchWake(res.text);
  if (!hit) return;
  VV.chime();
  await window.violet.voice.wake();
  // "Hey Violet, what's the weather" -> use the rest directly
  if (hit.rest && hit.rest.split(/\s+/).length >= 3) { sendMessage(hit.rest, { voice: true }); return; }
  // Otherwise say the wake-up message (Settings → Voice), then listen
  const line = wakeGreetingLine();
  if (line) { try { await speaker.speak(line, settings); } catch { /* voice off: just listen */ } }
  if (!busy && !listening) toggleListening();
}

/**
 * Pick the wake-up message: options are separated by "|", one is chosen at
 * random, and {greeting} becomes Good morning / Good afternoon / Good evening.
 */
function wakeGreetingLine() {
  const raw = String(settings.wakeGreeting == null ? '' : settings.wakeGreeting).slice(0, 600);
  const options = raw.split('|').map(x => x.trim()).filter(Boolean);
  if (!options.length) return '';
  const hr = new Date().getHours();
  const greeting = hr < 5 ? 'Hey' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  return options[Math.floor(Math.random() * options.length)].replace(/\{greeting\}/gi, greeting).slice(0, 200);
}
window.wakeGreetingLine = wakeGreetingLine;

async function applyWakeSetting() {
  if (settings.wakeWord && !wake) {
    wake = new VV.WakeWatcher(onWakeSegment);
    try { await wake.start(); } catch (err) { toast(err.message, 4500); wake = null; await saveSettings({ wakeWord: false }); }
  } else if (!settings.wakeWord && wake) {
    wake.stop();
    wake = null;
  }
}

function setupVoice() {
  micBtn.addEventListener('click', toggleListening);
  window.violet.voice.onHotkey(() => { closeSettings(); toggleListening(); });
  statusEl.addEventListener('click', () => { if (speaker.speaking) speaker.stop(); });
  // Windows voices load asynchronously
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (!settingsView.hidden) fillVoiceSettings(); };
  applyWakeSetting();
}

async function fillVoiceSettings() {
  $('set-speakmode').value = settings.speakMode;
  $('set-ttsengine').value = settings.ttsEngine;
  $('set-ttsspeed').value = settings.ttsSpeed;
  $('set-ttspitch').value = settings.ttsPitch;
  $('speed-val').textContent = `${Number(settings.ttsSpeed).toFixed(1)}×`;
  $('pitch-val').textContent = Number(settings.ttsPitch).toFixed(1);
  $('set-autosend').checked = settings.voiceAutoSend;
  $('set-voicehotkey').value = settings.voiceHotkey;
  $('set-wakeword').checked = settings.wakeWord;
  $('set-sttlang').value = settings.sttLang;
  const isPiper = settings.ttsEngine === 'piper';
  $('row-winvoice').hidden = isPiper;
  $('row-pitch').hidden = isPiper;
  $('row-pipervoice').hidden = !isPiper;

  // Windows voices
  const winSel = $('set-winvoice');
  winSel.innerHTML = '';
  for (const v of speaker.windowsVoices()) {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = v.name.replace(/^Microsoft /, '').replace(/ - .*$/, '') + (v.lang ? ` (${v.lang})` : '');
    winSel.append(o);
  }
  if (settings.winVoice) winSel.value = settings.winVoice;

  // Piper voices + whisper models from disk
  const st = await window.violet.voice.status();
  const pSel = $('set-pipervoice');
  pSel.innerHTML = '';
  for (const v of st.voices) {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.name;
    pSel.append(o);
  }
  if (settings.piperVoice) pSel.value = settings.piperVoice;
  $('piper-status').textContent = !st.piper
    ? 'Piper not found. Unzip piper_windows_amd64.zip into the piper folder (see README) to use custom voices.'
    : st.voices.length ? `Piper ready · ${st.voices.length} voice(s). Add more by dropping .onnx + .onnx.json files in the voices folder.`
      : 'Piper found, but no voices yet. Drop a .onnx + .onnx.json voice into the voices folder.';

  const mSel = $('set-sttmodel');
  mSel.innerHTML = '';
  for (const m of st.models) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = `${m.id} (${m.sizeMB} MB)`;
    mSel.append(o);
  }
  if (settings.sttModel) mSel.value = settings.sttModel;
  $('whisper-status').textContent = !st.whisper
    ? 'Speech recognition not set up yet. Unzip whisper-bin-x64.zip into the speech folder and add a model (see README).'
    : st.models.length ? 'Speech recognition ready. Everything runs on your PC.'
      : 'Whisper found, but no model yet. Put a ggml-*.bin model (e.g. ggml-base.en.bin) in the speech folder.';
  const missing = !st.whisper || !st.models.length || !st.piper || !st.voices.length;
  if (!voiceInstallBusy) $('voice-install').hidden = !missing;
}

// ---- One-click voice download ----
let voiceInstallBusy = false;
function setupVoiceInstall() {
  const btn = $('btn-voice-install');
  const msg = $('voice-install-msg');
  const bar = $('voice-install-bar');
  const fill = $('voice-install-fill');
  window.violet.voice.onInstallProgress((p) => {
    msg.textContent = `${p.step}… ${p.detail || (p.percent ? p.percent + '%' : '')}`;
    fill.style.width = `${p.percent || 0}%`;
  });
  btn.addEventListener('click', async () => {
    voiceInstallBusy = true;
    btn.disabled = true;
    bar.hidden = false;
    msg.textContent = 'Starting download…';
    const r = await window.violet.voice.install();
    voiceInstallBusy = false;
    btn.disabled = false;
    bar.hidden = true;
    if (r.ok) {
      settings = await window.violet.settings.get(); // picks up the new default model/voice
      msg.textContent = r.installed.length ? `Installed: ${r.installed.join(', ')}. You're all set.` : 'Everything was already installed.';
      fillVoiceSettings();
    } else {
      msg.textContent = `Couldn't finish: ${r.error} Click to try again; finished parts are kept.`;
    }
  });
}

function setupVoiceSettings() {
  setupVoiceInstall();
  const sel = (id, key, after) => $(id).addEventListener('change', async (e) => { await saveSettings({ [key]: e.target.value }); if (after) after(); });
  sel('set-speakmode', 'speakMode');
  sel('set-ttsengine', 'ttsEngine', fillVoiceSettings);
  sel('set-winvoice', 'winVoice');
  sel('set-pipervoice', 'piperVoice');
  sel('set-sttmodel', 'sttModel');
  sel('set-sttlang', 'sttLang');
  $('set-ttsspeed').addEventListener('input', (e) => { $('speed-val').textContent = `${Number(e.target.value).toFixed(1)}×`; });
  $('set-ttsspeed').addEventListener('change', (e) => saveSettings({ ttsSpeed: Number(e.target.value) }));
  $('set-ttspitch').addEventListener('input', (e) => { $('pitch-val').textContent = Number(e.target.value).toFixed(1); });
  $('set-ttspitch').addEventListener('change', (e) => saveSettings({ ttsPitch: Number(e.target.value) }));
  $('set-autosend').addEventListener('change', (e) => saveSettings({ voiceAutoSend: e.target.checked }));
  $('set-wakeword').addEventListener('change', async (e) => {
    await saveSettings({ wakeWord: e.target.checked });
    await applyWakeSetting();
    if (settings.wakeWord) toast('Say "Hey Violet" to wake me up');
  });
  $('btn-test-voice').addEventListener('click', () => {
    speaker.speak("Hi, I'm Violet. This is how I sound. Pretty good, right?", settings)
      .catch(err => toast(`Voice: ${err.message}`, 4000));
  });
  $('btn-open-voices').addEventListener('click', () => window.violet.voice.openFolder(settings.ttsEngine === 'piper' ? 'voices' : 'piper'));
  $('btn-open-whisper').addEventListener('click', () => window.violet.voice.openFolder('whisper'));
}

function setGreeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  $('greeting').textContent = `${part}. I'm Violet.`;
}

async function init() {
  settings = await window.violet.settings.get();
  $('hotkey-hint').textContent = settings.hotkey;
  setGreeting();
  applyMotionSettings();
  renderPresetSelect();
  setupEvents();
  setupSettingsControls();
  setupDragDrop();
  setupVoice();
  await loadThemes();
  inputEl.focus();
}

// init() is called at the end of v2.js
