// ============================================================
// Violet Code - editor UI (Monaco = the editor inside VS Code)
// File tree, tabs, save, side-by-side review of Violet's changes,
// and "Ask Violet" for the selected code.
// ============================================================
const $ = (id) => document.getElementById(id);
let monacoReady = false;
let editor = null;          // normal editor
let diffEditor = null;      // side-by-side review editor
let project = { root: null, name: null };
const tabs = [];            // {key, path, model, saved, kind:'file'|'review', review}
let activeKey = null;

const LANGS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', md: 'markdown', py: 'python',
  java: 'java', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
  sh: 'shell', bash: 'shell', ps1: 'powershell', bat: 'bat', cmd: 'bat', yml: 'yaml', yaml: 'yaml', xml: 'xml',
  sql: 'sql', lua: 'lua', kt: 'kotlin', swift: 'swift', ini: 'ini', toml: 'ini', dockerfile: 'dockerfile'
};
const langOf = (p) => {
  const name = p.split('/').pop().toLowerCase();
  if (name === 'dockerfile') return 'dockerfile';
  return LANGS[name.split('.').pop()] || 'plaintext';
};

function toast(text, ms = 2400) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- Theme: turn Violet's theme into a Monaco theme ----------
function toHex(color, fallback) {
  if (!color || color === 'transparent' || /gradient/.test(color)) return fallback;
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = color;
  const v = c.fillStyle; // "#rrggbb" or "rgba(r, g, b, a)"
  if (v.startsWith('#')) return v;
  const m = v.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
  if (!m) return fallback;
  const hx = (n) => Math.round(Number(n)).toString(16).padStart(2, '0');
  // Monaco needs opaque backgrounds: drop alpha
  return `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`;
}

function applyTheme(theme) {
  window.applyThemeColors(theme);
  if (!monacoReady) return;
  const c = (theme && theme.colors) || {};
  const bg = toHex(c.bg, '#120c1e');
  const accent = toHex(c.accent, '#a78bfa');
  const light = theme && /light/i.test(theme.name || '');
  monaco.editor.defineTheme('violet', {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: light ? '8b7fa8' : '7f73a3', fontStyle: 'italic' },
      { token: 'keyword', foreground: accent.slice(1) },
      { token: 'string', foreground: light ? 'b0367a' : 'f0abfc' }
    ],
    colors: {
      'editor.background': bg === '#000000' ? '#120c1e' : bg,
      'editor.foreground': toHex(c.text, light ? '#2a1f3d' : '#f3eefe'),
      'editorCursor.foreground': accent,
      'editor.selectionBackground': accent + '55',
      'editor.lineHighlightBackground': light ? '#00000008' : '#ffffff08',
      'editorLineNumber.foreground': light ? '#b3a8cc' : '#5b4f7a',
      'editorLineNumber.activeForeground': accent,
      'editorIndentGuide.background1': light ? '#0000000d' : '#ffffff10'
    }
  });
  monaco.editor.setTheme('violet');
}

// ---------- File tree (folders load when you open them) ----------
async function renderTree() {
  const tree = $('tree');
  tree.innerHTML = '';
  if (!project.root) return;
  await addChildren(tree, '', 0);
}

async function addChildren(container, rel, depth) {
  let items = [];
  try { items = await window.vide.list(rel); } catch (err) { toast(err.message); return; }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'node' + (it.dir ? ' dir' : '');
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.path = it.path;
    const tw = document.createElement('span');
    tw.className = 'tw';
    tw.textContent = it.dir ? '▶' : '';
    const ic = document.createElement('span');
    ic.className = 'ic';
    const name = document.createElement('span');
    name.textContent = it.name;
    row.append(tw, ic, name);
    container.append(row);
    if (it.dir) {
      const kids = document.createElement('div');
      kids.hidden = true;
      container.append(kids);
      let loaded = false;
      row.addEventListener('click', async () => {
        row.classList.toggle('open');
        kids.hidden = !row.classList.contains('open');
        if (!loaded) { loaded = true; await addChildren(kids, it.path, depth + 1); }
      });
    } else {
      row.addEventListener('click', () => openFile(it.path));
    }
  }
}

function markActiveInTree(p) {
  document.querySelectorAll('.node.active').forEach(n => n.classList.remove('active'));
  const n = [...document.querySelectorAll('.node')].find(x => x.dataset.path === p);
  if (n) n.classList.add('active');
}

