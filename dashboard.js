// ============================================================
// Violet - voice dashboard widgets (main process)
// Violet adds, updates and removes widgets on the dashboard by
// putting JSON in its reply:
//   <violet_widget>{"action":"add","type":"video","title":"…","url":"https://youtube.com/…"}</violet_widget>
// Widgets are saved in %APPDATA%\Violet\dashboard.json.
// Articles get their title/image/summary fetched here (no CORS
// limits in the main process).
// ============================================================
const fs = require('fs');
const path = require('path');
const { net } = require('electron');
const { checkYouTube, isYouTube } = require('./youtube');

const TYPES = ['website', 'video', 'article', 'note', 'image', 'list', 'timer', 'link'];
const SIZES = ['small', 'medium', 'large'];
const MAX_WIDGETS = 24;
const TAG_RE = /<violet_widget>([\s\S]*?)<\/violet_widget>/gi;

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function cleanUrl(u) {
  const s = str(u, 2000);
  try {
    const url = new URL(s);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Pull title / description / image / first paragraphs out of an article's HTML. */
function parseArticle(html, url) {
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i');
    const m = html.match(re);
    return m ? decode(m[1] || m[2]) : '';
  };
  const title = meta('og:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
  let image = meta('og:image') || meta('twitter:image');
  try { if (image) image = new URL(image, url).href; } catch { image = ''; }
  const paras = [...html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 60);
  return {
    title: title.trim().slice(0, 200),
    description: (meta('og:description') || meta('description')).slice(0, 400),
    image: /^https?:/.test(image) ? image : '',
    site: meta('og:site_name') || (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
    excerpt: paras.slice(0, 3).join('\n\n').slice(0, 900)
  };
}

// ---------- Free board layout ----------
// Every widget can sit anywhere on the board: x/y (pixels from the board's
// top-left), optional w/h (pixels), z (stacking). Violet can also give a named
// spot in `place` ("top-right", "center", "next to w2"…); the panel turns it
// into x/y, because only the panel knows how big the board is.
const PLACES = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const num = (v, min, max) => (Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Math.round(Number(v)))) : null);

function cleanPlace(p) {
  const t = str(p, 40).toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
  if (PLACES.includes(t.replace(/ /g, '-'))) return t.replace(/ /g, '-');
  const near = t.match(/^(?:next to|near|beside|by) (w\d+)$/);
  return near ? `near:${near[1]}` : '';
}

function applyLayout(out, w) {
  if ('size' in w && SIZES.includes(w.size)) { delete out.w; delete out.h; } // a preset size replaces a custom one
  const x = num(w.x, 0, 20000), y = num(w.y, 0, 20000);
  if (x != null && y != null) { out.x = x; out.y = y; delete out.place; }
  if ('place' in w) {
    const p = cleanPlace(w.place);
    if (p) { out.place = p; delete out.x; delete out.y; }
  }
  const ww = num(w.w, 180, 3000), hh = num(w.h, 100, 3000);
  if (ww != null) out.w = ww;
  if (hh != null) out.h = hh;
  const z = num(w.z, 0, 1e6);
  if (z != null) out.z = z;
}

/**
 * Timer controls, from Violet ({"action":"update","id":"w3","paused":true})
 * or from the widget's buttons. A paused timer keeps its time left in
 * `pausedLeft` (seconds) and `endsAt` is recomputed on resume.
 */
function applyTimerControls(t, w) {
  const now = Date.now();
  const leftNow = () => (t.pausedLeft != null ? t.pausedLeft : Math.max(0, (t.endsAt - now) / 1000));
  if (w.restart) { t.endsAt = now + (t.duration || 60) * 1000; t.pausedLeft = null; }
  if ('addMinutes' in w || 'addSeconds' in w) {
    const extra = Math.round((Number(w.addMinutes) || 0) * 60 + (Number(w.addSeconds) || 0));
    if (extra) {
      const left = Math.max(0, leftNow()) + extra;
      t.duration = Math.max(t.duration || 0, Math.ceil(left));
      if (t.pausedLeft != null) t.pausedLeft = Math.max(1, left);
      else t.endsAt = now + Math.max(1, left) * 1000;
    }
  }
  if (w.paused === true && t.pausedLeft == null && t.endsAt > now) t.pausedLeft = Math.max(1, (t.endsAt - now) / 1000);
  if (w.paused === false && t.pausedLeft != null) { t.endsAt = now + t.pausedLeft * 1000; t.pausedLeft = null; }
  if (t.pausedLeft == null) delete t.pausedLeft;
}

class Dashboard {
  constructor({ userDir, onChange }) {
    this.file = path.join(userDir, 'dashboard.json');
    this.onChange = onChange || (() => {});
    this.data = { nextId: 1, widgets: [] };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(d.widgets)) this.data = d;
    } catch { /* first run */ }
  }

  persist() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1), 'utf8'); } catch (err) { console.error(err); }
    this.onChange(this.list());
  }

  list() { return this.data.widgets; }

  /** Validate a widget from Claude (never trust its JSON blindly). */
  sanitize(w, existing = {}) {
    const type = TYPES.includes(w.type) ? w.type : existing.type;
    if (!type) throw new Error('unknown widget type');
    const out = {
      ...existing,
      type,
      title: str(w.title, 120) || existing.title || type,
      size: SIZES.includes(w.size) ? w.size : (existing.size || (type === 'website' || type === 'video' ? 'large' : 'medium'))
    };
    if ('url' in w) out.url = cleanUrl(w.url);
    if ('text' in w) out.text = str(w.text, 4000);
    if ('summary' in w) out.summary = str(w.summary, 1200);
    if ('items' in w && Array.isArray(w.items)) {
      out.items = w.items.slice(0, 30).map(it => (typeof it === 'string' ? { text: str(it, 200), done: false } : { text: str(it.text, 200), done: !!it.done }))
        .filter(it => it.text);
    }
    if ('minutes' in w || 'seconds' in w) {
      const secs = Math.max(1, Math.min(24 * 3600, Math.round((Number(w.minutes) || 0) * 60 + (Number(w.seconds) || 0))));
      out.endsAt = Date.now() + secs * 1000;
      out.duration = secs;
    }
    if (type === 'timer') applyTimerControls(out, w);
    applyLayout(out, w);
    if (['website', 'video', 'article', 'image', 'link'].includes(type) && !out.url) throw new Error(`${type} needs a valid https url`);
    if (type === 'timer' && !out.endsAt) throw new Error('timer needs minutes or seconds');
    return out;
  }

  add(w) {
    const widget = { id: `w${this.data.nextId++}`, created: Date.now(), ...this.sanitize(w) };
    this.data.widgets.unshift(widget);         // newest first
    if (this.data.widgets.length > MAX_WIDGETS) this.data.widgets.pop();
    if (widget.type === 'article') this.enrichArticle(widget.id);
    return widget;
  }

  update(id, patch) {
    const i = this.data.widgets.findIndex(w => w.id === id);
    if (i === -1) throw new Error(`no widget ${id}`);
    this.data.widgets[i] = this.sanitize(patch, this.data.widgets[i]);
    return this.data.widgets[i];
  }

  remove(id) {
    const before = this.data.widgets.length;
    this.data.widgets = this.data.widgets.filter(w => w.id !== id);
    if (this.data.widgets.length !== before) this.persist();
  }

  clear() { this.data.widgets = []; this.persist(); }

  toggleItem(id, index) {
    const w = this.data.widgets.find(x => x.id === id);
    if (!w || !w.items || !w.items[index]) return;
    w.items[index].done = !w.items[index].done;
    this.persist();
  }

  /**
   * Move one widget on the free board (Violet's "move" action):
   * { place: "top-right" | "center" | "next to w2" … } or exact { x, y }.
   * Older words still work: to "first"/"last", before/after another widget.
   */
  move(id, where = {}) {
    const w = this.data.widgets.find(x => x.id === id);
    if (!w) throw new Error(`no widget ${id}`);
    let place = where.place;
    if (!place && (where.to === 'first' || where.to === 'top')) place = 'top-left';
    if (!place && (where.to === 'last' || where.to === 'bottom')) place = 'bottom';
    if (!place && (where.before || where.after)) place = `next to ${where.before || where.after}`;
    applyLayout(w, { x: where.x, y: where.y, place, w: where.w, h: where.h });
    w.z = this.topZ() + 1; // a moved widget comes to the front
    return w;
  }

  topZ() { return this.data.widgets.reduce((m, w) => Math.max(m, w.z || 0), 0); }

  /** The panel saves where you dropped / resized a widget. */
  position(id, pos = {}) {
    const w = this.data.widgets.find(x => x.id === id);
    if (!w) return;
    applyLayout(w, pos);
    if (pos.clearPlace) delete w.place;
    this.persist();
  }

  /** Forget every position, so the panel lines widgets up neatly again. */
  tidy() {
    for (const w of this.data.widgets) { delete w.x; delete w.y; delete w.w; delete w.h; delete w.place; delete w.z; }
  }

  /** New full order from drag-and-drop. Unknown ids are ignored; missing ones keep their place at the end. */
  reorder(ids) {
    if (!Array.isArray(ids)) return;
    const byId = new Map(this.data.widgets.map(w => [w.id, w]));
    const next = [];
    for (const id of ids) { const w = byId.get(id); if (w) { next.push(w); byId.delete(id); } }
    this.data.widgets = [...next, ...byId.values()];
    this.persist();
  }

  /** Buttons on a timer widget: pause | resume | restart | add1 */
  timer(id, op) {
    const w = this.data.widgets.find(x => x.id === id && x.type === 'timer');
    if (!w) return;
    const patch = { pause: { paused: true }, resume: { paused: false }, restart: { restart: true }, add1: { addMinutes: 1 } }[op];
    if (!patch) return;
    applyTimerControls(w, patch);
    this.persist();
  }

  resize(id, size) {
    const w = this.data.widgets.find(x => x.id === id);
    if (w && SIZES.includes(size)) { w.size = size; this.persist(); }
  }

  /**
   * Read <violet_widget> blocks from a reply. Returns a short log of what changed.
   * YouTube links are checked first: a removed / private / terminated video is
   * never shown, and `onBlocked` is told so the user hears why.
   */
  async applyTags(text, onBlocked = () => {}) {
    const log = [];
    if (!text) return log;
    for (const m of text.matchAll(TAG_RE)) {
      let cmd;
      try { cmd = JSON.parse(m[1].trim()); } catch { log.push('skipped a widget with broken JSON'); continue; }
      const cmds = Array.isArray(cmd) ? cmd : [cmd];
      for (const c of cmds.slice(0, 8)) {
        try {
          const action = c.action || 'add';
          if ((action === 'add' || action === 'update') && c && typeof c.url === 'string' && isYouTube(c.url)) {
            const check = await checkYouTube(cleanUrl(c.url));
            if (!check.ok) {
              const name = str(c.title, 80) || 'That video';
              log.push(`blocked ${name}: ${check.reason}`);
              onBlocked({ title: name, url: c.url, reason: check.reason });
              continue;
            }
            // Use YouTube's real title when Violet gave a vague one
            if (check.title && (!c.title || /^(video|youtube)$/i.test(String(c.title).trim()))) c.title = check.title;
          }
          if (action === 'add') log.push(`added ${this.add(c).title}`);
          else if (action === 'update') log.push(`updated ${this.update(str(c.id, 20), c).title}`);
          else if (action === 'remove') { this.data.widgets = this.data.widgets.filter(w => w.id !== c.id); log.push(`removed ${c.id}`); }
          else if (action === 'clear') { this.data.widgets = []; log.push('cleared'); }
          else if (action === 'move') log.push(`moved ${this.move(str(c.id, 20), { to: c.to, before: str(c.before, 20), after: str(c.after, 20), place: c.place, x: c.x, y: c.y, w: c.w, h: c.h }).title}`);
          else if (action === 'tidy') { this.tidy(); log.push('tidied'); }
        } catch (err) { log.push(`widget error: ${err.message}`); }
      }
    }
    if (log.length) this.persist();
    return log;
  }

  async enrichArticle(id) {
    const w = this.data.widgets.find(x => x.id === id);
    if (!w || !w.url) return;
    w.loading = true;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await net.fetch(w.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }
      });
      clearTimeout(timer);
      const html = (await res.text()).slice(0, 1500000);
      const info = parseArticle(html, w.url);
      const cur = this.data.widgets.find(x => x.id === id);
      if (cur) Object.assign(cur, { meta: info, loading: false, title: cur.title === 'article' && info.title ? info.title : cur.title });
    } catch {
      const cur = this.data.widgets.find(x => x.id === id);
      if (cur) cur.loading = false;
    }
    this.persist();
  }

  promptBlock() {
    const timerState = (w) => {
      if (w.type !== 'timer') return '';
      const left = w.pausedLeft != null ? w.pausedLeft : Math.max(0, (w.endsAt - Date.now()) / 1000);
      return ` [${w.pausedLeft != null ? 'paused' : left > 0 ? 'running' : 'finished'}, ${Math.round(left)}s left]`;
    };
    const where = (w) => (w.x != null ? ` at x=${w.x},y=${w.y}${w.w ? ` ${w.w}px wide` : ''}` : w.place ? ` (going to ${w.place})` : '');
    const list = this.data.widgets.map(w => `${w.id}: ${w.type} "${w.title}"${w.url ? ` ${w.url}` : ''}${timerState(w)}${where(w)}`).join('\n') || '(none)';
    return 'VOICE DASHBOARD MODE: the user is talking to you by voice on a dashboard. Your reply is read aloud, so keep it SHORT, ' +
      'natural and conversational (1-3 sentences), with no markdown tables or long lists.\n' +
      'You control the widgets on the dashboard. To change them, add one or more blocks at the END of your reply:\n' +
      '<violet_widget>{"action":"add","type":"video","title":"Lo-fi beats","url":"https://www.youtube.com/watch?v=..."}</violet_widget>\n' +
      'Types and fields:\n' +
      '- website: url (shows the live site)\n- video: url (YouTube, Vimeo, or a direct .mp4)\n' +
      '- article: url, optional summary (your 2-3 sentence summary)\n- note: text (Markdown)\n- image: url\n' +
      '- list: items (array of strings), e.g. a checklist\n- timer: minutes and/or seconds\n- link: url\n' +
      'The board is free-form: widgets can sit anywhere. Move one with {"action":"move","id":"w3","place":"top-right"} ' +
      '(top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right, or "next to w2"), or exact pixels ' +
      'from the board\'s top-left {"action":"move","id":"w3","x":40,"y":300}. Resize with "size" (small/medium/large) or ' +
      '{"action":"update","id":"w3","w":520,"h":340}. {"action":"tidy"} lines everything up neatly. You can also give "place" when adding.\n' +
      'Timer controls (use the timer\'s id): pause {"action":"update","id":"w3","paused":true}, resume "paused":false, ' +
      '"restart":true, add time "addMinutes":2. "Pause my timer" means the running timer; if there are several, ask which.\n' +
      'YouTube: Violet checks every YouTube link before showing it and drops removed, private or terminated-channel videos. ' +
      'So prefer well-known, recent uploads from active channels, and when you can, confirm with WebFetch on ' +
      'https://www.youtube.com/oembed?format=json&url=<video url> (an error there means the video is gone).\n' +
      'Optional for all: "size": "small" | "medium" | "large". Update with {"action":"update","id":"w3",...}, ' +
      'remove with {"action":"remove","id":"w3"}, or {"action":"clear"} to remove everything.\n' +
      'Use WebSearch/WebFetch to find REAL urls. Never invent urls. Add widgets when they genuinely help (showing a video, ' +
      'a page, an article, a recipe list, a timer), and remove stale ones when asked. Never mention the tags out loud.\n' +
      `Current widgets:\n${list}`;
  }
}

module.exports = { Dashboard, parseArticle, cleanUrl, TYPES };
