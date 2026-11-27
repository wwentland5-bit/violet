// ============================================================
// Violet v3 UI: Memory Tree + Voice Dashboard (AI-controlled widgets)
// Loaded after renderer.js and v2.js; shares their globals.
// ============================================================
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// Branch colors + names for the memory tree
const CATS = {
  about: { label: 'About you', color: '#f0abfc' },
  preferences: { label: 'Preferences', color: '#a78bfa' },
  projects: { label: 'Projects', color: '#60a5fa' },
  tech: { label: 'Tech', color: '#22d3ee' },
  hobbies: { label: 'Hobbies', color: '#4ade80' },
  people: { label: 'People', color: '#fbbf24' },
  places: { label: 'Places', color: '#fb7185' },
  other: { label: 'Other', color: '#94a3b8' }
};

// ============================================================
// Views: add the dashboard to v2's view switcher
// ============================================================
const dashView = $('dashboard-view');
const v2ShowView = window.showView;
window.showView = function (name) {
  dashView.hidden = name !== 'dashboard';
  $('nav-dashboard').classList.toggle('active', name === 'dashboard');
  window.dashActive = name === 'dashboard';
  appEl.classList.toggle('dash-on', window.dashActive);
  v2ShowView(name === 'dashboard' ? '__none' : name); // hides chat/memory/settings
  if (name === 'dashboard') { chatView.hidden = true; composer.hidden = true; }
};

// ============================================================
// MEMORY TREE
// A radial mind map: you in the middle, branches for each
// category, and every memory as a leaf. Drag to pan, scroll to
// zoom, hover a leaf to read it, click to edit.
// ============================================================
let memViewMode = 'tree';
const tree = { k: 1, tx: 0, ty: 0, selected: null };
const treeSvg = $('tree-svg');
const treeVp = $('tree-viewport');

const renderMemoryList = window.renderMemory; // v2's list view
window.renderMemory = function () {
  const isTree = memViewMode === 'tree';
  $('mem-tree').hidden = !isTree;
  $('memory-list').hidden = isTree;
  document.querySelectorAll('#mem-viewtoggle button').forEach(b => b.classList.toggle('active', b.dataset.mv === memViewMode));
  if (isTree) renderTree(); else renderMemoryList();
};

function applyTreeTransform() {
  treeVp.setAttribute('transform', `translate(${tree.tx},${tree.ty}) scale(${tree.k})`);
}

function fitTree(animate = true) {
  const box = $('mem-tree').getBoundingClientRect();
  let bb;
  try { bb = treeVp.getBBox(); } catch { return; }
  if (!bb.width || !box.width) return;
  // getBBox is in viewport space, so remove the current transform first
  const pad = 40;
  const k = Math.min(1.4, Math.min((box.width - pad * 2) / bb.width, (box.height - pad * 2) / bb.height));
  tree.k = Math.max(0.25, k);
  tree.tx = box.width / 2 - (bb.x + bb.width / 2) * tree.k;
  tree.ty = box.height / 2 - (bb.y + bb.height / 2) * tree.k;
  treeVp.style.transition = animate ? 'transform 0.4s ease' : 'none';
  applyTreeTransform();
  setTimeout(() => { treeVp.style.transition = 'none'; }, 420);
}

function curve(x1, y1, x2, y2, bend = 0.25) {
  // Gentle curve that bows outward from the center
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  return `M${x1},${y1} Q${mx - dy * bend},${my + dx * bend} ${x2},${y2}`;
}

