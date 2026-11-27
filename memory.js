// ============================================================
// Violet - memory
// A simple list of things Violet remembers about you, saved in
// %APPDATA%\Violet\memory.json. You can see, edit, add, and delete
// every memory in the Memory tab.
// How Violet saves on its own: when you tell it something worth
// remembering, it adds <remember>…</remember> at the end of its
// reply. Violet strips that tag from the chat and saves the fact.
// "Forget that…" works the same way with <forget>m12</forget>.
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_MEMORIES = 200;
const MAX_IN_PROMPT = 60;

const REMEMBER_RE = /<remember(?:\s+category="(\w+)")?\s*>([\s\S]*?)<\/remember>/gi;

// Branches of the memory tree
const CATEGORIES = ['about', 'preferences', 'projects', 'tech', 'hobbies', 'people', 'places', 'other'];

// Best guess for memories saved without a category
const KEYWORDS = {
  projects: /\b(project|building|build|app|website|site|bot|repo|server|mod|working on|making)\b/i,
  tech: /\b(windows|linux|mac|pc|gpu|cpu|python|javascript|node|code|vs ?code|electron|rtx|ryzen|intel|router|nas|docker|plex|api|claude|esp32|arduino)\b/i,
  preferences: /\b(prefers?|likes?|loves?|hates?|dislikes?|wants?|favorite|always|never|rather)\b/i,
  hobbies: /\b(plays?|game|gaming|minecraft|gta|rust|music|guitar|3d print|printing|hobby|watch|anime|sport)\b/i,
  people: /\b(mom|dad|brother|sister|wife|husband|girlfriend|boyfriend|friend|son|daughter|boss|coworker)\b/i,
  places: /\b(lives? in|from|city|state|country|moved|located|near)\b/i,
  about: /\b(name is|years old|job|works? as|student|is a|am a)\b/i
};
function guessCategory(text) {
  for (const [cat, re] of Object.entries(KEYWORDS)) if (re.test(text)) return cat;
  return 'other';
}
const cleanCat = (c, text) => (CATEGORIES.includes(String(c || '').toLowerCase()) ? String(c).toLowerCase() : guessCategory(text || ''));
const FORGET_RE = /<forget>\s*(m\d+)\s*<\/forget>/gi;

class MemoryStore {
  constructor({ userDir }) {
    this.file = path.join(userDir, 'memory.json');
    this.data = { nextId: 1, items: [] };
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(d.items)) this.data = { nextId: d.nextId || d.items.length + 1, items: d.items };
    } catch { /* first run */ }
  }

  persist() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 1), 'utf8'); } catch (err) { console.error('Memory save failed', err); }
  }

  list() {
    // Older memories (before categories) get a best-guess branch
    return [...this.data.items].map(m => (m.category ? m : { ...m, category: guessCategory(m.text) }))
      .sort((a, b) => b.created - a.created);
  }

  add(text, source = 'manual', category = null) {
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) return null;
    // Skip near-duplicates
    const lower = text.toLowerCase();
    if (this.data.items.some(m => m.text.toLowerCase() === lower)) return null;
    const item = { id: `m${this.data.nextId++}`, text, source, category: cleanCat(category, text), created: Date.now() };
    this.data.items.push(item);
    if (this.data.items.length > MAX_MEMORIES) this.data.items.shift(); // drop the oldest
    this.persist();
    return item;
  }

  update(id, text, category) {
    const m = this.data.items.find(x => x.id === id);
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!m || !text) return false;
    m.text = text;
    if (category !== undefined) m.category = cleanCat(category, text);
    m.edited = Date.now();
    this.persist();
    return true;
  }

  remove(id) {
    const before = this.data.items.length;
    this.data.items = this.data.items.filter(m => m.id !== id);
    this.persist();
    return this.data.items.length !== before;
  }

  clear() { this.data.items = []; this.persist(); }

  /** Text block added to Violet's instructions every turn. */
  promptBlock(autoSave) {
    const items = this.list().slice(0, MAX_IN_PROMPT);
    let block = items.length
      ? 'Things you remember about the user (use them naturally when relevant; never recite the list):\n' +
        items.map(m => `[${m.id}] (${m.category}) ${m.text}`).join('\n')
      : 'You have no saved memories about the user yet.';
    if (autoSave) {
      block += '\n\nMemory rules: when the user shares a lasting fact or preference worth remembering (their name, projects, ' +
        'tools, likes, how they want you to answer), add <remember category="tech">short fact in third person</remember> at the very END of your reply. ' +
        `Categories: ${CATEGORIES.join(', ')}. ` +
        'Only lasting things, never passwords, money details, or health info. One tag per fact, at most 2 per reply. ' +
        'If the user asks you to forget something, add <forget>m12</forget> using its id. Never mention these tags.';
    }
    return block;
  }

  /** Pull remember/forget tags out of a finished reply. Returns {added, removed}. */
  applyTags(text, autoSave) {
    const added = [];
    const removed = [];
    if (!text) return { added, removed };
    if (autoSave) {
      for (const m of text.matchAll(REMEMBER_RE)) {
        const item = this.add(m[2], 'violet', m[1]);
        if (item) added.push(item);
        if (added.length >= 3) break;
      }
    }
    for (const m of text.matchAll(FORGET_RE)) {
      if (this.remove(m[1])) removed.push(m[1]);
    }
    return { added, removed };
  }
}

/** Remove the tags from text shown to you (also hides a half-streamed tag). */
function stripMemoryTags(text) {
  return String(text || '')
    .replace(REMEMBER_RE, '')
    .replace(FORGET_RE, '')
    .replace(/<(remember|forget)\b[\s\S]*$/i, '')   // tag still streaming in
    .replace(/<\/?(r(e(m(e(m(b(e(r)?)?)?)?)?)?)?|f(o(r(g(e(t)?)?)?)?)?)?$/i, '') // partial "<rem"
    .trimEnd();
}

module.exports = { MemoryStore, stripMemoryTags, CATEGORIES, guessCategory };
