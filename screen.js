// ============================================================
// Violet - screen capture
// Grabs the primary monitor, shrinks it (smaller image = faster
// replies and less of your usage limit), and saves it as a JPEG
// inside Claude's workspace so Claude's Read tool can open it.
// Also returns the scale needed to turn screenshot coordinates
// back into real screen pixels for clicking.
// ============================================================
const { desktopCapturer, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_WIDTH = 1280; // good balance: readable text, not too heavy

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * @param {string} dir        folder to save into
 * @param {string} name       file name without extension
 * @param {Array<BrowserWindow>} hideWindows  Violet windows to hide during the shot
 */
async function captureScreen(dir, name, hideWindows = []) {
  fs.mkdirSync(dir, { recursive: true });

  const display = screen.getPrimaryDisplay();
  // Physical pixels (what the mouse driver uses, since it's DPI aware)
  const physW = Math.round(display.size.width * display.scaleFactor);
  const physH = Math.round(display.size.height * display.scaleFactor);
  const targetW = Math.min(MAX_WIDTH, physW);
  const targetH = Math.round(physH * (targetW / physW));

  // Hide Violet so it doesn't photograph itself.
  const wereVisible = hideWindows.filter(w => w && !w.isDestroyed() && w.isVisible());
  wereVisible.forEach(w => w.hide());
  if (wereVisible.length) await sleep(180); // give Windows a moment to repaint

  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: targetW, height: targetH }
    });
  } finally {
    // showInactive = come back without stealing focus from the app being controlled
    wereVisible.forEach(w => { if (!w.isDestroyed()) w.showInactive(); });
  }

  const source = sources.find(s => s.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('Could not capture the screen.');
  }

  const img = source.thumbnail;
  const { width, height } = img.getSize();
  const file = path.join(dir, `${name}.jpg`);
  fs.writeFileSync(file, img.toJPEG(80));

  return {
    file,
    width,
    height,
    // multiply screenshot coords by these to get real pixels
    scaleX: physW / width,
    scaleY: physH / height
  };
}

// Delete old screenshots so the folder doesn't grow forever.
function clearScreenshots(dir) {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.jpg')) fs.unlinkSync(path.join(dir, f));
    }
  } catch { /* folder may not exist yet */ }
}

module.exports = { captureScreen, clearScreenshots };
