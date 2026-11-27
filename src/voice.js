// ============================================================
// Violet - voice (renderer side)
// - Mic: one shared microphone stream at 16 kHz mono (what Whisper wants)
// - record(): listens until you stop talking (voice activity detection)
// - WakeWatcher: always-on "Hey Violet" listener (optional)
// - Speaker: reads replies aloud with Windows voices or Piper
// Everything is processed on your PC; audio is never uploaded.
// ============================================================
(function () {
  const SR = 16000;

  function rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  /** Float32 chunks -> 16-bit PCM WAV bytes */
  function encodeWav(chunks) {
    const len = chunks.reduce((a, c) => a + c.length, 0);
    const buffer = new ArrayBuffer(44 + len * 2);
    const v = new DataView(buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, len * 2, true);
    let o = 44;
    for (const c of chunks) {
      for (let i = 0; i < c.length; i++) {
        const s = Math.max(-1, Math.min(1, c[i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Uint8Array(buffer);
  }

  // ---------- Shared microphone ----------
  class Mic {
    constructor() { this.stream = null; this.ctx = null; this.listeners = new Set(); this.users = 0; }

    async acquire() {
      this.users++;
      if (this.stream) return;
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
      } catch (err) {
        this.users--;
        throw new Error(err.name === 'NotAllowedError'
          ? 'Microphone blocked. Check Windows Settings → Privacy → Microphone → "Let desktop apps access your microphone".'
          : `Couldn't open the microphone: ${err.message}`);
      }
      this.ctx = new AudioContext({ sampleRate: SR }); // Chromium resamples the mic for us
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(2048, 1, 1); // 2048 samples = 128 ms
      this.node.onaudioprocess = (e) => {
        const frame = new Float32Array(e.inputBuffer.getChannelData(0));
        for (const fn of this.listeners) fn(frame);
      };
      this.src.connect(this.node);
      this.node.connect(this.ctx.destination); // outputs silence; needed to keep it running
    }

    release() {
      this.users = Math.max(0, this.users - 1);
      if (this.users === 0 && this.stream) {
        this.stream.getTracks().forEach(t => t.stop()); // turns off the mic indicator
        this.node.disconnect();
        this.src.disconnect();
        this.ctx.close();
        this.stream = null;
        this.ctx = null;
      }
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  }
  const mic = new Mic();

  /**
   * Record one spoken command. Stops after you pause, or when control.stop() is called.
   * Resolves WAV bytes, or null if nobody spoke.
   */
  async function record({ maxMs = 20000, silenceMs = 1300, noSpeechMs = 7000, onLevel, control = {} } = {}) {
    await mic.acquire();
    return new Promise((resolve) => {
      const chunks = [];
      let started = false, silentFor = 0, elapsed = 0, floor = 0.01, stopNow = false;
      const calib = [];
      control.stop = () => { stopNow = true; };

      const off = mic.on((frame) => {
        const level = rms(frame);
        const ms = (frame.length / SR) * 1000;
        elapsed += ms;
        // First ~400 ms: measure background noise so loud rooms still work
        if (calib.length < 3) { calib.push(level); floor = Math.max(0.004, Math.min(...calib)); }
        const threshold = Math.max(0.012, floor * 3);
        if (onLevel) onLevel(Math.min(1, level / (threshold * 4)));
        chunks.push(frame);
        if (level > threshold) { started = true; silentFor = 0; } else if (started) silentFor += ms;

        const done = (started && silentFor >= silenceMs) || elapsed >= maxMs || (!started && elapsed >= noSpeechMs) || stopNow;
        if (done) {
          off();
          mic.release();
          resolve(started || (stopNow && elapsed > 500) ? encodeWav(chunks) : null);
        }
      });
    });
  }

  // ---------- "Hey Violet" ----------
  // Listens for short bursts of speech, transcribes them locally with the
  // smallest Whisper model, and checks for the wake word.
  const WAKE_RE = /\b(?:hey|hi|hay|okay|ok|yo)?[\s,.!]*(?:violet|violette|violent|viola)\b[\s,.!?]*/i;
  function matchWake(text) {
    const m = String(text).match(WAKE_RE);
    if (!m) return null;
    // Only count it at the START of what you said ("Hey Violet…"), not "the violet flowers".
    if (text.slice(0, m.index).replace(/[^a-z]/gi, '').length > 0) return null;
    return { rest: text.slice(m.index + m[0].length).trim() };
  }

  class WakeWatcher {
    constructor(onSegment) {
      this.onSegment = onSegment; // async (wavBytes) => void
      this.running = false;
      this.paused = false;
      this.busy = false;
    }

    async start() {
      if (this.running) return;
      await mic.acquire();
      this.running = true;
      let pre = [], seg = null, floor = 0.01;
      this.off = mic.on((frame) => {
        if (this.paused || this.busy) { seg = null; return; }
        const level = rms(frame);
        const ms = (frame.length / SR) * 1000;
        const threshold = Math.max(0.015, floor * 3.5);
        if (!seg) {
          floor = Math.max(0.003, floor * 0.95 + level * 0.05); // slowly track room noise
          pre.push(frame);
          if (pre.length > 3) pre.shift();
          if (level > threshold) seg = { chunks: [...pre, frame], speech: ms, silence: 0 };
          return;
        }
        seg.chunks.push(frame);
        if (level > threshold) { seg.speech += ms; seg.silence = 0; } else seg.silence += ms;
        const total = seg.chunks.length * ms;
        if (seg.silence >= 700 || total >= 4000) {
          const s = seg;
          seg = null;
          pre = [];
          if (s.speech >= 300) {
            this.busy = true;
            Promise.resolve(this.onSegment(encodeWav(s.chunks))).finally(() => { this.busy = false; });
          }
        }
      });
    }

    stop() {
      if (!this.running) return;
      this.off();
      mic.release();
      this.running = false;
    }
  }

  // ---------- Speaking ----------
  /** Markdown -> something that sounds natural out loud */
  function speakable(md) {
    return String(md || '')
      .replace(/```[\s\S]*?(```|$)/g, ' I put the code in the chat. ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'a link')
      .replace(/^#+\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_~>|#]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500);
  }

  // Split into sentence-sized pieces (Windows voices can cut off long text)
  function chunkText(text, max = 220) {
    const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = ''; }
      cur += p;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  class Speaker {
    constructor() { this.audio = null; this.token = 0; this.speaking = false; this.onChange = () => {}; }

    windowsVoices() { return window.speechSynthesis ? speechSynthesis.getVoices() : []; }

    set(v) { this.speaking = v; this.onChange(v); }

    stop() {
      this.token++;
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (this.audio) { this.audio.pause(); this.audio = null; }
      this.set(false);
    }

    /** Speak markdown text using the chosen engine. Resolves when finished or stopped. */
    async speak(md, s) {
      this.stop();
      const text = speakable(md);
      if (!text) return;
      const token = ++this.token;
      this.set(true);
      try {
        if (s.ttsEngine === 'piper') await this.speakPiper(text, s, token);
        else await this.speakWindows(text, s, token);
      } finally {
        if (token === this.token) this.set(false);
      }
    }

    speakWindows(text, s, token) {
      return new Promise((resolve) => {
        const voices = this.windowsVoices();
        const voice = voices.find(v => v.name === s.winVoice) || voices.find(v => v.default) || voices[0];
        const pieces = chunkText(text);
        let i = 0;
        const next = () => {
          if (token !== this.token || i >= pieces.length) { resolve(); return; }
          const u = new SpeechSynthesisUtterance(pieces[i++]);
          if (voice) u.voice = voice;
          u.rate = Number(s.ttsSpeed) || 1;
          u.pitch = Number(s.ttsPitch) || 1;
          u.onend = next;
          u.onerror = next;
          speechSynthesis.speak(u);
        };
        next();
      });
    }

    async speakPiper(text, s, token) {
      const res = await window.violet.voice.speak(text, s.piperVoice, s.ttsSpeed);
      if (!res.ok) throw new Error(res.error);
      if (token !== this.token) return;
      await new Promise((resolve) => {
        const a = new Audio(res.url);
        this.audio = a;
        a.onended = resolve;
        a.onerror = resolve;
        a.play().catch(resolve);
      });
    }
  }

  // Little two-note chime when the wake word is heard
  function chime() {
    try {
      const ctx = new AudioContext();
      [660, 990].forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.12);
        o.stop(ctx.currentTime + i * 0.12 + 0.2);
      });
      setTimeout(() => ctx.close(), 600);
    } catch { /* no audio device */ }
  }

  const api = { mic, record, WakeWatcher, matchWake, speakable, chunkText, Speaker, encodeWav, rms, chime };
  if (typeof window !== 'undefined') window.VioletVoice = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
