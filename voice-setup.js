// ============================================================
// Violet — one-click voice setup (inside the app)
//
// Downloads what the voice features need, straight into Violet's
// own folders, so you never have to run setup.bat or unzip things:
//   • whisper.cpp  (speech recognition program, ~4 MB zip)
//   • ggml-base.en.bin  (English speech model, ~148 MB)
//   • Piper        (custom-voice program, ~20 MB zip)
//   • Amy          (a natural US English voice, ~63 MB)
// Anything already installed is skipped.
// ============================================================
const { net } = require('electron');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const fs = require('fs');
const path = require('path');

const URLS = {
  whisperZip: 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip',
  whisperModel: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  piperZip: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  // Voices are pinned to the v1.0.0 tag. Newer voice files on "main" were retrained
  // for Piper 1.5+ (combined sounds like "aɪ") and mispronounce words in the Piper
  // program Violet uses ("Righte" instead of "right").
  voiceOnnx: voiceUrl('en_US-amy-medium.onnx'),
  voiceJson: voiceUrl('en_US-amy-medium.onnx.json')
};

/**
 * Hugging Face v1.0.0 address for a standard Piper voice file name,
 * e.g. en_US-amy-medium.onnx -> .../v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx
 * Returns null for names that don't follow the lang_REGION-name-quality pattern.
 */
function voiceUrl(fileName) {
  const m = /^(([a-z]{2,3})_[A-Z]{2})-([\w]+)-(x_low|low|medium|high)\.onnx(\.json)?$/.exec(fileName);
  if (!m) return null;
  const [, locale, family, name, quality] = m;
  return `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/${family}/${locale}/${name}/${quality}/${fileName}`;
}

/** True if a voice config was made for Piper 1.5+ (has combined-sound keys like "aɪ"). */
function needsOldVersion(configFile) {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
    return Object.keys(cfg.phoneme_id_map || {}).some(k => [...k].length !== 1);
  } catch { return false; }
}

/**
 * Swap newer (Piper 1.5+) voices for their original v1.0.0 versions, which the
 * Piper program Violet uses pronounces correctly. Runs quietly at startup.
 * Voices that have no v1.0.0 version are left alone (Violet still cleans their
 * config so they don't crash). Returns the ids of the voices replaced.
 */
async function repairVoices(voice) {
  const fixed = [];
  const skipFile = path.join(voice.tmpDir, 'voice-repair-skip.json');
  let skip = [];
  try { skip = JSON.parse(fs.readFileSync(skipFile, 'utf8')); } catch {}
  for (const v of voice.listVoices()) {
    if (skip.includes(v.id) || !needsOldVersion(`${v.file}.json`)) continue;
    const onnxUrl = voiceUrl(path.basename(v.file));
    if (!onnxUrl) continue;
    // Download both into tmp first; only replace the voice once both arrived intact.
    const tmpOnnx = path.join(voice.tmpDir, `repair-${v.id}`);
    const tmpJson = `${tmpOnnx}.json`;
    try {
      await download(`${onnxUrl}.json`, tmpJson, () => {});
      if (needsOldVersion(tmpJson)) throw new Error('v1.0.0 config is also new-style');
      await download(onnxUrl, tmpOnnx, () => {});
      fs.copyFileSync(tmpOnnx, v.file);
      fs.copyFileSync(tmpJson, `${v.file}.json`);
      fixed.push(v.id);
    } catch (err) {
      // 404 = this voice has no v1.0.0 version; don't retry every launch
      if (/\(404\)|also new-style/.test(err.message)) { skip.push(v.id); fs.writeFileSync(skipFile, JSON.stringify(skip)); }
    } finally {
      fs.rmSync(tmpOnnx, { force: true });
      fs.rmSync(tmpJson, { force: true });
    }
  }
  return fixed;
}

/** Download url -> file, reporting progress. Writes to .part first so a failed download never looks finished. */
async function download(url, dest, onProgress) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${path.basename(dest)}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  let lastPct = -1;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== lastPct) { lastPct = pct; onProgress(pct, got, total); }
  });
  const part = `${dest}.part`;
  await pipeline(body, fs.createWriteStream(part));
  if (total && got < total) throw new Error(`Download of ${path.basename(dest)} was cut off. Try again.`);
  fs.renameSync(part, dest);
}

/** Run a program and wait; rejects with its error output. */
function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `${path.basename(cmd)} exited with ${code}`))));
  });
}

/** Unzip with Windows' built-in tar.exe (Windows 10+), falling back to PowerShell. */
async function unzip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  try {
    await exec(tar, ['-xf', zip, '-C', destDir]);
  } catch {
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`]);
  }
}

/**
 * Install whatever is missing.
 * @param {import('./voice').VoiceEngines} voice  Violet's voice engine (knows the folders + what's installed)
 * @param {(p: {step: string, percent: number}) => void} onProgress
 * @returns {Promise<string[]>} names of the things installed
 */
async function installVoiceFeatures(voice, onProgress = () => {}) {
  const st = voice.status();
  const { whisper: whisperDir, piper: piperDir, voices: voicesDir } = st.dirs;
  const tmp = voice.tmpDir;
  const done = [];
  const step = (name) => (pct, got, total) => onProgress({
    step: name,
    percent: pct,
    detail: total ? `${(got / 1048576).toFixed(0)} / ${(total / 1048576).toFixed(0)} MB` : ''
  });

  if (!st.whisper) {
    const zip = path.join(tmp, 'whisper-bin-x64.zip');
    await download(URLS.whisperZip, zip, step('Downloading speech recognition'));
    onProgress({ step: 'Unpacking speech recognition', percent: 100 });
    await unzip(zip, whisperDir);
    fs.rmSync(zip, { force: true });
    if (!voice.whisperExe()) throw new Error('Speech recognition downloaded, but whisper-cli.exe was not in the zip.');
    done.push('speech recognition');
  }
  if (!voice.listModels().length) {
    await download(URLS.whisperModel, path.join(whisperDir, 'ggml-base.en.bin'), step('Downloading English speech model'));
    done.push('speech model');
  }
  if (!st.piper) {
    const zip = path.join(tmp, 'piper_windows_amd64.zip');
    await download(URLS.piperZip, zip, step('Downloading Piper voices'));
    onProgress({ step: 'Unpacking Piper', percent: 100 });
    await unzip(zip, piperDir);
    fs.rmSync(zip, { force: true });
    done.push('Piper');
  }
  if (!voice.listVoices().length) {
    await download(URLS.voiceJson, path.join(voicesDir, 'en_US-amy-medium.onnx.json'), step('Downloading Amy voice'));
    await download(URLS.voiceOnnx, path.join(voicesDir, 'en_US-amy-medium.onnx'), step('Downloading Amy voice'));
    done.push('Amy voice');
  }
  return done;
}

module.exports = { installVoiceFeatures, repairVoices, voiceUrl };