function renderTree() {
  treeVp.innerHTML = '';
  $('tree-tip').hidden = true;
  const q = $('memory-search').value.trim().toLowerCase();
  const groups = Object.keys(CATS)
    .map(c => ({ cat: c, items: memoryItems.filter(m => (m.category || 'other') === c) }))
    .filter(g => g.items.length);

  // Legend
  const legend = $('tree-legend');
  legend.innerHTML = '';
  for (const g of groups) {
    const it = h('span', 'lg');
    it.style.setProperty('--c', CATS[g.cat].color);
    it.textContent = `${CATS[g.cat].label} ${g.items.length}`;
    legend.append(it);
  }

  const linksG = svgEl('g', { class: 'links' });
  const nodesG = svgEl('g', { class: 'nodes' });
  treeVp.append(linksG, nodesG);

  // Center node: you
  const core = svgEl('g', { class: 'tnode core' });
  core.append(svgEl('circle', { r: 46, class: 'core-halo' }), svgEl('circle', { r: 34, fill: 'url(#tg-core)', filter: 'url(#tg-glow)' }));
  const coreLabel = svgEl('text', { y: 62, 'text-anchor': 'middle', class: 'core-label' });
  coreLabel.textContent = 'You';
  core.append(coreLabel);
  nodesG.append(core);

  if (!groups.length) {
    const t = svgEl('text', { y: 110, 'text-anchor': 'middle', class: 'tree-empty' });
    t.textContent = 'No memories yet. Tell Violet about yourself!';
    nodesG.append(t);
    requestAnimationFrame(() => fitTree(false));
    return;
  }

  const n = groups.length;
  const span = (Math.PI * 2) / n;
  const R1 = n <= 3 ? 150 : 175;
  let delay = 0;

  groups.forEach((g, gi) => {
    const color = CATS[g.cat].color;
    const a = -Math.PI / 2 + gi * span;
    const cx = Math.cos(a) * R1, cy = Math.sin(a) * R1;

    const link = svgEl('path', { d: curve(0, 0, cx, cy, 0.12), class: 'tlink trunk', stroke: color, pathLength: 1 });
    link.style.animationDelay = `${delay}ms`;
    linksG.append(link);

    // Leaves: fan out inside this branch's slice; big branches use two rings
    const k = g.items.length;
    const twoRings = k > 7;
    const perRing = twoRings ? Math.ceil(k / 2) : k;
    const maxSpread = span * 0.82;
    g.items.forEach((m, j) => {
      const ring = twoRings ? j % 2 : 0;
      const idx = twoRings ? Math.floor(j / 2) : j;
      const count = twoRings ? (ring === 0 ? perRing : k - perRing) : k;
      const step = Math.min(maxSpread / Math.max(1, count), 0.42);
      const la = a + (idx - (count - 1) / 2) * step + (ring ? step / 2 : 0);
      const R2 = R1 + 125 + ring * 85;
      const lx = Math.cos(la) * R2, ly = Math.sin(la) * R2;
      const match = !q || m.text.toLowerCase().includes(q);

      const leafLink = svgEl('path', { d: curve(cx, cy, lx, ly, 0.18), class: 'tlink twig' + (match ? '' : ' dim'), stroke: color, pathLength: 1 });
      leafLink.style.animationDelay = `${delay + 250 + j * 40}ms`;
      linksG.append(leafLink);

      const leaf = svgEl('g', { class: 'tnode leaf' + (match ? '' : ' dim') + (q && match ? ' hit' : ''), transform: `translate(${lx},${ly})` });
      leaf.style.setProperty('--c', color);
      leaf.style.animationDelay = `${delay + 350 + j * 40}ms`;
      const dot = svgEl('circle', { r: m.source === 'violet' ? 7 : 8, fill: color, class: 'leaf-dot' + (m.source === 'violet' ? '' : ' manual') });
      const right = Math.cos(la) >= 0;
      const label = svgEl('text', { x: right ? 14 : -14, y: 4, 'text-anchor': right ? 'start' : 'end', class: 'leaf-label' });
      label.textContent = m.text.length > 30 ? m.text.slice(0, 29) + '…' : m.text;
      leaf.append(svgEl('circle', { r: 16, class: 'leaf-hit' }), dot, label);
      leaf.addEventListener('mouseenter', (e) => showTip(e, m, color, leaf, leafLink, link));
      leaf.addEventListener('mousemove', moveTip);
      leaf.addEventListener('mouseleave', hideTip);
      leaf.addEventListener('click', (e) => { e.stopPropagation(); openDetail(m); });
      nodesG.append(leaf);
    });

    // Branch node (drawn after leaves so it sits on top)
    const br = svgEl('g', { class: 'tnode branch', transform: `translate(${cx},${cy})` });
    br.style.setProperty('--c', color);
    br.style.animationDelay = `${delay + 120}ms`;
    br.append(svgEl('circle', { r: 30, class: 'branch-halo', fill: color }), svgEl('circle', { r: 22, class: 'branch-dot', fill: color }));
    const cnt = svgEl('text', { y: 5, 'text-anchor': 'middle', class: 'branch-count' });
    cnt.textContent = g.items.length;
    const bl = svgEl('text', { y: Math.sin(a) > 0.3 ? 44 : -34, 'text-anchor': 'middle', class: 'branch-label' });
    bl.textContent = CATS[g.cat].label;
    br.append(cnt, bl);
    nodesG.append(br);
    delay += 90;
  });

  requestAnimationFrame(() => fitTree(false));
}