// ---------- Tabs ----------
function renderTabs() {
  const bar = $('tabs');
  bar.innerHTML = '';
  for (const t of tabs) {
    const el = document.createElement('div');
    const dirty = t.kind === 'file' && t.model.getValue() !== t.saved;
    el.className = 'tab' + (t.key === activeKey ? ' active' : '') + (dirty ? ' dirty' : '') + (t.kind === 'review' ? ' review' : '');
    el.title = t.path;
    const name = document.createElement('span');
    name.textContent = (t.kind === 'review' ? 'Review: ' : '') + t.path.split('/').pop();
    const x = document.createElement('button');
    x.className = 'x';
    x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.key); });
    el.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.key); } });
    el.addEventListener('click', () => activate(t.key));
    el.append(name, x);
    bar.append(el);
  }
  $('welcome').hidden = tabs.length > 0;
  if (!tabs.length) $('welcome').style.display = ''; else $('welcome').style.display = 'none';
}

function activeTab() { return tabs.find(t => t.key === activeKey) || null; }

function activate(key) {
  activeKey = key;
  const t = activeTab();
  $('review-bar').hidden = !t || t.kind !== 'review';
  $('disk-banner').hidden = !t || !t.diskChanged;
  if (!t) { editor.setModel(null); diffEditor.getContainerDomNode().style.display = 'none'; editor.getContainerDomNode().style.display = ''; renderTabs(); updateStatus(); return; }
  if (t.kind === 'review') {
    editor.getContainerDomNode().style.display = 'none';
    diffEditor.getContainerDomNode().style.display = '';
    diffEditor.setModel({ original: t.original, modified: t.model });
    $('review-label').textContent = `Violet wants to ${t.review.action === 'delete' ? 'delete' : t.review.action === 'create' ? 'create' : 'change'} ${t.review.path}` +
      (t.review.status !== 'pending' && t.review.status !== 'undone' ? ` (${t.review.status})` : '');
    const done = t.review.status === 'applied' || t.review.status === 'rejected';
    $('rv-apply').hidden = done;
    $('rv-reject').hidden = done;
    diffEditor.layout();
  } else {
    diffEditor.getContainerDomNode().style.display = 'none';
    editor.getContainerDomNode().style.display = '';
    editor.setModel(t.model);
    if (t.viewState) editor.restoreViewState(t.viewState);
    editor.layout();
    editor.focus();
    markActiveInTree(t.path);
  }
  renderTabs();
  updateStatus();
}

function closeTab(key) {
  const i = tabs.findIndex(t => t.key === key);
  if (i === -1) return;
  const t = tabs[i];
  if (t.kind === 'file' && t.model.getValue() !== t.saved && !t.confirmClose) {
    t.confirmClose = true;
    toast('Unsaved changes. Press Ctrl+S to save, or close again to discard.', 3500);
    setTimeout(() => { t.confirmClose = false; }, 3500);
    return;
  }
  tabs.splice(i, 1);
  if (t.original) t.original.dispose();
  t.model.dispose();
  if (activeKey === key) activate(tabs[Math.min(i, tabs.length - 1)] ? tabs[Math.min(i, tabs.length - 1)].key : null);
  else renderTabs();
}

async function openFile(p) {
  const key = `file:${p}`;
  const existing = tabs.find(t => t.key === key);
  if (existing) { activate(key); return; }
  let text;
  try { text = await window.vide.read(p); } catch (err) { toast(err.message, 3500); return; }
  const model = monaco.editor.createModel(text, langOf(p));
  const tab = { key, path: p, model, saved: text, kind: 'file' };
  model.onDidChangeContent(() => renderTabs());
  tabs.push(tab);
  activate(key);
}

async function save() {
  const t = activeTab();
  if (!t || t.kind !== 'file') return;
  try {
    await window.vide.save(t.path, t.model.getValue());
    t.saved = t.model.getValue();
    t.diskChanged = false;
    $('disk-banner').hidden = true;
    renderTabs();
    toast('Saved');
  } catch (err) { toast(err.message, 3500); }
}

// ---------- Reviewing Violet's proposed change ----------
function openReview(r) {
  const key = `review:${r.id}`;
  const old = tabs.find(t => t.key === key);
  if (old) { old.review = r; activate(key); return; }
  const lang = langOf(r.path);
  const tab = {
    key, path: r.path, kind: 'review', review: r,
    original: monaco.editor.createModel(r.original, lang),
    model: monaco.editor.createModel(r.action === 'delete' ? '' : r.modified, lang)
  };
  tabs.push(tab);
  activate(key);
}

async function reviewAction(action) {
  const t = activeTab();
  if (!t || t.kind !== 'review') return;
  try {
    await window.vide.change(t.review.id, action);
    t.review.status = action === 'apply' ? 'applied' : 'rejected';
    toast(action === 'apply' ? 'Applied ✓' : 'Rejected');
    activate(t.key);
  } catch (err) { toast(err.message, 3500); }
}

