// ============================================================
// Violet v2 UI: full-window mode, saved chats sidebar, Memory tab,
// Projects (file-change cards with Apply / Reject / Undo).
// Loaded after renderer.js and shares its globals (settings,
// current, messagesEl, addAssistantMessage, toast, ...).
// ============================================================
const bodyEl = document.body;
const sidebarEl = $('sidebar');
const chatListEl = $('chat-list');
const memoryView = $('memory-view');
const titleChatEl = $('title-chat');
let currentChatId = null;
let chatSearchTimer = null;
let memoryItems = [];

// ---------- helpers ----------
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function dayGroup(ts) {
  const d = new Date(ts), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return 'Today';
  if (ts >= start - 86400000) return 'Yesterday';
  if (ts >= start - 6 * 86400000) return 'Previous 7 days';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: 'long' });
  return String(d.getFullYear());
}

// ============================================================
// Views: chat / memory / settings
// ============================================================
function showView(name) {
  chatView.hidden = name !== 'chat';
  composer.hidden = name !== 'chat';
  memoryView.hidden = name !== 'memory';
  settingsView.hidden = name !== 'settings';
  $('nav-memory').classList.toggle('active', name === 'memory');
  $('nav-settings').classList.toggle('active', name === 'settings');
  if (name === 'chat') inputEl.focus();
  if (bodyEl.classList.contains('panel') ) closeDrawer();
}

// Override renderer.js versions so all three views stay in sync.
function openSettings() {
  showView('settings');
  fillSettingsForm();
  $('set-startup').checked = !!settings.startWithWindows;
}
function closeSettings() { showView('chat'); }

function openMemory() { showView('memory'); loadMemory(); }

window.closeOverlayViews = () => {
  if (bodyEl.classList.contains('drawer-open')) { closeDrawer(); return true; }
  if (!memoryView.hidden) { showView('chat'); return true; }
  return false;
};

// ============================================================
// Window modes: panel (corner) vs full window with sidebar
// ============================================================
function applyModeUi(mode) {
  const full = mode === 'full';
  bodyEl.classList.toggle('full', full);
  bodyEl.classList.toggle('panel', !full);
  bodyEl.classList.toggle('side-collapsed', full && !!settings.sidebarCollapsed);
  closeDrawer();
  $('btn-mode').title = full ? 'Shrink to panel (F11)' : 'Full window (F11)';
}

function toggleMode() {
  window.violet.win.setMode(bodyEl.classList.contains('full') ? 'panel' : 'full');
}

function openDrawer() { bodyEl.classList.add('drawer-open'); $('chat-search').focus(); }
function closeDrawer() { bodyEl.classList.remove('drawer-open'); }

async function toggleSidebar() {
  if (bodyEl.classList.contains('full')) {
    await saveSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
    bodyEl.classList.toggle('side-collapsed', !!settings.sidebarCollapsed);
  } else if (bodyEl.classList.contains('drawer-open')) closeDrawer();
  else openDrawer();
}

// ============================================================
// Saved chats
// ============================================================
async function loadChatList() {
  const q = $('chat-search').value.trim();
  const list = await window.violet.chats.list(q);
  chatListEl.innerHTML = '';
  if (!list.length) {
    chatListEl.append(h('div', 'list-empty', q ? 'No chats match that.' : 'Your chats will show up here.'));
    return;
  }
  let lastGroup = null;
  for (const c of list) {
    const group = c.pinned ? 'Pinned' : dayGroup(c.updated);
    if (group !== lastGroup) { chatListEl.append(h('div', 'list-group', group)); lastGroup = group; }
    chatListEl.append(chatItem(c));
  }
}