// ----- Tooltip + highlight -----
function showTip(e, m, color, leaf, twig, trunk) {
  const tip = $('tree-tip');
  tip.innerHTML = '';
  const t = h('div', 'tt-text', m.text);
  const meta = h('div', 'tt-meta', `${CATS[m.category || 'other'].label} · ${m.source === 'violet' ? 'Violet saved' : 'You added'} · ${timeAgo(m.edited || m.created)}`);
  tip.append(t, meta);
  tip.style.setProperty('--c', color);
  tip.hidden = false;
  moveTip(e);
  treeSvg.classList.add('focus');
  [leaf, twig, trunk].forEach(x => x.classList.add('hl'));
  tip._hl = [leaf, twig, trunk];
}
function moveTip(e) {
  const tip = $('tree-tip');
  const box = $('mem-tree').getBoundingClientRect();
  let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
  if (x + 280 > box.width) x -= 300;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideTip() {
  const tip = $('tree-tip');
  tip.hidden = true;
  treeSvg.classList.remove('focus');
  (tip._hl || []).forEach(x => x.classList.remove('hl'));
}

// ----- Detail editor -----
function openDetail(m) {
  tree.selected = m;
  const cat = m.category || 'other';
  $('td-dot').style.background = CATS[cat].color;
  $('td-cat').textContent = CATS[cat].label;
  $('td-text').value = m.text;
  $('td-catsel').value = cat;
  $('td-meta').textContent = `${m.source === 'violet' ? 'Violet saved' : 'You added'} · ${timeAgo(m.edited || m.created)}`;
  $('tree-detail').hidden = false;
  $('td-text').focus();
}

// ----- Pan & zoom -----
function setupTreeInteractions() {
  let drag = null;
  treeSvg.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.leaf')) return;
    drag = { x: e.clientX, y: e.clientY, tx: tree.tx, ty: tree.ty };
    treeSvg.setPointerCapture(e.pointerId);
    treeSvg.classList.add('dragging');
  });
  treeSvg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    tree.tx = drag.tx + (e.clientX - drag.x);
    tree.ty = drag.ty + (e.clientY - drag.y);
    applyTreeTransform();
  });
  const end = () => { drag = null; treeSvg.classList.remove('dragging'); };
  treeSvg.addEventListener('pointerup', end);
  treeSvg.addEventListener('pointercancel', end);
  treeSvg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const box = $('mem-tree').getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - box.left, e.clientY - box.top);
  }, { passive: false });
  treeSvg.addEventListener('click', (e) => { if (!e.target.closest('.leaf')) $('tree-detail').hidden = true; });

  $('tree-zoom-in').addEventListener('click', () => { const b = $('mem-tree').getBoundingClientRect(); zoomAt(1.25, b.width / 2, b.height / 2); });
  $('tree-zoom-out').addEventListener('click', () => { const b = $('mem-tree').getBoundingClientRect(); zoomAt(0.8, b.width / 2, b.height / 2); });
  $('tree-fit').addEventListener('click', () => fitTree(true));
  window.addEventListener('resize', () => { if (!$('mem-tree').hidden) fitTree(false); });

  $('td-close').addEventListener('click', () => { $('tree-detail').hidden = true; });
  $('td-save').addEventListener('click', async () => {
    const m = tree.selected;
    if (!m) return;
    await window.violet.memory.update(m.id, $('td-text').value, $('td-catsel').value);
    $('tree-detail').hidden = true;
    toast('Memory updated');
    loadMemory();
  });
  $('td-delete').addEventListener('click', async () => {
    const m = tree.selected;
    if (!m) return;
    await window.violet.memory.remove(m.id);
    $('tree-detail').hidden = true;
    loadMemory();
  });
  $('td-text').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('tree-detail').hidden = true; } });

  document.querySelectorAll('#mem-viewtoggle button').forEach(b => b.addEventListener('click', async () => {
    memViewMode = b.dataset.mv;
    await saveSettings({ memoryView: memViewMode });
    window.renderMemory();
  }));
}

