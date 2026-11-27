// ============================================================
// Violet — YouTube link checker
// Before Violet shows a YouTube video (dashboard widget) or a
// YouTube link in chat, it asks YouTube whether the video still
// exists. Removed, private and terminated-channel videos are
// caught here, so Violet never pops up a dead link.
//
//  • Videos: YouTube's public oEmbed endpoint. It answers 200 with
//    the title/channel for a playable video and an error (401/403/
//    404) for removed, private or non-embeddable ones.
//  • Channels (@name, /channel/…): the page is fetched and checked
//    for a 404 or YouTube's "terminated" notice.
// Results are cached for 30 minutes.
// ============================================================
const { net } = require('electron');

const cache = new Map(); // url -> { at, result }
const TTL = 30 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

/** Is this a YouTube address at all? */
function isYouTube(url) {
  try {
    const h = new URL(url).hostname.replace(/^(www|m|music)\./, '');
    return h === 'youtube.com' || h === 'youtu.be' || h === 'youtube-nocookie.com';
  } catch { return false; }
}

/** Video id from any common YouTube URL shape, or null. */
function videoId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (h.endsWith('youtube.com') || h.endsWith('youtube-nocookie.com')) {
      return u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{6,})/) || [])[1] || null;
    }
  } catch { /* not a URL */ }
  return null;
}

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.8' } });
  } finally { clearTimeout(timer); }
}

/**
 * Check a YouTube URL.
 * @returns {Promise<{ok: boolean, reason?: string, title?: string, author?: string, unknown?: boolean}>}
 *   ok:false means "don't show it". unknown:true means we couldn't reach YouTube
 *   (offline, timeout); that is treated as ok so Violet doesn't hide good links.
 */
async function checkYouTube(url) {
  if (!isYouTube(url)) return { ok: true };
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.result;

  let result;
  try {
    const id = videoId(url);
    if (id) {
      const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      const res = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`);
      if (res.ok) {
        const info = await res.json().catch(() => ({}));
        result = { ok: true, title: String(info.title || ''), author: String(info.author_name || '') };
      } else if (res.status === 401 || res.status === 403) {
        result = { ok: false, reason: 'is private or can\'t be played outside YouTube' };
      } else if (res.status === 404 || res.status === 400) {
        result = { ok: false, reason: 'was removed (or its channel was terminated)' };
      } else {
        result = { ok: true, unknown: true };
      }
    } else if (/\/(@[\w.-]+|channel\/|c\/|user\/)/.test(new URL(url).pathname)) {
      const res = await fetchWithTimeout(url);
      if (res.status === 404) result = { ok: false, reason: 'channel doesn\'t exist' };
      else {
        const html = (await res.text()).slice(0, 600000);
        result = /This account has been terminated|channel was removed|This channel does not exist/i.test(html)
          ? { ok: false, reason: 'channel was terminated' }
          : { ok: true };
      }
    } else {
      result = { ok: true }; // search pages, playlists, home: nothing to verify
    }
  } catch {
    result = { ok: true, unknown: true };
  }
  if (!result.unknown) cache.set(url, { at: Date.now(), result });
  return result;
}

module.exports = { checkYouTube, isYouTube, videoId };
