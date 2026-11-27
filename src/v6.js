// ============================================================
// Violet v6 (renderer)
//  • Dead YouTube links: dashboard tells you when it skipped one,
//    and YouTube links in chat are checked and struck through if
//    the video was removed, made private or its channel terminated.
//  • Wake-up message: Settings → Voice → Wake word.
//  • Settings changed by the main process (e.g. the new default
//    voice) are picked up live.
// Loaded after renderer.js / v2-v5.js, so it can use their globals
// ($, toast, settings, saveSettings, speaker).
// ============================================================
(function () {
  // ---------- Live settings from the main process ----------
  window.violet.settings.onChanged((s) => {
    if (s && typeof s === 'object') settings = s; // eslint-disable-line no-global-assign
    const field = $('set-wakegreeting');
    if (field && document.activeElement !== field) field.value = settings.wakeGreeting || '';
  });

  // ---------- Dashboard: a video was skipped ----------
  window.violet.dashboard.onBlocked((b) => {
    const msg = `Skipped "${b.title}": that video ${b.reason}.`;
    toast(msg, 6000);
    // In voice mode, say it too, once Violet has finished its answer
    if (window.dashActive) {
      const say = () => speaker.speak(`Heads up, that video ${b.reason}, so I didn't show it.`, settings).catch(() => {});
      if (speaker.speaking) setTimeout(say, 2500); else say();
    }
  });

  // ---------- Chat: mark dead YouTube links ----------
  const ytChecks = new Map(); // url -> Promise<result>
  const YT_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be|youtube-nocookie\.com)\//i;

  function checkLink(a) {
    const url = a.getAttribute('href') || '';
    if (!YT_RE.test(url) || a.dataset.yt) return;
    a.dataset.yt = 'checking';
    if (!ytChecks.has(url)) ytChecks.set(url, window.violet.youtube.check(url).catch(() => ({ ok: true })));
    ytChecks.get(url).then((r) => {
      if (!a.isConnected) return;
      a.dataset.yt = r.ok ? 'ok' : 'dead';
      if (r.ok) { if (r.title && !a.title) a.title = `${r.title}${r.author ? ` · ${r.author}` : ''}`; return; }
      a.classList.add('yt-dead');
      a.title = `Unavailable: this video ${r.reason}`;
      const note = document.createElement('span');
      note.className = 'yt-dead-note';
      note.textContent = '(unavailable)';
      a.after(note);
    });
  }

  // Dead links don't open; say why instead
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.yt-dead');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    toast(a.title || 'That video is unavailable.', 4000);
  }, true);

  const messages = $('messages');
  if (messages) {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      // Wait a beat: links re-render while a reply streams in
      setTimeout(() => {
        pending = false;
        messages.querySelectorAll('.msg:not(.streaming) a[href]').forEach(checkLink);
      }, 400);
    }).observe(messages, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  // ---------- Settings: wake-up message ----------
  function setupWakeGreeting() {
    const field = $('set-wakegreeting');
    if (!field) return;
    field.value = settings.wakeGreeting || '';
    field.addEventListener('change', () => saveSettings({ wakeGreeting: field.value.trim().slice(0, 600) }));
    $('btn-test-wake').addEventListener('click', async () => {
      await saveSettings({ wakeGreeting: field.value.trim().slice(0, 600) });
      const line = window.wakeGreetingLine();
      if (!line) { toast('No wake-up message set. Violet will just chime.'); return; }
      speaker.speak(line, settings).catch((err) => toast(`Voice: ${err.message}`, 4000));
    });
  }

  // ---------- Dashboard: free board ----------
  // Widgets sit anywhere. Drag one by its title bar, resize it from the
  // bottom-right corner, nudge it with Alt+Arrow keys. Violet can place them
  // too ("put the video top right"); named spots are turned into pixels here,
  // because only the panel knows how big the board is.
  const grid = $('dash-grid');
  const SIZE_W = { small: 260, medium: 340, large: 560 };
  const GAP = 14;
  const live = new Map(); // id -> widget data (latest from main)
  const pos = (el) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  const hits = (a, b) => a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
  const save = (id, p) => window.violet.dashboard.position(id, p);
  let topZ = 1;

  function cardsNow() { return [...grid.querySelectorAll('.widget-card')]; }

  /** First free spot for a card of this size, scanning top-to-bottom, left-to-right. */
  function freeSpot(w, h, taken, W) {
    for (let y = 0; y < 20000; y += 16) {
      for (let x = 0; x + w <= Math.max(W, w); x += 16) {
        const r = { x, y, w, h };
        if (!taken.some(t => hits(r, t))) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  /** Turn Violet's named spot into pixels. */
  function resolvePlace(place, w, h, taken, W) {
    const bottom = taken.reduce((m, t) => Math.max(m, t.y + t.h), 0);
    const midY = Math.max(0, Math.round((Math.max(bottom, h) - h) / 2));
    const cx = Math.max(0, Math.round((W - w) / 2)), rx = Math.max(0, W - w);
    const near = /^near:(w\d+)$/.exec(place || '');
    if (near) {
      const ref = live.get(near[1]) && grid.querySelector(`.widget-card[data-id="${near[1]}"]`);
      if (ref) {
        const r = pos(ref);
        if (r.x + r.w + GAP + w <= W) return { x: r.x + r.w + GAP, y: r.y };
        return { x: r.x, y: r.y + r.h + GAP };
      }
    }
    switch (place) {
      case 'top-left': return { x: 0, y: 0 };
      case 'top': return { x: cx, y: 0 };
      case 'top-right': return { x: rx, y: 0 };
      case 'left': return { x: 0, y: midY };
      case 'center': return { x: cx, y: midY };
      case 'right': return { x: rx, y: midY };
      case 'bottom-left': return { x: 0, y: bottom + GAP };
      case 'bottom': return { x: cx, y: bottom + GAP };
      case 'bottom-right': return { x: rx, y: bottom + GAP };
      default: return null;
    }
  }

  function fitBoard() {
    const bottom = cardsNow().reduce((m, c) => Math.max(m, c.offsetTop + c.offsetHeight), 0);
    grid.style.height = bottom ? `${bottom + 24}px` : '';
  }

  window.layoutFreeBoard = function (list) {
    list.forEach(w => live.set(w.id, w));
    for (const id of [...live.keys()]) if (!list.some(w => w.id === id)) live.delete(id);
    // A hidden board has no size: lay out (and save spots) only when it's on screen.
    // Opening the dashboard re-renders, which lands back here.
    if (!grid.offsetParent || !grid.clientWidth) return;
    const W = grid.clientWidth;
    const placed = [];
    const later = [];
    const dragging = drag && drag.card;
    list.forEach((w) => {
      const el = grid.querySelector(`.widget-card[data-id="${w.id}"]`);
      if (!el || el === dragging) { if (el) placed.push(pos(el)); return; }
      const width = Math.min(W, w.w || SIZE_W[w.size || 'medium'] || 340);
      el.style.width = `${width}px`;
      el.style.height = w.h ? `${w.h}px` : '';
      el.classList.toggle('fixed-h', !!w.h);
      el.style.zIndex = String(w.z || 1);
      topZ = Math.max(topZ, w.z || 1);
      if (w.x != null && w.y != null) {
        el.style.left = `${Math.max(0, Math.min(w.x, W - width))}px`; // keep it on a narrower board
        el.style.top = `${w.y}px`;
        placed.push(pos(el));
      } else later.push({ w, el, width });
    });
    // Named spots (from Violet) and brand-new widgets: find their pixels, then save
    for (const { w, el, width } of later) {
      const h = el.offsetHeight;
      let spot = resolvePlace(w.place, width, h, placed, W);
      if (spot) {
        // Named spot already taken: slide down that column to the first free space
        while (placed.some(t => hits({ x: spot.x, y: spot.y, w: width, h }, t)) && spot.y < 20000) spot.y += 16;
      } else spot = freeSpot(width, h, placed, W);
      el.style.left = `${spot.x}px`;
      el.style.top = `${spot.y}px`;
      placed.push({ x: spot.x, y: spot.y, w: width, h });
      save(w.id, { x: spot.x, y: spot.y, clearPlace: true });
    }
    fitBoard();
  };
  // Re-fit when the panel changes width (full window <-> panel)
  new ResizeObserver(() => { if (window.dashActive && live.size) window.layoutFreeBoard([...live.values()]); }).observe(grid);

  // ----- Drag to move, corner to resize -----
  let drag = null; // { card, mode: 'move'|'size', sx, sy, x, y, w, h, active }
  grid.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const grip = e.target.closest('.w-resize');
    const head = e.target.closest('.w-head');
    if (!grip && (!head || e.target.closest('button, a, input, select, textarea'))) return;
    const card = e.target.closest('.widget-card');
    const r = pos(card);
    drag = { card, mode: grip ? 'size' : 'move', sx: e.clientX, sy: e.clientY, ...r, active: false };
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 4) return; // a click, not a drag
      drag.active = true;
      document.body.classList.add('dragging-widget'); // iframes stop eating the pointer
      drag.card.classList.add('dragging');
      drag.card.style.zIndex = String(++topZ); // bring to front
    }
    const W = grid.clientWidth;
    if (drag.mode === 'move') {
      drag.card.style.left = `${Math.max(0, Math.min(W - drag.w, drag.x + dx))}px`;
      drag.card.style.top = `${Math.max(0, drag.y + dy)}px`;
    } else {
      drag.card.style.width = `${Math.max(200, Math.min(W - drag.x, drag.w + dx))}px`;
      drag.card.style.height = `${Math.max(120, drag.h + dy)}px`;
      drag.card.classList.add('fixed-h');
    }
    fitBoard();
  });

  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    d.card.classList.remove('dragging');
    document.body.classList.remove('dragging-widget');
    const r = pos(d.card);
    save(d.card.dataset.id, d.mode === 'move'
      ? { x: r.x, y: r.y, z: Number(d.card.style.zIndex) || topZ }
      : { w: r.w, h: r.h, z: Number(d.card.style.zIndex) || topZ });
    // Swallow only the click the browser fires right after this drop
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  // Keyboard: focus a widget's button, then Alt+Arrow nudges it (Shift = bigger steps)
  grid.addEventListener('keydown', (e) => {
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!e.altKey || !dirs[e.key]) return;
    const card = e.target.closest('.widget-card');
    if (!card) return;
    e.preventDefault(); e.stopPropagation();
    const step = e.shiftKey ? 64 : 16;
    const r = pos(card);
    const x = Math.max(0, Math.min(grid.clientWidth - r.w, r.x + dirs[e.key][0] * step));
    const y = Math.max(0, r.y + dirs[e.key][1] * step);
    card.style.left = `${x}px`; card.style.top = `${y}px`;
    fitBoard();
    save(card.dataset.id, { x, y });
  });

  $('dash-tidy').addEventListener('click', () => window.violet.dashboard.tidy());

  // Refill the field every time the Voice settings are shown (fillVoiceSettings
  // is renderer.js's global; calls to it resolve to this wrapper)
  const fillVoiceBase = window.fillVoiceSettings;
  if (typeof fillVoiceBase === 'function') {
    fillVoiceSettings = async function () { // eslint-disable-line no-global-assign
      const r = await fillVoiceBase.apply(this, arguments);
      const field = $('set-wakegreeting');
      if (field && settings && document.activeElement !== field) field.value = settings.wakeGreeting || '';
      return r;
    };
  }

  let v6Ready = false;
  window.setupV6 = function () { if (v6Ready) return; v6Ready = true; setupWakeGreeting(); };
})();