function chatItem(c) {
  const item = h('div', 'chat-item' + (c.id === currentChatId ? ' active' : ''));
  item.title = c.preview || c.title;
  const title = h('div', 'ci-title', c.title);
  const meta = h('div', 'ci-meta', timeAgo(c.updated));
  const text = h('div', 'ci-text');
  text.append(title, meta);
  const actions = h('div', 'ci-actions');
  const mk = (label, svg, fn) => {
    const b = h('button', '', null);
    b.title = label;
    b.innerHTML = svg;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
    return b;
  };
  actions.append(
    mk(c.pinned ? 'Unpin' : 'Pin', '<svg viewBox="0 0 24 24"><path d="M12 17v5M5 17h14l-2-4V5H7v8z"/></svg>', async () => {
      await window.violet.chats.pin(c.id, !c.pinned);
    }),
    mk('Rename', '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>', () => startRename(item, c)),
    mk('Delete', '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>', async (b) => {
      if (!b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.title = 'Click again to delete';
        setTimeout(() => b.classList.remove('confirm'), 2500);
        return;
      }
      const res = await window.violet.chats.remove(c.id);
      if (!res.ok) { toast(res.error); return; }
      if (c.id === currentChatId) await renderChat(res.current);
    })
  );
  item.append(text, actions);
  item.addEventListener('click', () => openChat(c.id));
  return item;
}

function startRename(item, c) {
  const input = h('input', 'ci-rename');
  input.value = c.title;
  item.querySelector('.ci-text').replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    if (save && input.value.trim()) await window.violet.chats.rename(c.id, input.value.trim());
    else loadChatList();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

async function openChat(id) {
  if (id === currentChatId) { showView('chat'); closeDrawer(); return; }
  if (busy) { toast('Wait for Violet to finish first.'); return; }
  const res = await window.violet.chats.open(id);
  if (!res.ok) { toast(res.error); return; }
  speaker.stop();
  await renderChat(res.chat);
  showView('chat');
  closeDrawer();
}

/** Draw a saved chat (messages, step logs, change cards). */
async function renderChat(chat) {
  current = null;
  setBusy(false);
  messagesEl.querySelectorAll('.msg, .perm-card').forEach(m => m.remove());
  currentChatId = chat ? chat.id : null;
  const msgs = (chat && chat.messages) || [];
  emptyEl.hidden = msgs.length > 0;
  const changeIds = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      addUserMessage(m.text, m.images);
      continue;
    }
    current = addAssistantMessage(m.deep, m.kind);
    for (const st of m.steps || []) addStep(st);
    current.raw = m.text || '';
    if (m.error) current.el.classList.add('error');
    const el = current.el;
    finishMessage(false, { speak: false });
    if (m.changes && m.changes.length) {
      renderChanges(el, m.changes);
      m.changes.forEach(c => c.id && changeIds.push(c.id));
    }
  }
  current = null;
  titleChatEl.textContent = msgs.length ? chat.title : '';
  chatView.scrollTop = chatView.scrollHeight;
  loadChatList();
  // Cards may have been applied/undone elsewhere since: ask for their real status
  if (changeIds.length) {
    const st = await window.violet.changes.statuses(changeIds);
    for (const [id, status] of Object.entries(st)) updateChangeCard(id, status);
  }
}

window.onNewChat = () => {
  currentChatId = null;
  titleChatEl.textContent = '';
  loadChatList();
  showView('chat');
};

// ============================================================
// Memory tab
// ============================================================
async function loadMemory() {
  memoryItems = await window.violet.memory.list();
  updateMemoryCount();
  renderMemory();
  $('set-memauto').checked = settings.memoryAuto !== false;
}

function updateMemoryCount() {
  $('memory-count').textContent = memoryItems.length ? String(memoryItems.length) : '';
  $('memory-total').textContent = `${memoryItems.length} ${memoryItems.length === 1 ? 'memory' : 'memories'}`;
}

function renderMemory() {
  const list = $('memory-list');
  const q = $('memory-search').value.trim().toLowerCase();
  list.innerHTML = '';
  const items = memoryItems.filter(m => !q || m.text.toLowerCase().includes(q));
  if (!items.length) {
    const empty = h('div', 'mem-empty');
    empty.innerHTML = q ? 'No memories match that.'
      : '<b>No memories yet.</b><br>Tell Violet things like "I mainly code in JavaScript" and it will remember, or add them above.';
    list.append(empty);
    return;
  }
  for (const m of items) list.append(memoryCard(m));
}

