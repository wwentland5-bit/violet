// ============================================================
// Violet Browser - toolbar logic (tabs, address bar, buttons)
// ============================================================
const $ = (id) => document.getElementById(id);
const tabsEl = $('tabs');
const address = $('address');
let state = { tabs: [], activeId: null };
let editing = false; // don't overwrite the address bar while you're typing

// Tabs are updated IN PLACE (keyed by id). Rebuilding them on every state
// update destroyed the × button between mouse-down and mouse-up, so its
// click never fired and tabs couldn't be closed.
const tabEls = new Map(); // id -> { el, fav, favKey, title, x }

function makeTab(id) {
  const el = document.createElement('div');
  el.className = 'tab';
  const title = document.createElement('span');
  title.className = 'title';
  const x = document.createElement('button');
  x.className = 'x';
  x.title = 'Close tab (Ctrl+W)';
  x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  // Close on click; mousedown on × must NOT also activate the tab
  x.addEventListener('mousedown', (e) => e.stopPropagation());
  x.addEventListener('click', (e) => { e.stopPropagation(); window.vbrowser.closeTab(id); });
  el.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); window.vbrowser.closeTab(id); } // middle-click closes
    else if (e.button === 0) window.vbrowser.activate(id);
  });
  el.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }); // no autoscroll icon
  const fav = document.createElement('span');
  fav.className = 'fav';
  el.append(fav, title, x);
  return { el, fav, favKey: '', title, x };
}

function renderTabs() {
  const seen = new Set();
  state.tabs.forEach((t, i) => {
    seen.add(t.id);
    let r = tabEls.get(t.id);
    if (!r) { r = makeTab(t.id); tabEls.set(t.id, r); }
    r.el.classList.toggle('active', t.id === state.activeId);
    r.el.title = t.title || '';
    const name = t.title || 'New tab';
    if (r.title.textContent !== name) r.title.textContent = name;
    // Favicon: only swap the element when it actually changes
    const useImg = t.favicon && !t.loading && /^https?:|^data:/.test(t.favicon);
    const key = useImg ? `img:${t.favicon}` : (t.loading ? 'loading' : 'blank');
    if (key !== r.favKey) {
      let fav;
      if (useImg) {
        fav = document.createElement('img');
        fav.src = t.favicon;
        fav.onerror = () => fav.replaceWith(Object.assign(document.createElement('span'), { className: 'fav' }));
      } else {
        fav = document.createElement('span');
        fav.className = 'fav' + (t.loading ? ' loading' : '');
      }
      r.fav.replaceWith(fav);
      r.fav = fav;
      r.favKey = key;
    }
    if (tabsEl.children[i] !== r.el) tabsEl.insertBefore(r.el, tabsEl.children[i] || null);
  });
  for (const [id, r] of tabEls) if (!seen.has(id)) { r.el.remove(); tabEls.delete(id); }
}

function renderNav() {
  const tab = state.tabs.find(t => t.id === state.activeId);
  $('btn-back').disabled = !state.canBack;
  $('btn-fwd').disabled = !state.canFwd;
  $('btn-reload').classList.toggle('loading', !!(tab && tab.loading));
  $('loadbar').classList.toggle('on', !!(tab && tab.loading));
  if (!editing) address.value = tab ? tab.url : '';
  $('lock').classList.toggle('secure', !!(tab && tab.url.startsWith('https://')));
  document.title = tab ? `${tab.title} - Violet Browser` : 'Violet Browser';
}

window.vbrowser.onState((s) => { state = s; renderTabs(); renderNav(); });
window.vbrowser.onTheme((t) => window.applyThemeColors(t));
window.vbrowser.onFocusAddress(() => { address.focus(); address.select(); });

$('address-form').addEventListener('submit', (e) => {
  e.preventDefault();
  editing = false;
  window.vbrowser.navigate(address.value);
  address.blur();
});
address.addEventListener('focus', () => { editing = true; address.select(); });
address.addEventListener('blur', () => { editing = false; renderNav(); });
address.addEventListener('keydown', (e) => { if (e.key === 'Escape') { address.blur(); } });

$('btn-newtab').addEventListener('click', () => window.vbrowser.newTab());
$('btn-back').addEventListener('click', () => window.vbrowser.back());
$('btn-fwd').addEventListener('click', () => window.vbrowser.forward());
$('btn-reload').addEventListener('click', () => window.vbrowser.reload());
$('btn-home').addEventListener('click', () => window.vbrowser.home());
$('btn-ask').addEventListener('click', () => window.vbrowser.ask());
$('btn-min').addEventListener('click', () => window.vbrowser.minimize());
$('btn-max').addEventListener('click', () => window.vbrowser.maximize());
$('btn-close').addEventListener('click', () => window.vbrowser.close());
document.querySelector('.tabbar').addEventListener('dblclick', (e) => {
  if (e.target.classList.contains('drag-space') || e.target.classList.contains('tabbar')) window.vbrowser.maximize();
});

// ---------- Violet driving ----------
window.vbrowser.onAgent((a) => {
  const bar = $('agentbar');
  bar.hidden = !a.running;
  $('btn-ask').hidden = !!a.running;
  bar.classList.toggle('paused', !!a.paused);
  $('agent-status').textContent = a.status || (a.paused ? 'You have control' : 'Violet is browsing…');
  $('btn-takeover').hidden = !!a.paused;
  $('btn-giveback').hidden = !a.paused;
  document.body.classList.toggle('locked', !!(a.running && !a.paused)); // only Violet drives
});
$('btn-takeover').addEventListener('click', () => window.vbrowser.takeOver());
$('btn-giveback').addEventListener('click', () => window.vbrowser.giveBack());
$('btn-agent-stop').addEventListener('click', () => window.vbrowser.stopAgent());

window.vbrowser.init().then((d) => { if (d && d.theme) window.applyThemeColors(d.theme); });
window.vbrowser.ready();
