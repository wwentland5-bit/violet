// ============================================================
// Violet v4.5 UI: automatic updates
// - "Update ready" pill in the title bar (click = restart & update)
// - Settings → General → Updates (GitHub username, toggles, Check now)
// - "What's new" card after an update
// - Palette + /update command
// Loaded after v4.js; setupV5() is called from v4.js's startup.
// ============================================================
let updState = { state: 'idle' };

const UPD_DOT = { ready: '#4ade80', downloading: '#60a5fa', checking: '#60a5fa', 'up-to-date': '#4ade80', error: '#f87171', 'not-set-up': '#fbbf24', off: '#94a3b8', dev: '#94a3b8', idle: '#94a3b8' };

function renderUpdate(st) {
  updState = st || updState;
  const s = updState;
  // Title bar pill
  const pill = $('update-pill');
  pill.hidden = !(s.state === 'ready' || s.state === 'downloading');
  pill.classList.toggle('ready', s.state === 'ready');
  $('update-pill-text').textContent = s.state === 'ready' ? `Update to ${s.version}` : `Downloading ${s.percent || 0}%`;
  pill.title = s.state === 'ready' ? 'Click to restart Violet and finish updating' : 'Downloading an update in the background';
  // Settings card
  $('upd-version').textContent = `Violet ${s.current || ''}`;
  $('upd-msg').textContent = s.message || '';
  $('upd-dot').style.background = UPD_DOT[s.state] || '#94a3b8';
  $('upd-bar').hidden = s.state !== 'downloading';
  $('upd-bar-fill').style.width = `${s.percent || 0}%`;
  $('btn-upd-install').hidden = s.state !== 'ready';
  $('btn-upd-install').textContent = s.state === 'ready' ? `Restart & update to ${s.version}` : 'Restart & update';
}

async function installUpdate() {
  if (updState.state !== 'ready') { toast('No update is ready yet.'); return; }
  if (busy) { toast('Wait for Violet to finish, then try again.'); return; }
  toast('Updating… Violet will reopen in a few seconds.', 6000);
  await window.violet.updates.install();
}

async function checkUpdates() {
  toast('Checking for updates…');
  renderUpdate(await window.violet.updates.check());
}

function openUpdatesSettings() {
  openSettings();
  document.querySelector('.tab[data-tab="general"]').click();
  setTimeout(() => $('updates-section').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

async function showWhatsNew() {
  const w = await window.violet.updates.whatsNew();
  if (!w) return;
  $('wn-title').textContent = `✨ Violet updated to ${w.version}`;
  $('wn-body').innerHTML = window.renderMarkdown(w.notes || 'Bug fixes and improvements.');
  $('whats-new').hidden = false;
  toast(`Violet updated to ${w.version}`);
}

window.setupV5 = function () {
  // Settings fields
  const openSettingsV4 = window.openSettings;
  window.openSettings = function () {
    openSettingsV4();
    $('set-updaterepo').value = settings.updateRepo || '';
    $('set-autoupdate').checked = settings.autoUpdate !== false;
    $('set-autoinstall').checked = settings.autoInstallUpdates !== false;
    window.violet.updates.status().then(renderUpdate);
  };
  $('set-updaterepo').addEventListener('change', async (e) => {
    const v = e.target.value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/+$/, '');
    e.target.value = v;
    await saveSettings({ updateRepo: v });
    toast(v ? `Updates will come from github.com/${v.includes('/') ? v : `${v}/violet`}` : 'Updates turned off (no username)');
    setTimeout(() => window.violet.updates.status().then(renderUpdate), 300);
  });
  $('set-autoupdate').addEventListener('change', (e) => saveSettings({ autoUpdate: e.target.checked }));
  $('set-autoinstall').addEventListener('change', (e) => saveSettings({ autoInstallUpdates: e.target.checked }));
  $('btn-upd-check').addEventListener('click', checkUpdates);
  $('btn-upd-install').addEventListener('click', installUpdate);
  $('update-pill').addEventListener('click', () => (updState.state === 'ready' ? installUpdate() : openUpdatesSettings()));
  $('wn-close').addEventListener('click', () => { $('whats-new').hidden = true; });

  window.violet.updates.onStatus((st) => {
    const wasReady = updState.state === 'ready';
    renderUpdate(st);
    if (st.state === 'ready' && !wasReady) toast(`⬆ Violet ${st.version} is ready. Click the green button up top to update.`, 6000);
  });
  window.violet.win.onCommand((cmd) => { if (cmd === 'open-updates') openUpdatesSettings(); });

  // Palette actions + /update command
  const baseActionsV4 = window.baseActions;
  window.baseActions = function () {
    const list = baseActionsV4();
    list.push({ group: 'Actions', label: 'Check for updates', icon: '⬆', run: checkUpdates });
    if (updState.state === 'ready') list.unshift({ group: 'Actions', label: `Restart & update to ${updState.version}`, icon: '⬆', run: installUpdate });
    return list;
  };
  SLASH.push({ cmd: '/update', desc: 'Check for updates (or install one that\'s ready)', run: () => (updState.state === 'ready' ? installUpdate() : checkUpdates()) });

  window.violet.updates.status().then(renderUpdate);
  showWhatsNew();
};
