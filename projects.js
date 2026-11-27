// ============================================================
// Violet - Projects (code files with your permission)
// You pick a project folder. Claude can READ it (Read/Glob/Grep)
// but can never write. Instead it proposes changes like:
//   <violet_file path="src/app.js" action="replace"> ...full file... </violet_file>
// Violet turns each one into a card with a diff, and nothing is
// written until you click Apply. Every apply keeps a backup so
// Undo can put the old file back.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '__pycache__',
  'venv', '.venv', 'env', 'target', '.cache', '.idea', '.vscode', 'coverage', 'bin', 'obj', '.gradle']);
const MAX_FILE = 2 * 1024 * 1024; // 2 MB: bigger files aren't opened or edited
const FILE_RE = /<violet_file\s+path="([^"]+)"(?:\s+action="(create|replace|delete)")?\s*>([\s\S]*?)<\/violet_file>/gi;

const newId = () => `c${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;

// ---------- Line diff (LCS) for the change cards ----------
function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const ops = [];
  for (let i = 0; i < start; i++) ops.push([' ', a[i]]);
  if (A.length * B.length > 4000000) {
    // Huge change: show it as "all old lines out, all new lines in"
    A.forEach(l => ops.push(['-', l]));
    B.forEach(l => ops.push(['+', l]));
  } else {
    const n = A.length, m = B.length, w = m + 1;
    const dp = new Int32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push([' ', A[i]]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push(['-', A[i]]); i++; }
      else { ops.push(['+', B[j]]); j++; }
    }
    while (i < n) ops.push(['-', A[i++]]);
    while (j < m) ops.push(['+', B[j++]]);
  }
  for (let i = endA; i < a.length; i++) ops.push([' ', a[i]]);
  return ops;
}

/** Turn diff ops into display lines with 3 lines of context and "…" gaps. */
function toHunks(ops, context = 3, maxLines = 500) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach(([t], i) => {
    if (t !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const lines = [];
  let oldNo = 1, newNo = 1, gap = false;
  ops.forEach(([t, text], i) => {
    if (keep[i]) {
      if (gap) { lines.push({ t: 'gap' }); gap = false; }
      lines.push({ t, text, o: t === '+' ? null : oldNo, n: t === '-' ? null : newNo });
    } else gap = true;
    if (t !== '+') oldNo++;
    if (t !== '-') newNo++;
  });
  return lines.length > maxLines ? [...lines.slice(0, maxLines), { t: 'more', count: lines.length - maxLines }] : lines;
}

function stripFences(content) {
  let c = content.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  const m = c.match(/^```[\w.+-]*\r?\n([\s\S]*?)\r?\n```$/);
  return m ? m[1] : c;
}

class Projects {
  constructor({ userDir, getSettings, saveSettings }) {
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.changesDir = path.join(userDir, 'changes');   // pending changes (survive restarts)
    this.backupDir = path.join(userDir, 'backups');    // old versions for Undo
    fs.mkdirSync(this.changesDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  get root() {
    const r = this.getSettings().projectRoot;
    return r && fs.existsSync(r) ? r : null;
  }

  setRoot(dir) {
    const s = this.getSettings();
    if (!dir) { s.projectRoot = null; this.saveSettings(); return null; }
    const real = fs.realpathSync(dir);
    s.projectRoot = real;
    s.recentProjects = [real, ...(s.recentProjects || []).filter(p => p !== real)].slice(0, 8);
    this.saveSettings();
    return real;
  }

  info() {
    const root = this.root;
    return { root, name: root ? path.basename(root) : null, recent: (this.getSettings().recentProjects || []).filter(p => fs.existsSync(p)) };
  }

  /** Resolve a relative path safely inside the project (blocks ../ escapes). */
  resolve(rel, root = this.root) {
    if (!root) throw new Error('No project folder is open.');
    if (typeof rel !== 'string' || !rel.trim()) throw new Error('Missing file path.');
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs = path.resolve(root, clean);
    const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
    if (abs !== root && !abs.startsWith(rootWithSep)) throw new Error(`"${rel}" is outside the project folder.`);
    // If it already exists, make sure a link doesn't point outside either
    if (fs.existsSync(abs)) {
      const real = fs.realpathSync(abs);
      if (real !== root && !real.startsWith(rootWithSep)) throw new Error(`"${rel}" links outside the project folder.`);
    }
    if (clean.split('/').some(part => part === '.git')) throw new Error('Violet won\'t touch the .git folder.');
    return abs;
  }

  // ---------- Browsing (for prompts + the editor) ----------
  tree(limit = 150) {
    const root = this.root;
    if (!root) return [];
    const out = [];
    const walk = (dir, depth) => {
      if (out.length >= limit || depth > 6) return;
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of entries) {
        if (out.length >= limit) return;
        if (IGNORE.has(e.name) || e.name.startsWith('.env')) continue;
        const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, '/');
        if (e.isDirectory()) { out.push(rel + '/'); walk(path.join(dir, e.name), depth + 1); }
        else out.push(rel);
      }
    };
    walk(root, 0);
    return out;
  }

  listDir(rel = '') {
    const abs = rel ? this.resolve(rel) : this.root;
    if (!abs) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => !IGNORE.has(e.name))
      .map(e => ({ name: e.name, path: path.relative(this.root, path.join(abs, e.name)).replace(/\\/g, '/'), dir: e.isDirectory() }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  }

  readFile(rel) {
    const abs = this.resolve(rel);
    const st = fs.statSync(abs);
    if (st.size > MAX_FILE) throw new Error('File is too big to open here (over 2 MB).');
    const buf = fs.readFileSync(abs);
    if (buf.includes(0)) throw new Error('That looks like a binary file, so it can\'t be opened as text.');
    return buf.toString('utf8');
  }

  /** Your own saves from the editor (you typed it, so no approval needed). */
  writeFile(rel, content) {
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(content), 'utf8');
    return true;
  }

  promptBlock() {
    const root = this.root;
    if (!root) return '';
    const tree = this.tree(120);
    return `PROJECT MODE is on. The user's project folder is: ${root}\n` +
      'You can READ it with the Read, Glob and Grep tools using absolute paths inside that folder. You can NOT write files yourself.\n' +
      'To create, change, or delete a file, output a block like this (path relative to the project folder):\n' +
      '<violet_file path="src/example.js" action="create">\n...the COMPLETE file content...\n</violet_file>\n' +
      'Use action="create" for new files, action="replace" with the COMPLETE new content for existing files (never partial content or ' +
      '"rest unchanged" comments), and action="delete" with nothing inside to delete. Always Read a file before replacing it. ' +
      'Put a short explanation outside the blocks. The user reviews each change and clicks Apply.\n' +
      `Project files (partial list):\n${tree.join('\n') || '(empty folder)'}`;
  }

  // ---------- Proposed changes ----------
  changeFile(id) {
    if (!/^c[a-z0-9]+$/.test(id)) throw new Error('Bad change id');
    return path.join(this.changesDir, `${id}.json`);
  }

  loadChange(id) {
    return JSON.parse(fs.readFileSync(this.changeFile(id), 'utf8'));
  }

  saveChange(ch) {
    fs.writeFileSync(this.changeFile(ch.id), JSON.stringify(ch), 'utf8');
  }

  /** Find <violet_file> blocks in a finished reply and turn them into cards. */
  extract(text) {
    const root = this.root;
    const cards = [];
    if (!root || !text) return cards;
    for (const m of text.matchAll(FILE_RE)) {
      const rel = m[1].trim();
      const action = (m[2] || 'replace').toLowerCase();
      let content = action === 'delete' ? '' : stripFences(m[3]);
      // Files normally end with a newline; keep that so diffs and git stay clean
      if (content && !content.endsWith('\n')) content += '\n';
      try {
        const abs = this.resolve(rel, root);
        const exists = fs.existsSync(abs);
        let old = '';
        if (exists) {
          if (fs.statSync(abs).isDirectory()) throw new Error(`"${rel}" is a folder.`);
          old = fs.readFileSync(abs, 'utf8');
        }
        if (action === 'delete' && !exists) throw new Error(`"${rel}" doesn't exist.`);
        const ops = diffLines(exists ? old.split(/\r?\n/) : [], action === 'delete' ? [] : content.split(/\r?\n/));
        const added = ops.filter(o => o[0] === '+').length;
        const removed = ops.filter(o => o[0] === '-').length;
        const ch = {
          id: newId(), root, path: rel.replace(/\\/g, '/'), action: exists ? (action === 'delete' ? 'delete' : 'replace') : 'create',
          newContent: content, existedBefore: exists, status: 'pending', created: Date.now()
        };
        this.saveChange(ch);
        cards.push({ id: ch.id, path: ch.path, action: ch.action, added, removed, lines: toHunks(ops), status: 'pending' });
      } catch (err) {
        cards.push({ id: null, path: rel, action, error: err.message, status: 'error' });
      }
    }
    return cards;
  }

  backupPath(ch) { return path.join(this.backupDir, ch.id, ch.path); }

  apply(id) {
    const ch = this.loadChange(id);
    if (ch.status === 'applied') return { ok: true, already: true };
    const abs = this.resolve(ch.path, ch.root);
    // Back up whatever is there right now (even if you edited it since)
    if (fs.existsSync(abs)) {
      const bak = this.backupPath(ch);
      fs.mkdirSync(path.dirname(bak), { recursive: true });
      fs.copyFileSync(abs, bak);
      ch.hadFile = true;
    } else ch.hadFile = false;
    if (ch.action === 'delete') fs.unlinkSync(abs);
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, ch.newContent, 'utf8');
    }
    ch.status = 'applied';
    ch.appliedAt = Date.now();
    this.saveChange(ch);
    return { ok: true, abs, path: ch.path, root: ch.root };
  }

  undo(id) {
    const ch = this.loadChange(id);
    if (ch.status !== 'applied') return { ok: false, error: 'That change isn\'t applied.' };
    const abs = this.resolve(ch.path, ch.root);
    if (ch.hadFile) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(this.backupPath(ch), abs);
    } else if (fs.existsSync(abs)) fs.unlinkSync(abs); // it was a brand-new file
    ch.status = 'undone';
    this.saveChange(ch);
    return { ok: true, abs, path: ch.path, root: ch.root };
  }

  reject(id) {
    const ch = this.loadChange(id);
    if (ch.status === 'applied') return { ok: false, error: 'Undo it instead.' };
    ch.status = 'rejected';
    this.saveChange(ch);
    return { ok: true };
  }

  /** Old + new text for the editor's side-by-side review. */
  reviewData(id) {
    const ch = this.loadChange(id);
    let current = '';
    try { current = fs.readFileSync(this.resolve(ch.path, ch.root), 'utf8'); } catch { current = ''; }
    return { id: ch.id, path: ch.path, action: ch.action, status: ch.status, original: current, modified: ch.newContent };
  }
}

module.exports = { Projects, diffLines, toHunks, stripFences, FILE_RE };
