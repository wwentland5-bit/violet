// ============================================================
// Violet - saved chats
// Every chat is one JSON file in %APPDATA%\Violet\chats\.
// The main process records messages as they happen (your text
// and Violet's streamed replies), so chats are saved even if the
// window is closed mid-reply. Each chat also remembers its own
// Claude Code session, so switching chats keeps context.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const newId = () => `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const safeId = (id) => typeof id === 'string' && /^[a-z0-9-]{4,40}$/.test(id);

class ChatStore {
  constructor({ userDir }) {
    this.dir = path.join(userDir, 'chats');
    fs.mkdirSync(this.dir, { recursive: true });
    this.current = null;     // the open chat (full object)
    this.pending = null;     // assistant message being built
  }

  file(id) { return path.join(this.dir, `${id}.json`); }

  // ---------- Listing / loading ----------
  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        if (!c.messages || !c.messages.length) continue; // skip empty chats
        const lastUser = [...c.messages].reverse().find(m => m.role === 'user');
        out.push({
          id: c.id, title: c.title || 'New chat', pinned: !!c.pinned,
          created: c.created, updated: c.updated,
          preview: lastUser ? lastUser.text.slice(0, 80) : ''
        });
      } catch { /* skip broken file */ }
    }
    return out.sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  }

  load(id) {
    if (!safeId(id)) return null;
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch { return null; }
  }

  open(id) {
    const c = this.load(id);
    if (c) { this.current = c; this.pending = null; }
    return c;
  }

  create() {
    const now = Date.now();
    this.current = { id: newId(), title: 'New chat', created: now, updated: now, sessionId: null, messages: [] };
    this.pending = null;
    return this.current; // not written to disk until the first message
  }

  ensure() { return this.current || this.create(); }

  save(chat = this.current) {
    if (!chat || !chat.messages.length) return;
    chat.updated = Date.now();
    try { fs.writeFileSync(this.file(chat.id), JSON.stringify(chat, null, 1), 'utf8'); } catch (err) { console.error('Chat save failed', err); }
  }

  rename(id, title) {
    const c = id === (this.current && this.current.id) ? this.current : this.load(id);
    if (!c) return false;
    c.title = String(title || '').trim().slice(0, 80) || 'Untitled';
    this.save(c);
    return true;
  }

  pin(id, pinned) {
    const c = id === (this.current && this.current.id) ? this.current : this.load(id);
    if (!c) return false;
    c.pinned = !!pinned;
    this.save(c);
    return true;
  }

  remove(id) {
    if (!safeId(id)) return false;
    try { fs.unlinkSync(this.file(id)); } catch { /* already gone */ }
    if (this.current && this.current.id === id) this.create();
    return true;
  }

  search(q) {
    q = String(q || '').toLowerCase().trim();
    if (!q) return this.list();
    return this.list().filter(item => {
      if (item.title.toLowerCase().includes(q)) return true;
      const c = this.load(item.id);
      return c && c.messages.some(m => (m.text || '').toLowerCase().includes(q));
    });
  }

  // ---------- Recording messages ----------
  addUser(text, extra = {}) {
    const c = this.ensure();
    c.messages.push({ role: 'user', text, time: Date.now(), ...extra });
    if (c.title === 'New chat') c.title = text.replace(/\s+/g, ' ').slice(0, 48) + (text.length > 48 ? '…' : '');
    this.pending = { role: 'assistant', text: '', time: Date.now(), kind: extra.kind || '', deep: !!extra.deep, steps: [], error: false };
    this.save(c);
  }

  /** Feed chat events (delta/step/error/done) in; saves when the reply is done. */
  onEvent(ev) {
    if (!this.pending || !this.current) return;
    const p = this.pending;
    if (ev.type === 'delta') p.text += ev.text;
    else if (ev.type === 'error') { p.error = true; p.text += (p.text ? '\n\n' : '') + ev.text; }
    else if (ev.type === 'step') p.steps.push({ step: ev.step, thought: ev.thought, actions: ev.actions });
    else if (ev.type === 'changes') p.changes = ev.changes;
    else if (ev.type === 'done') {
      if (ev.stopped) p.text += (p.text ? '\n\n' : '') + '*Stopped.*';
      if (!p.text.trim() && !p.steps.length) p.text = '*No response.*';
      this.current.messages.push(p);
      this.pending = null;
      this.save();
    }
  }

  setSession(sessionId) {
    if (this.current) { this.current.sessionId = sessionId || null; this.save(); }
  }

  /** Update a saved file-change card's status (applied / rejected / undone). */
  setChangeStatus(changeId, status) {
    const c = this.current;
    if (!c) return;
    for (const m of c.messages) {
      for (const ch of m.changes || []) if (ch.id === changeId) ch.status = status;
    }
    this.save();
  }
}

module.exports = { ChatStore };
