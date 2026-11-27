// ============================================================
// Violet - Claude Code bridge
// Runs `claude -p` with streaming JSON output and hands back the
// text through callbacks. Used by both normal chat and the
// screen-control agent. One shared session = shared memory of
// the conversation.
// The prompt goes in through stdin, so user text never touches
// the command line (no quoting bugs, no command injection).
// ============================================================
const { spawn } = require('child_process');

// Tools Violet never lets Claude use on its own: these change files or run commands.
const ALWAYS_BLOCKED = 'Bash,Edit,Write,NotebookEdit';

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // shell:true means child.pid is cmd.exe; /T kills claude underneath it too.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function toolStatus(name) {
  if (/search/i.test(name)) return 'Searching the web…';
  if (/fetch/i.test(name)) return 'Reading a web page…';
  if (/read/i.test(name)) return 'Looking at the screen…';
  return `Using ${name}…`;
}

function friendlyError(raw) {
  const text = String(raw).trim();
  if (/not recognized|ENOENT|command not found|cannot find/i.test(text)) {
    return 'I couldn\'t start Claude Code. Make sure typing `claude` works in a terminal, or set the full path in **Settings → General → Claude command**.';
  }
  if (/login|log in|api key|authenticat|unauthorized/i.test(text)) {
    return 'Claude Code isn\'t logged in. Open a terminal, run `claude`, and sign in with your Pro account, then try again.';
  }
  if (/limit|usage|rate/i.test(text)) {
    return `You've hit a usage limit on your plan. Try again later, or turn off Deepthink to use less.\n\n\`${text.slice(0, 300)}\``;
  }
  return `Something went wrong:\n\n\`\`\`\n${text.slice(0, 800)}\n\`\`\``;
}

class ClaudeBridge {
  /**
   * @param {object} opts
   * @param {string} opts.cwd            folder Claude Code runs in
   * @param {() => object} opts.getSettings  returns current settings (claudePath etc.)
   */
  constructor({ cwd, getSettings }) {
    this.cwd = cwd;
    this.getSettings = getSettings;
    this.sessionId = null;
    this.supportsPartial = true;
    this.child = null;
  }

  get busy() { return !!this.child; }

  stop() {
    if (this.child) { this.child._stopped = true; killTree(this.child); }
  }

  reset() {
    this.stop();
    this.sessionId = null;
  }

  command() {
    const p = String(this.getSettings().claudePath || 'claude').trim();
    if (/["&|<>^%]/.test(p)) return 'claude'; // never let the setting inject shell syntax
    return p.includes(' ') ? `"${p}"` : p;
  }

  buildArgs(model, allowedTools, addDirs = []) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (this.supportsPartial) args.push('--include-partial-messages');
    args.push('--disallowedTools', ALWAYS_BLOCKED);
    if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
    // Extra folders Claude may READ (your project). Quoted for the Windows shell;
    // paths come from Violet's own folder picker, and quotes are rejected.
    for (const d of addDirs) {
      if (typeof d === 'string' && d && !/["%^&|<>]/.test(d)) args.push('--add-dir', process.platform === 'win32' ? `"${d}"` : d);
    }
    if (model && /^[\w.\-[\]]+$/.test(model)) args.push('--model', model);
    if (this.sessionId && /^[\w-]+$/.test(this.sessionId)) args.push('--resume', this.sessionId);
    return args;
  }

  /**
   * Run one turn.
   * @returns {Promise<{text: string, error?: string, stopped?: boolean}>}
   */
  run({ input, model = '', allowedTools = [], addDirs = [], onText = () => {}, onStatus = () => {} }, isRetry = false) {
    return new Promise((resolve) => {
      const env = { ...process.env };
      // If an API key is set, Claude Code bills the API instead of your Pro plan.
      delete env.ANTHROPIC_API_KEY;

      const child = spawn(this.command(), this.buildArgs(model, allowedTools, addDirs), {
        cwd: this.cwd,
        env,
        shell: process.platform === 'win32', // lets Windows run claude.cmd shims
        windowsHide: true
      });
      this.child = child;

      let buffer = '';
      let stderr = '';
      let fullText = '';
      let resultError = null;
      let finished = false;
      let currentMsgId = null;
      let lastTextMsgId = null;
      const streamedIds = new Set();

      const emitText = (msgId, text) => {
        if (!text) return;
        // A new assistant message after an earlier one (e.g. after a tool): add spacing.
        if (fullText && msgId && lastTextMsgId && msgId !== lastTextMsgId) text = '\n\n' + text;
        lastTextMsgId = msgId || lastTextMsgId;
        fullText += text;
        onText(text);
      };

      const handleLine = (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return; }

        if (msg.type === 'system' && msg.subtype === 'init' && msg.session_id) {
          this.sessionId = msg.session_id;
          return;
        }

        // Token-by-token streaming (newer Claude Code versions)
        if (msg.type === 'stream_event' && msg.event) {
          const ev = msg.event;
          if (ev.type === 'message_start' && ev.message) {
            currentMsgId = ev.message.id;
          } else if (ev.type === 'content_block_delta' && ev.delta) {
            if (ev.delta.type === 'text_delta') {
              streamedIds.add(currentMsgId);
              emitText(currentMsgId, ev.delta.text);
            } else if (ev.delta.type === 'thinking_delta') {
              onStatus('Thinking…');
            }
          } else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
            onStatus(toolStatus(ev.content_block.name));
          }
          return;
        }

        // Whole message (fallback when token streaming isn't available)
        if (msg.type === 'assistant' && msg.message) {
          const id = msg.message.id;
          for (const block of msg.message.content || []) {
            if (block.type === 'text' && !streamedIds.has(id)) emitText(id, block.text);
            if (block.type === 'tool_use') onStatus(toolStatus(block.name));
          }
          return;
        }

        if (msg.type === 'result') {
          if (msg.session_id) this.sessionId = msg.session_id;
          finished = true;
          if (msg.is_error) resultError = friendlyError(String(msg.result || 'Claude Code returned an error.'));
          else if (!fullText && typeof msg.result === 'string') emitText(null, msg.result);
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line) handleLine(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => { stderr += chunk; });

      let settled = false;
      const done = (result) => { if (!settled) { settled = true; resolve(result); } };

      child.on('error', (err) => {
        if (this.child === child) this.child = null;
        done({ text: fullText, error: friendlyError(err.message) });
      });

      child.on('close', (code) => {
        if (buffer.trim()) handleLine(buffer.trim());
        if (this.child === child) this.child = null;
        if (child._stopped) { done({ text: fullText, stopped: true }); return; }

        const opts = { input, model, allowedTools, addDirs, onText, onStatus };
        // Older Claude Code without --include-partial-messages: retry once without it.
        if (code !== 0 && !isRetry && this.supportsPartial && /include-partial-messages/i.test(stderr)) {
          this.supportsPartial = false;
          this.run(opts, true).then(done);
          return;
        }
        // A stale session can't be resumed: start a fresh one.
        if (code !== 0 && !isRetry && this.sessionId && /session|resume/i.test(stderr) && !fullText) {
          this.sessionId = null;
          this.run(opts, true).then(done);
          return;
        }
        if (resultError) { done({ text: fullText, error: resultError }); return; }
        if (!finished && code !== 0) {
          done({ text: fullText, error: friendlyError(stderr || `Claude Code exited with code ${code}.`) });
          return;
        }
        done({ text: fullText });
      });

      child.stdin.write(input);
      child.stdin.end();
    });
  }
}

module.exports = { ClaudeBridge, friendlyError };