function zoomAt(f, x, y) {
  const k = Math.max(0.25, Math.min(3, tree.k * f));
  const real = k / tree.k;
  tree.tx = x - (x - tree.tx) * real;
  tree.ty = y - (y - tree.ty) * real;
  tree.k = k;
  applyTreeTransform();
}

// Adding a memory: send the chosen branch too
window.addMemory = async function () {
  const input = $('memory-input');
  const v = input.value.trim();
  if (!v) return;
  const item = await window.violet.memory.add(v, $('memory-cat').value || null);
  if (!item) toast('Already remembered (or empty).');
  input.value = '';
  loadMemory();
};

// List view: show the branch on each card
const v2MemoryCard = window.memoryCard;
window.memoryCard = function (m) {
  const card = v2MemoryCard(m);
  const cat = CATS[m.category || 'other'];
  const chip = h('span', 'mem-cat', cat.label);
  chip.style.setProperty('--c', cat.color);
  card.querySelector('.mem-meta').prepend(chip);
  return card;
};

// ============================================================
// VOICE DASHBOARD
// Talk to Violet; it answers out loud and can add/remove widgets
// (websites, videos, articles, notes, images, lists, timers, links).
// ============================================================
window.dashActive = false;
let speechInterrupted = false;
let capVioletRaw = '';
const widgetEls = new Map();      // id -> { el, sig }
const timersDone = new Set();

function openDashboard() {
  if (control || browse || look) { control = false; browse = false; look = false; updateModeUi(); }
  showView('dashboard');
  loadWidgets();
  $('dash-handsfree').checked = settings.dashHandsFree !== false;
  if (bodyEl.classList.contains('panel')) toast('Tip: press F11 for full window, the dashboard loves space');
}

function closeDashboard() {
  speaker.stop();
  if (listening) cancelListening();
  showView('chat');
}

// ----- Orb + state -----
function dashTick() {
  if (!window.dashActive) return;
  const st = appEl.classList.contains('listening') ? 'listening'
    : appEl.classList.contains('transcribing') ? 'transcribing'
      : appEl.classList.contains('speaking') ? 'speaking'
        : appEl.classList.contains('busy') ? 'thinking' : 'idle';
  const orb = $('dash-orb');
  orb.dataset.state = st;
  $('dash-state').textContent = {
    idle: settings.wakeWord ? 'Tap the orb or say "Hey Violet"' : 'Tap the orb and start talking',
    listening: 'Listening…',
    transcribing: 'Got it…',
    thinking: 'Thinking…',
    speaking: 'Speaking… (tap to stop)'
  }[st];
  // Bars react to your voice while listening, and "talk" while Violet speaks
  const level = parseFloat(micBtn.style.getPropertyValue('--level')) || 0;
  const t = performance.now() / 1000;
  const radius = bodyEl.classList.contains('panel') ? 90 : 112;
  document.querySelectorAll('#dash-bars i').forEach((bar, i) => {
    let v = 0.08;
    if (st === 'listening') v = 0.1 + level * (0.6 + 0.4 * Math.sin(i * 1.7 + t * 9));
    else if (st === 'speaking') v = 0.25 + 0.35 * Math.abs(Math.sin(i * 0.9 + t * 7) * Math.cos(i * 0.3 + t * 3));
    else if (st === 'thinking' || st === 'transcribing') v = 0.12 + 0.1 * (Math.sin(i * 0.5 - t * 6) + 1) / 2;
    bar.style.transform = `rotate(${i * 9}deg) translateY(-${radius}px) scaleY(${Math.max(0.05, Math.min(1, v)).toFixed(3)})`;
  });
  requestAnimationFrame(dashTick);
}

