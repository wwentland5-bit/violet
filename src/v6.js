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

  // ---------- Dashboard: drag widgets to rearrange ----------
  // Grab a widget by its title bar and drop it where you want it. The board
  // reflows live while you drag. Keyboard: focus a widget's button and press
  // Alt+Left / Alt+Right. Violet can move widgets too ("put the timer first").
  const grid = $('dash-grid');
  const orderedCards = () => [...grid.querySelectorAll('.widget-card')]
    .sort((a, b) => (Number(a.style.order) || 0) - (Number(b.style.order) || 0));
  const applyOrder = (cards) => cards.forEach((c, i) => { c.style.order = String(i); });
  const saveOrder = (cards) => window.violet.dashboard.reorder(cards.map(c => c.dataset.id));

  let drag = null; // { card, startX, startY, active, cards }
  grid.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('.w-head');
    if (!head || e.button !== 0 || e.target.closest('button, a, input, select, textarea')) return;
    const card = head.closest('.widget-card');
    drag = { card, startX: e.clientX, startY: e.clientY, active: false, pointerId: e.pointerId };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return; // a click, not a drag
      drag.active = true;
      drag.cards = orderedCards();
      document.body.classList.add('dragging-widget'); // stops iframes from eating the pointer
      drag.card.classList.add('dragging');
    }
    const over = document.elementsFromPoint(e.clientX, e.clientY)
      .map(el => el.closest && el.closest('.widget-card'))
      .find(c => c && c !== drag.card && grid.contains(c));
    if (!over) return;
    const r = over.getBoundingClientRect();
    // Left/top half of the target = drop before it, right/bottom half = after
    const after = (e.clientX - r.left) / r.width + (e.clientY - r.top) / r.height > 1;
    const cards = drag.cards.filter(c => c !== drag.card);
    const at = cards.indexOf(over) + (after ? 1 : 0);
    cards.splice(at, 0, drag.card);
    if (cards.some((c, i) => c !== drag.cards[i])) { drag.cards = cards; applyOrder(cards); }
  });

  const endDrag = () => {
    if (!drag) return;
    if (drag.active) {
      drag.card.classList.remove('dragging');
      document.body.classList.remove('dragging-widget');
      saveOrder(drag.cards);
      // Swallow only the click the browser fires right after this drop
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    }
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  grid.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const card = e.target.closest('.widget-card');
    if (!card) return;
    e.preventDefault(); e.stopPropagation();
    const cards = orderedCards();
    const i = cards.indexOf(card);
    const j = Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1)));
    if (i === j) return;
    cards.splice(i, 1); cards.splice(j, 0, card);
    applyOrder(cards);
    saveOrder(cards);
  });

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