function memoryCard(m) {
  const card = h('div', 'mem-card');
  const text = h('div', 'mem-text', m.text);
  const meta = h('div', 'mem-meta');
  meta.append(h('span', 'mem-badge ' + (m.source === 'violet' ? 'auto' : 'manual'), m.source === 'violet' ? 'Violet saved' : 'You added'),
    h('span', '', timeAgo(m.edited || m.created)));
  const actions = h('div', 'mem-actions');
  const edit = h('button', '', 'Edit');
  const del = h('button', 'del', 'Delete');
  edit.addEventListener('click', () => {
    if (text.isContentEditable) return;
    text.contentEditable = 'true';
    text.focus();
    document.getSelection().selectAllChildren(text);
    edit.textContent = 'Save';
    const save = async () => {
      text.contentEditable = 'false';
      edit.textContent = 'Edit';
      const v = text.textContent.trim();
      if (v && v !== m.text) { await window.violet.memory.update(m.id, v); toast('Memory updated'); }
      loadMemory();
    };
    text.addEventListener('blur', save, { once: true });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); text.textContent = m.text; text.blur(); }
    });
  });
  del.addEventListener('click', async () => {
    await window.violet.memory.remove(m.id);
    loadMemory();
  });
  actions.append(edit, del);
  card.append(text, meta, actions);
  return card;
}

async function addMemory() {
  const input = $('memory-input');
  const v = input.value.trim();
  if (!v) return;
  const item = await window.violet.memory.add(v);
  if (!item) toast('Already remembered (or empty).');
  input.value = '';
  loadMemory();
}

// ============================================================
// Projects
// ============================================================
let projectInfo = { root: null, name: null, recent: [] };

function renderProject(info) {
  projectInfo = info || projectInfo;
  const box = $('side-project');
  box.innerHTML = '';
  $('project-chip').hidden = !projectInfo.root;
  if (projectInfo.root) {
    $('project-name').textContent = projectInfo.name;
    $('project-chip').title = projectInfo.root;
    const card = h('div', 'proj-card');
    const name = h('div', 'proj-name', projectInfo.name);
    const path = h('div', 'proj-path', projectInfo.root);
    const row = h('div', 'proj-row');
    const ed = h('button', 'btn small', 'Open editor');
    ed.addEventListener('click', () => window.violet.projects.openEditor());
    const close = h('button', 'btn ghost small', 'Close');
    close.addEventListener('click', closeProject);
    row.append(ed, close);
    card.append(name, path, row);
    box.append(card);
  } else {
    const open = h('button', 'side-btn', null);
    open.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><span>Open a project folder…</span>';
    open.addEventListener('click', () => openProject());
    box.append(open);
    for (const r of (projectInfo.recent || []).slice(0, 4)) {
      const b = h('button', 'recent-proj', r.split(/[\\/]/).pop());
      b.title = r;
      b.addEventListener('click', () => openProject(r));
      box.append(b);
    }
  }
}

async function openProject(dir) {
  const info = await window.violet.projects.open(dir);
  if (info.error) { toast(info.error, 4000); return; }
  renderProject(info);
  if (info.root) toast(`Project open: ${info.name}. Violet can read it and suggest changes.`, 3500);
}

async function closeProject() {
  renderProject(await window.violet.projects.close());
  toast('Project closed');
}

// ============================================================
// File-change cards (nothing is written until you click Apply)
// ============================================================
const cardsById = new Map();