// ----- Captions (what you said / what Violet says) -----
const sendMessageBase = window.sendMessage;
window.sendMessage = async function (text, opts = {}) {
  if (window.dashActive && text && text.trim()) {
    $('cap-you').textContent = text.trim();
    capVioletRaw = '';
    $('cap-violet').textContent = '';
  }
  return sendMessageBase(text, opts);
};
window.violet.chat.onEvent((ev) => {
  if (!window.dashActive) return;
  if (ev.type === 'delta') {
    capVioletRaw += ev.text;
    const shown = displayText(capVioletRaw).replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
    $('cap-violet').textContent = shown.length > 280 ? '…' + shown.slice(-280) : shown;
  } else if (ev.type === 'error') {
    $('cap-violet').textContent = 'Something went wrong. Check the chat for details.';
  }
});

// ----- Always speak in the dashboard, and keep the conversation going (hands-free) -----
const maybeSpeakBase = window.maybeSpeak;
window.maybeSpeak = function (msg) {
  if (!window.dashActive) return maybeSpeakBase(msg);
  const p = speaker.speak(msg.raw, settings);
  speechInterrupted = false; // speak() stops old audio first, so reset after
  p.catch(err => toast(`Voice: ${err.message}`, 3500)).finally(() => {
    if (window.dashActive && settings.dashHandsFree !== false && !speechInterrupted && lastInputVoice) {
      setTimeout(() => { if (window.dashActive && !busy && !listening && !speaker.speaking) toggleListening(); }, 350);
    }
  });
};
const speakerStopBase = speaker.stop.bind(speaker);
speaker.stop = function () { speechInterrupted = true; speakerStopBase(); };

