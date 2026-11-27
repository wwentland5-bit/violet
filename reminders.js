// ============================================================
// Violet - reminders
// "Remind me at 5pm to call mom" -> Violet adds
//   <violet_reminder>{"text":"Call mom","at":"2026-11-15T17:00"}</violet_reminder>
// or you type /remind 20m stretch. When it's due you get a Windows
// notification, a chime, and Violet says it out loud.
// Saved in %APPDATA%\Violet\reminders.json so they survive restarts.
// ============================================================
const fs = require('fs');
const path = require('path');

const TAG_RE = /<violet_reminder>([\s\S]*?)<\/violet_reminder>/gi;

/** "20m", "1h30m", "90s", "2h" -> milliseconds (or null) */
function parseDuration(s) {
  const m = String(s).trim().toLowerCase().match(/^(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?|s)?)?)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return ((Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0)) * 1000;
}

/** "17:30", "5pm", "5:15 am", "noon" -> next time that clock time happens (ms epoch) */
function parseClock(s, now = new Date()) {
  const t = String(s).trim().toLowerCase();
  if (t === 'noon') return parseClock('12:00', now);
  if (t === 'midnight') return parseClock('0:00', now);
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1); // already passed today -> tomorrow
  return d.getTime();
}

/** "/remind 20m stretch" or "/remind 5pm call mom" -> {at, text} */
function parseRemindCommand(arg, now = new Date()) {
  const parts = String(arg || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  // Try "5:15 pm" (two tokens) first, then one token
  for (const n of [2, 1]) {
    const when = parts.slice(0, n).join(' ');
    const dur = parseDuration(when);
    const at = dur !== null ? now.getTime() + dur : parseClock(when, now);
    if (at && parts.length > n) return { at, text: parts.slice(n).join(' ') };
  }
  return null;
}

class Reminders {
  constructor({ userDir, onDue, onChange }) {
    this.file = path.join(userDir, 'reminders.json');
    this.onDue = onDue || (() => {});
    this.onChange = onChange || (() => {});
    this.data = { nextId: 1, items: [] };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(d.items)) this.data = d;
    } catch { /* first run */ }
    // Check every 15s (simpler and more reliable than long setTimeouts)
    this.timer = setInterval(() => this.check(), 15000);
    setTimeout(() => this.check(), 3000);
  }

  persist() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1), 'utf8'); } catch (err) { console.error(err); }
    this.onChange(this.upcoming());
  }

  upcoming() { return this.data.items.filter(r => !r.done).sort((a, b) => a.at - b.at); }

  add(text, at) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    at = Number(at);
    if (!text || !Number.isFinite(at)) throw new Error('A reminder needs text and a time.');
    if (at < Date.now() - 60000) throw new Error('That time already passed.');
    const r = { id: `r${this.data.nextId++}`, text, at, done: false, created: Date.now() };
    this.data.items.push(r);
    // Keep the file small: drop old finished reminders
    this.data.items = this.data.items.filter(x => !x.done || Date.now() - x.at < 7 * 86400000);
    this.persist();
    return r;
  }

  remove(id) {
    this.data.items = this.data.items.filter(r => r.id !== id);
    this.persist();
  }

  check() {
    const now = Date.now();
    let changed = false;
    for (const r of this.data.items) {
      if (!r.done && r.at <= now) {
        r.done = true;
        changed = true;
        // Only alert for recent ones; if the PC was off for hours, still tell you (marked late)
        this.onDue({ ...r, late: now - r.at > 5 * 60000 });
      }
    }
    if (changed) this.persist();
  }

  /** Read <violet_reminder> blocks from a reply. Returns what was added. */
  applyTags(text) {
    const added = [];
    if (!text) return added;
    for (const m of text.matchAll(TAG_RE)) {
      try {
        const c = JSON.parse(m[1].trim());
        let at = null;
        if (c.in_minutes !== undefined) at = Date.now() + Number(c.in_minutes) * 60000;
        else if (c.at) {
          // "2026-11-15T17:30" is read as LOCAL time (no Z), which is what we want
          at = new Date(String(c.at)).getTime();
        }
        if (Number.isFinite(at)) added.push(this.add(c.text, at));
      } catch { /* ignore broken reminder blocks */ }
    }
    return added;
  }

  promptBlock() {
    const now = new Date();
    const list = this.upcoming().slice(0, 15).map(r => `${r.id}: "${r.text}" at ${new Date(r.at).toLocaleString()}`).join('\n') || '(none)';
    return `Current local date and time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone}).\n` +
      'If the user asks to be reminded of something, add at the END of your reply: ' +
      '<violet_reminder>{"text":"Call mom","at":"YYYY-MM-DDTHH:MM"}</violet_reminder> (local time, no timezone suffix) ' +
      'or {"text":"Stretch","in_minutes":20}. Confirm the time in plain words. Never mention the tag.\n' +
      `Upcoming reminders:\n${list}`;
  }
}

module.exports = { Reminders, parseDuration, parseClock, parseRemindCommand };
