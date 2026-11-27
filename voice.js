// ============================================================
// Violet - voice engines (main process)
// Speech-to-text: whisper.cpp (whisper-cli.exe), fully local.
// Custom voices:  Piper (piper.exe + .onnx voice files), local.
// Neither is bundled (they're big). Drop them into folders under
// %APPDATA%\Violet and Violet finds them automatically:
//   piper\    <- unzip piper_windows_amd64.zip here
//   voices\   <- put voice files here (name.onnx + name.onnx.json)
//   whisper\  <- unzip whisper-bin-x64.zip here, plus ggml-*.bin models
// The built-in Windows voices work with no setup (in the UI).
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

/** Breadth-first search for a file by name (case-insensitive), a few folders deep. */
function findFile(dir, names, depth = 3) {
  const wanted = names.map(n => n.toLowerCase());
  let level = [dir];
  for (let d = 0; d <= depth && level.length; d++) {
    const next = [];
    for (const folder of level) {
      let entries = [];
      try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        const full = path.join(folder, e.name);
        if (e.isFile() && wanted.includes(e.name.toLowerCase())) return full;
        if (e.isDirectory()) next.push(full);
      }
    }
    level = next;
  }
  return null;
}

/** All files under dir matching a test, a few folders deep. */
function findAll(dir, test, depth = 3) {
  const out = [];
  const walk = (folder, d) => {
    let entries = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(folder, e.name);
      if (e.isFile() && test(e.name)) out.push(full);
      else if (e.isDirectory() && d < depth) walk(full, d + 1);
    }
  };
  walk(dir, 0);
  return out;
}

// "en_US-amy-medium.onnx" -> "Amy (en_US, medium)"
function prettyVoice(file) {
  const base = path.basename(file, '.onnx');
  const m = base.match(/^([a-z]{2}_[A-Z]{2})-(.+?)-(x_low|low|medium|high)$/);
  if (!m) return base;
  const name = m[2].replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `${name} (${m[1]}, ${m[3].replace('_', '-')})`;
}

// Drop tags like [BLANK_AUDIO], (music), [Music] from whisper output.
function cleanTranscript(text) {
  return String(text)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:music|applause|laughter|silence|noise|inaudible)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function run(exe, args, { input, cwd, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out')); }, timeout);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || `Exited with code ${code}`).trim().slice(-400)));
    });
    if (input !== undefined) { child.stdin.write(input); }
    child.stdin.end();
  });
}

class VoiceEngines {
  constructor({ userDir }) {
    this.piperDir = path.join(userDir, 'piper');
    this.voicesDir = path.join(userDir, 'voices');
    this.whisperDir = path.join(userDir, 'whisper');
    this.tmpDir = path.join(userDir, 'tmp');
    for (const d of [this.piperDir, this.voicesDir, this.whisperDir, this.tmpDir]) fs.mkdirSync(d, { recursive: true });
    this.ttsCounter = 0;
  }

  piperExe() { return findFile(this.piperDir, ['piper.exe', 'piper']); }
  whisperExe() { return findFile(this.whisperDir, ['whisper-cli.exe', 'main.exe', 'whisper.exe', 'whisper-cli']); }

  listVoices() {
    // Voices can live in voices\ or anywhere inside piper\
    const files = [...findAll(this.voicesDir, n => n.endsWith('.onnx')), ...findAll(this.piperDir, n => n.endsWith('.onnx'))];
    return files
      .filter(f => fs.existsSync(`${f}.json`)) // Piper needs the matching config file
      .map(f => ({ id: path.basename(f), name: prettyVoice(f), file: f }));
  }

  listModels() {
    return findAll(this.whisperDir, n => /^ggml-.*\.bin$/i.test(n) && !/silero|vad/i.test(n))
      .map(f => ({ id: path.basename(f), file: f, sizeMB: Math.round(fs.statSync(f).size / 1048576) }))
      .sort((a, b) => a.sizeMB - b.sizeMB);
  }

  status() {
    const voices = this.listVoices();
    const models = this.listModels();
    return {
      piper: !!this.piperExe(),
      whisper: !!this.whisperExe(),
      voices: voices.map(({ id, name }) => ({ id, name })),
      models: models.map(({ id, sizeMB }) => ({ id, sizeMB })),
      dirs: { piper: this.piperDir, voices: this.voicesDir, whisper: this.whisperDir }
    };
  }

  /** Piper: text -> .wav file -> file:// URL the panel can play. */
  async speak(text, voiceId, speed = 1) {
    const exe = this.piperExe();
    if (!exe) throw new Error('Piper isn\'t installed yet. See Settings → Voice for setup.');
    const voice = this.listVoices().find(v => v.id === voiceId) || this.listVoices()[0];
    if (!voice) throw new Error('No Piper voices found. Put a .onnx + .onnx.json voice in the voices folder.');
    // Rotate a few files so we never overwrite audio that's still playing
    const out = path.join(this.tmpDir, `tts-${this.ttsCounter++ % 4}.wav`);
    const lengthScale = (1 / Math.max(0.5, Math.min(2, Number(speed) || 1))).toFixed(2); // bigger = slower
    // Text goes through stdin (never the command line).
    await run(exe, ['--model', voice.file, '--output_file', out, '--length_scale', lengthScale], {
      input: String(text).replace(/\s+/g, ' ').trim() + '\n',
      cwd: path.dirname(exe), // piper looks for espeak-ng-data next to itself
      timeout: 60000
    });
    return `${pathToFileURL(out).href}?v=${Date.now()}`;
  }

  /** whisper.cpp: 16 kHz mono WAV bytes -> text. */
  async transcribe(wavBytes, { modelId, lang = 'en', smallest = false } = {}) {
    const exe = this.whisperExe();
    if (!exe) throw new Error('Speech recognition isn\'t set up yet. See Settings → Voice for setup.');
    const models = this.listModels();
    if (!models.length) throw new Error('No Whisper model found. Put a ggml-*.bin model in the whisper folder.');
    const model = smallest ? models[0] : (models.find(m => m.id === modelId) || models[0]);
    const file = path.join(this.tmpDir, `rec-${smallest ? 'wake' : 'cmd'}.wav`);
    fs.writeFileSync(file, Buffer.from(wavBytes));
    const threads = String(Math.max(2, Math.min(8, os.cpus().length - 2)));
    const language = /^[a-z]{2}$|^auto$/.test(lang) ? lang : 'en';
    const out = await run(exe, ['-m', model.file, '-f', file, '-nt', '-np', '-l', language, '-t', threads], {
      cwd: path.dirname(exe),
      timeout: 60000
    });
    return cleanTranscript(out);
  }
}

module.exports = { VoiceEngines, prettyVoice, cleanTranscript, findFile };