// ----- Widgets -----
const ICONS = { website: '🌐', video: '▶️', article: '📰', note: '📝', image: '🖼️', list: '✅', timer: '⏱️', link: '🔗' };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function embedFor(url) {
  try {
    const u = new URL(url);
    const hn = u.hostname.replace(/^www\.|^m\./, '');
    let id = null;
    if (hn === 'youtu.be') id = u.pathname.slice(1);
    else if (hn.endsWith('youtube.com')) id = u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1];
    if (id) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id.replace(/[^\w-]/g, '')}?rel=0&modestbranding=1` };
    const vm = hn === 'vimeo.com' && u.pathname.match(/^\/(\d+)/);
    if (vm) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u.pathname)) return { kind: 'video', src: url };
    return { kind: 'iframe', src: url };
  } catch { return null; }
}

function frame(src) {
  const f = document.createElement('iframe');
  f.src = src;
  // Sandboxed: the site runs, but can't touch Violet or navigate its window
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation');
  f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
  f.setAttribute('allowfullscreen', '');
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  f.loading = 'lazy';
  return f;
}

function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? `${hh}:${String(mm).padStart(2, '0')}` : String(mm)) + ':' + String(ss).padStart(2, '0');
}

function widgetBody(w) {
  const body = h('div', 'w-body');
  switch (w.type) {
    case 'website': {
      body.append(frame(w.url));
      const note = h('div', 'w-hint', 'Blank? Some sites block embedding. Use ↗ to open it in Violet\'s browser.');
      body.append(note);
      break;
    }
    case 'video': {
      const e = embedFor(w.url);
      if (e && e.kind === 'video') {
        const v = document.createElement('video');
        v.src = e.src; v.controls = true; v.preload = 'metadata';
        body.append(v);
      } else if (e) body.append(frame(e.src));
      break;
    }
    case 'article': {
      const m = w.meta || {};
      if (m.image) { const img = document.createElement('img'); img.src = m.image; img.className = 'w-cover'; img.onerror = () => img.remove(); body.append(img); }
      const inner = h('div', 'w-article');
      inner.append(h('div', 'w-site', m.site || host(w.url)));
      inner.append(h('div', 'w-headline', m.title || w.title));
      if (w.loading) inner.append(h('div', 'w-muted', 'Loading article…'));
      const summary = w.summary || m.description;
      if (summary) inner.append(h('div', 'w-summary', summary));
      if (m.excerpt) {
        const ex = h('details', 'w-excerpt');
        ex.append(h('summary', '', 'Read excerpt'), h('div', '', m.excerpt));
        inner.append(ex);
      }
      const read = h('button', 'btn small', 'Read full article');
      read.addEventListener('click', () => window.violet.dashboard.open(w.url));
      inner.append(read);
      body.append(inner);
      break;
    }
    case 'note': {
      const n = h('div', 'w-note');
      n.innerHTML = window.renderMarkdown(w.text || '');
      body.append(n);
      break;
    }
    case 'image': {
      const img = document.createElement('img');
      img.src = w.url;
      img.className = 'w-image';
      img.addEventListener('click', () => window.violet.dashboard.open(w.url));
      body.append(img);
      break;
    }
    case 'list': {
      const ul = h('div', 'w-list');
      (w.items || []).forEach((it, i) => {
        const row = h('label', 'w-item' + (it.done ? ' done' : ''));
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!it.done;
        cb.addEventListener('change', () => window.violet.dashboard.toggleItem(w.id, i));
        row.append(cb, h('span', '', it.text));
        ul.append(row);
      });
      body.append(ul);
      break;
    }
    case 'timer': {
      const t = h('div', 'w-timer');
      t.dataset.ends = w.endsAt;
      t.dataset.duration = w.duration;
      t.dataset.id = w.id;
      if (w.pausedLeft != null) t.dataset.pausedLeft = w.pausedLeft;
      t.innerHTML = '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="tr-bg"/><circle cx="60" cy="60" r="52" class="tr-fg" pathLength="100"/></svg><div class="tr-time"></div>';
      // Controls: pause/resume, +1 minute, restart (Violet can do the same by voice)
      const ctl = h('div', 'tr-controls');
      const tb = (label, op) => {
        const b = h('button', 'tr-btn', label);
        b.addEventListener('click', (e) => { e.stopPropagation(); window.violet.dashboard.timer(w.id, op); });
        return b;
      };
      const paused = w.pausedLeft != null;
      const finished = !paused && w.endsAt <= Date.now();
      if (!finished) ctl.append(tb(paused ? 'Resume' : 'Pause', paused ? 'resume' : 'pause'));
      ctl.append(tb('+1 min', 'add1'), tb('Restart', 'restart'));
      body.append(t, ctl);
      break;
    }
    case 'link': {
      const a = h('button', 'w-link');
      const fav = document.createElement('img');
      fav.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host(w.url))}&sz=64`;
      fav.onerror = () => fav.remove();
      const txt = h('div', '');
      txt.append(h('div', 'w-headline', w.title), h('div', 'w-site', host(w.url)));
      a.append(fav, txt);
      a.addEventListener('click', () => window.violet.dashboard.open(w.url));
      body.append(a);
      break;
    }
  }
  return body;
}

function widgetCard(w) {
  const card = h('div', `widget-card size-${w.size || 'medium'} type-${w.type}`);
  card.dataset.id = w.id;
  const head = h('div', 'w-head');
  const title = (w.title === w.type && w.meta && w.meta.title) ? w.meta.title : w.title;
  head.append(h('span', 'w-icon', ICONS[w.type] || '◆'), h('span', 'w-title', title));
  const actions = h('div', 'w-actions');
  const btn = (label, txt, fn) => { const b = h('button', '', txt); b.title = label; b.addEventListener('click', fn); return b; };
  if (w.url) actions.append(btn('Open in Violet\'s browser', '↗', () => window.violet.dashboard.open(w.url)));
  actions.append(btn('Change size', '⤢', () => {
    const order = ['small', 'medium', 'large'];
    window.violet.dashboard.resize(w.id, order[(order.indexOf(w.size || 'medium') + 1) % 3]);
  }));
  actions.append(btn('Remove', '×', () => window.violet.dashboard.remove(w.id)));
  head.append(actions);
  card.append(head, widgetBody(w));
  return card;
}