// ---------- Ask Violet about the selection ----------
async function askViolet() {
  const t = activeTab();
  if (!t || t.kind !== 'file') { toast('Open a file first.'); return; }
  const sel = editor.getSelection();
  let text = sel && !sel.isEmpty() ? t.model.getValueInRange(sel) : t.model.getValue();
  let lines = sel && !sel.isEmpty() ? `${sel.startLineNumber}-${sel.endLineNumber}` : '';
  if (!text.trim()) { toast('Nothing to send.'); return; }
  await window.vide.ask({ path: t.path, lines, text });
  toast('Sent to Violet. Ask your question in the chat.');
}

function updateStatus() {
  const t = activeTab();
  $('st-path').textContent = t ? (project.root ? `${project.name}/${t.path}` : t.path) : (project.root || '');
  $('st-lang').textContent = t ? langOf(t.path) : '';
  if (t && t.kind === 'file') {
    const p = editor.getPosition();
    $('st-pos').textContent = p ? `Ln ${p.lineNumber}, Col ${p.column}` : '';
  } else $('st-pos').textContent = '';
}

function setProject(info) {
  project = info || { root: null };
  $('proj-name').textContent = project.root ? project.name : 'No project';
  $('proj-name').title = project.root || '';
  $('welcome-text').innerHTML = project.root
    ? `<b>${project.name.replace(/[<>&]/g, '')}</b> is open. Pick a file on the left.<br>Violet's suggested changes open here as side-by-side reviews.`
    : 'Open a project folder to browse and edit files.<br>Violet can read this folder and suggest changes you approve.';
  $('btn-open2').hidden = !!project.root;
  renderTree();
}

// ---------- Startup ----------
async function start() {
  monacoReady = true;
  const opts = {
    automaticLayout: true,
    fontFamily: '"Cascadia Code", Consolas, monospace',
    fontLigatures: true,
    fontSize: 13.5,
    minimap: { enabled: true, renderCharacters: false },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    padding: { top: 10 },
    scrollBeyondLastLine: false
  };
  editor = monaco.editor.create($('editor'), { ...opts, model: null });
  const diffBox = document.createElement('div');
  diffBox.style.cssText = 'width:100%;height:100%;display:none';
  $('editor').append(diffBox);
  diffEditor = monaco.editor.createDiffEditor(diffBox, { ...opts, readOnly: true, renderSideBySide: true, originalEditable: false });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
  editor.onDidChangeCursorPosition(updateStatus);

  const d = await window.vide.init();
  applyTheme(d.theme);
  setProject(d.project);
  renderTabs();

  window.vide.onReview(openReview);
  window.vide.onTheme(applyTheme);
  window.vide.onProject(setProject);
  window.vide.onToast((m) => toast(m, 3500));
  window.vide.onFileChanged(async (p) => {
    const t = tabs.find(x => x.key === `file:${p}`);
    if (!t) { renderTree(); return; }
    if (t.model.getValue() === t.saved) {
      try { const text = await window.vide.read(p); t.model.setValue(text); t.saved = text; renderTabs(); toast(`${p} updated`); }
      catch { closeTab(t.key); }
    } else {
      t.diskChanged = true; // you have unsaved edits: let you choose
      if (activeKey === t.key) $('disk-banner').hidden = false;
    }
  });
}

// UI wiring that doesn't need Monaco
$('btn-open').addEventListener('click', () => window.vide.openFolder().then(setProject).catch(e => toast(e.message)));
$('btn-open2').addEventListener('click', () => $('btn-open').click());
$('btn-refresh').addEventListener('click', renderTree);
$('btn-ask').addEventListener('click', askViolet);
$('rv-apply').addEventListener('click', () => reviewAction('apply'));
$('rv-reject').addEventListener('click', () => reviewAction('reject'));
$('btn-reload').addEventListener('click', async () => {
  const t = activeTab();
  if (!t) return;
  const text = await window.vide.read(t.path);
  t.model.setValue(text);
  t.saved = text;
  t.diskChanged = false;
  $('disk-banner').hidden = true;
  renderTabs();
});
$('w-min').addEventListener('click', () => window.vide.win('min'));
$('w-max').addEventListener('click', () => window.vide.win('max'));
$('w-close').addEventListener('click', () => {
  const dirty = tabs.some(t => t.kind === 'file' && t.model.getValue() !== t.saved);
  if (dirty && !$('w-close').dataset.confirm) {
    $('w-close').dataset.confirm = '1';
    toast('You have unsaved files. Click close again to discard them.', 3500);
    setTimeout(() => { delete $('w-close').dataset.confirm; }, 3500);
    return;
  }
  window.vide.win('close');
});
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeKey) closeTab(activeKey); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); askViolet(); }
});

// Load Monaco from node_modules (installed by `npm install`)
if (typeof require === 'undefined' || !require.config) {
  $('welcome-text').innerHTML = 'The code editor isn\'t installed yet.<br>Close Violet, run <b>npm install</b> in the Violet folder, and start it again.';
  $('btn-open2').hidden = true;
} else {
  require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
  require(['vs/editor/editor.main'], start);
}
