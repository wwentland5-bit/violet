// ============================================================
// Tiny, safe Markdown renderer (no dependencies = less RAM).
// Everything is HTML-escaped FIRST, so Claude's replies can never
// inject scripts into the UI. Handles: code blocks, inline code,
// headings, bold/italic, links, lists, quotes, rules, paragraphs.
// Unclosed ``` blocks (mid-stream) render as code right away.
// ============================================================
(function () {
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function inline(text) {
    // 1) Pull out inline code so bold/italic rules don't touch it.
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = escapeHtml(s);
    // 2) Links [text](https://...) - only http(s) allowed.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => `<a href="#" data-href="${url}">${label}</a>`);
    // 3) Bold, then italic.
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    // 4) Put inline code back (escaped).
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
    return s;
  }

  function renderBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    let para = [];
    let list = null; // {type: 'ul'|'ol', items: []}

    const flushPara = () => {
      if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; }
    };
    const flushList = () => {
      if (list) {
        out.push(`<${list.type}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.type}>`);
        list = null;
      }
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) { flushPara(); flushList(); continue; }

      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        flushPara(); flushList();
        const level = Math.min(m[1].length + 2, 6); // # -> h3, keeps sizes sane in a small panel
        out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flushPara(); flushList();
        out.push('<hr>');
      } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
        flushPara(); flushList();
        out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        flushPara();
        if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
        list.items.push(m[1]);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara();
        if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
        list.items.push(m[1]);
      } else if (list && /^\s{2,}\S/.test(raw)) {
        // Indented continuation of the previous list item
        list.items[list.items.length - 1] += ' ' + line.trim();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join('');
  }

  function renderMarkdown(src) {
    const parts = String(src || '').split(/^```/m);
    let html = '';
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        html += renderBlocks(part);
      } else {
        // Code block: first line is the language tag.
        const nl = part.indexOf('\n');
        const lang = nl === -1 ? part.trim() : part.slice(0, nl).trim();
        const code = nl === -1 ? '' : part.slice(nl + 1).replace(/\n$/, '');
        const label = escapeHtml(lang.replace(/[^\w+#.-]/g, '') || 'code');
        html += `<div class="codeblock"><div class="codebar"><span>${label}</span>` +
          `<button class="copy-code" type="button">Copy</button></div>` +
          `<pre><code>${escapeHtml(code)}</code></pre></div>`;
      }
    });
    return html;
  }

  if (typeof window !== 'undefined') window.renderMarkdown = renderMarkdown;
  if (typeof module !== 'undefined') module.exports = { renderMarkdown };
})();