// Keyed render: unchanged widgets keep their element, so videos don't restart
function renderWidgets(list) {
  const grid = $('dash-grid');
  const seen = new Set();
  list.forEach((w, i) => {
    seen.add(w.id);
    const sig = JSON.stringify(w);
    let entry = widgetEls.get(w.id);
    if (!entry || entry.sig !== sig) {
      const el = widgetCard(w);
      if (entry) entry.el.replaceWith(el); else el.classList.add('enter');
      entry = { el, sig };
      widgetEls.set(w.id, entry);
    }
    if (grid.children[i] !== entry.el) grid.insertBefore(entry.el, grid.children[i] || null);
  });
  for (const [id, entry] of widgetEls) if (!seen.has(id)) { entry.el.remove(); widgetEls.delete(id); }
  $('dash-empty').hidden = list.length > 0;
  $('widget-count').textContent = list.length ? String(list.length) : '';
  tickTimers();
}

async function loadWidgets() { renderWidgets(await window.violet.dashboard.list()); }

function tickTimers() {
  document.querySelectorAll('.w-timer').forEach(t => {
    const paused = t.dataset.pausedLeft !== undefined;
    const left = paused ? Number(t.dataset.pausedLeft) : (Number(t.dataset.ends) - Date.now()) / 1000;
    const total = Number(t.dataset.duration) || 1;
    t.classList.toggle('paused', paused);
    if (left > 0) timersDone.delete(t.dataset.id); // restarted / extended timers can ring again
    t.querySelector('.tr-time').textContent = left > 0 ? fmtTime(left) : 'Done';
    t.querySelector('.tr-fg').style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, (left / total) * 100)));
    t.classList.toggle('done', left <= 0);
    if (!paused && left <= 0 && !timersDone.has(t.dataset.id)) {
      timersDone.add(t.dataset.id);
      if (Date.now() - Number(t.dataset.ends) < 5000) { // only alert for timers that just finished
        const title = t.closest('.widget-card').querySelector('.w-title').textContent;
        VV.chime(); setTimeout(() => VV.chime(), 400);
        toast(`⏱️ ${title} is done!`, 5000);
        if (!speaker.speaking) speaker.speak(`${title} is done.`, settings).catch(() => {});
      }
    }
  });
}

// ============================================================
// Wiring
// ============================================================
function setupV3() {
  setupTreeInteractions();
  memViewMode = settings.memoryView === 'list' ? 'list' : 'tree';

  $('btn-dashboard').addEventListener('click', () => (dashView.hidden ? openDashboard() : closeDashboard()));
  $('nav-dashboard').addEventListener('click', () => (dashView.hidden ? openDashboard() : closeDashboard()));
  $('dash-close').addEventListener('click', closeDashboard);
  $('dash-orb').addEventListener('click', () => {
    if (speaker.speaking) { speaker.stop(); return; }
    toggleListening();
  });
  $('dash-handsfree').addEventListener('change', (e) => saveSettings({ dashHandsFree: e.target.checked }));
  $('dash-clear').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1'; b.textContent = 'Click again to clear';
      setTimeout(() => { b.dataset.confirm = ''; b.textContent = 'Clear widgets'; }, 3000);
      return;
    }
    b.dataset.confirm = ''; b.textContent = 'Clear widgets';
    await window.violet.dashboard.clear();
  });
  window.violet.dashboard.onChanged(renderWidgets);
  setInterval(tickTimers, 500);

  // Esc leaves the dashboard; Space talks (when you're not typing somewhere)
  window.addEventListener('keydown', (e) => {
    if (!window.dashActive) {
      if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openDashboard(); }
      return;
    }
    if (!$('palette').hidden) return; // the command palette handles its own keys
    // stopPropagation: keep renderer.js's Esc (which hides the window) from also running
    if (e.key === 'Escape' && !speaker.speaking && !listening) { e.preventDefault(); e.stopPropagation(); closeDashboard(); }
    else if (e.code === 'Space' && !e.target.closest('input, textarea, select, button')) { e.preventDefault(); e.stopPropagation(); $('dash-orb').click(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); closeDashboard(); }
  }, true);

  // Keep the orb animation loop running only while the dashboard is open
  new MutationObserver(() => { if (window.dashActive) requestAnimationFrame(dashTick); })
    .observe(dashView, { attributes: true, attributeFilter: ['hidden'] });
}

// Startup lives in v4.js (it runs initV2 -> setupV3 -> setupV4)