function renderChanges(msgEl, changes) {
  if (!changes || !changes.length) return;
  let box = msgEl.querySelector('.changes');
  if (!box) {
    box = h('div', 'changes');
    const actions = msgEl.querySelector('.msg-actions');
    if (actions) msgEl.insertBefore(box, actions); else msgEl.append(box);
  }
  const pending = changes.filter(c => c.id && c.status === 'pending');
  if (pending.length > 1) {
    const all = h('div', 'changes-head');
    all.append(h('span', '', `${changes.length} file changes`));
    const btn = h('button', 'btn small', `Apply all (${pending.length})`);
    btn.addEventListener('click', async () => {
      for (const c of pending) {
        const card = cardsById.get(c.id);
        if (card && card.dataset.status === 'pending') await doChange(c.id, 'apply');
      }
      btn.remove();
    });
    all.append(btn);
    box.append(all);
  }
  for (const c of changes) box.append(changeCard(c));
}

function changeCard(c) {
  const card = h('div', 'change-card');
  const head = h('div', 'cc-head');
  const badge = { create: ['new', 'New file'], replace: ['edit', 'Edit'], delete: ['del', 'Delete'] }[c.action] || ['edit', c.action];
  head.append(h('span', 'cc-path', c.path), h('span', `cc-badge ${badge[0]}`, badge[1]));
  if (c.error) {
    card.classList.add('error');
    card.append(head, h('div', 'cc-error', `Can't apply: ${c.error}`));
    return card;
  }
  const stats = h('span', 'cc-stats');
  stats.append(h('i', 'add', `+${c.added}`), h('i', 'del', `−${c.removed}`));
  head.append(stats);

  // Diff
  const diff = h('div', 'cc-diff' + ((c.lines || []).length > 14 ? ' collapsed' : ''));
  for (const l of c.lines || []) {
    if (l.t === 'gap') { diff.append(h('div', 'dl gap', '⋯')); continue; }
    if (l.t === 'more') { diff.append(h('div', 'dl gap', `… ${l.count} more lines (open Review to see everything)`)); continue; }
    const row = h('div', 'dl ' + (l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'));
    row.append(h('span', 'ln', l.o ?? ''), h('span', 'ln', l.n ?? ''), h('span', 'sg', l.t === ' ' ? '' : l.t), h('span', 'code', l.text));
    diff.append(row);
  }
  const more = h('button', 'cc-more', 'Show all');
  more.addEventListener('click', () => {
    diff.classList.toggle('collapsed');
    more.textContent = diff.classList.contains('collapsed') ? 'Show all' : 'Show less';
  });

  // Actions
  const actions = h('div', 'cc-actions');
  const apply = h('button', 'btn small cc-apply', c.action === 'delete' ? 'Delete file' : 'Apply');
  const reject = h('button', 'btn ghost small cc-reject', 'Reject');
  const review = h('button', 'btn ghost small cc-review', 'Review in editor');
  const undo = h('button', 'btn ghost small cc-undo', 'Undo');
  const status = h('span', 'cc-status');
  apply.addEventListener('click', () => doChange(c.id, 'apply'));
  reject.addEventListener('click', () => doChange(c.id, 'reject'));
  undo.addEventListener('click', () => doChange(c.id, 'undo'));
  review.addEventListener('click', () => window.violet.changes.review(c.id));
  actions.append(apply, reject, review, status, undo);

  card.append(head, diff);
  if ((c.lines || []).length > 14) card.append(more);
  card.append(actions);
  card.dataset.id = c.id;
  cardsById.set(c.id, card);
  setCardStatus(card, c.status || 'pending');
  return card;
}

function setCardStatus(card, status) {
  card.dataset.status = status;
  const pending = status === 'pending' || status === 'undone';
  card.querySelector('.cc-apply').hidden = !pending;
  card.querySelector('.cc-reject').hidden = status !== 'pending';
  card.querySelector('.cc-undo').hidden = status !== 'applied';
  card.querySelector('.cc-review').hidden = status === 'rejected' || status === 'missing';
  card.querySelector('.cc-status').textContent =
    { applied: '✓ Applied', rejected: 'Rejected', undone: '↺ Undone', missing: 'No longer available' }[status] || '';
  card.classList.toggle('applied', status === 'applied');
  card.classList.toggle('rejected', status === 'rejected' || status === 'missing');
}

function updateChangeCard(id, status) {
  const card = cardsById.get(id);
  if (card) setCardStatus(card, status);
}

async function doChange(id, action) {
  const res = await window.violet.changes.action(id, action);
  if (!res.ok) { toast(res.error || 'That didn\'t work.', 4000); return; }
  // Status updates arrive via changes.onStatus
}

window.renderChanges = renderChanges;

// ============================================================
// Wiring
// ============================================================
function setupV2() {
  $('btn-mode').addEventListener('click', toggleMode);
  $('btn-min').addEventListener('click', () => window.violet.win.minimize());
  $('btn-max').addEventListener('click', () => window.violet.win.maximize());
  $('btn-sidebar').addEventListener('click', toggleSidebar);
  $('scrim').addEventListener('click', closeDrawer);
  $('btn-sidebar-new').addEventListener('click', () => { newChat(); closeDrawer(); });
  $('btn-editor').addEventListener('click', () => window.violet.projects.openEditor());
  $('nav-memory').addEventListener('click', () => (memoryView.hidden ? openMemory() : showView('chat')));
  $('nav-settings').addEventListener('click', () => (settingsView.hidden ? openSettings() : closeSettings()));
  $('btn-memory-close').addEventListener('click', () => showView('chat'));
  $('btn-memory-add').addEventListener('click', addMemory);
  $('memory-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMemory(); });
  $('memory-search').addEventListener('input', renderMemory);
  $('set-memauto').addEventListener('change', (e) => saveSettings({ memoryAuto: e.target.checked }));
  $('btn-memory-clear').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.textContent = 'Click again to clear';
      setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Clear all'; }, 3000);
      return;
    }
    await window.violet.memory.clear();
    b.dataset.confirm = '';
    b.textContent = 'Clear all';
    loadMemory();
  });
  $('set-startup').addEventListener('change', (e) => saveSettings({ startWithWindows: e.target.checked }));
  $('chat-search').addEventListener('input', () => {
    clearTimeout(chatSearchTimer);
    chatSearchTimer = setTimeout(loadChatList, 200);
  });
  $('btn-project-editor').addEventListener('click', () => window.violet.projects.openEditor());
  $('project-x').addEventListener('click', closeProject);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') { e.preventDefault(); toggleMode(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toggleSidebar(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); window.violet.projects.openEditor(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'm' && e.shiftKey) { e.preventDefault(); openMemory(); }
  });
  // Double-click the title bar to maximize (full mode)
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => {
    if (bodyEl.classList.contains('full') && !e.target.closest('button, select')) window.violet.win.maximize();
  });

  window.violet.win.onMode(applyModeUi);
  window.violet.win.onMaximized((m) => bodyEl.classList.toggle('maximized', m));
  window.violet.chats.onChanged(async () => {
    // The window always shows main's current chat, so follow its id (covers brand-new chats too)
    const c = await window.violet.chats.current();
    if (c) {
      currentChatId = c.id;
      titleChatEl.textContent = c.messages.length ? c.title : '';
      loadChatList();
    }
  });
  window.violet.memory.onChanged((m) => {
    if (m.added && m.added.length) toast(`🧠 Remembered: ${m.added[0]}`, 3500);
    else if (m.removed) toast('🧠 Forgot that');
    loadMemory();
  });
  window.violet.changes.onStatus(({ id, status }) => updateChangeCard(id, status));
  window.violet.projects.onChanged(renderProject);
}

async function initV2() {
  await init(); // renderer.js setup (themes, settings, voice…)
  setupV2();
  applyModeUi(settings.windowMode);
  const chat = await window.violet.chats.current();
  await renderChat(chat);
  currentChatId = chat.id;
  loadMemory();
  renderProject(await window.violet.projects.info());
}

// initV2() is started from v3.js
