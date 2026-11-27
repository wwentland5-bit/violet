// ============================================================
// Shared theme helper for the browser and widget windows.
// Applies a theme's colors as CSS variables, plus --panel-bg
// (a solid color or gradient that works without animations).
// ============================================================
(function () {
  const VAR_MAP = {
    bg: '--bg', surface: '--surface', surface2: '--surface-2', text: '--text',
    muted: '--muted', accent: '--accent', accent2: '--accent-2', border: '--border',
    glow: '--glow', codeBg: '--code-bg'
  };

  function applyThemeColors(theme) {
    if (!theme) return;
    const root = document.documentElement;
    root.removeAttribute('style');
    for (const [k, v] of Object.entries(theme.colors || {})) {
      if (VAR_MAP[k] && typeof v === 'string') root.style.setProperty(VAR_MAP[k], v);
    }
    if (typeof theme.font === 'string') root.style.setProperty('--font', theme.font);
    if (typeof theme.radius === 'number') root.style.setProperty('--radius', `${theme.radius}px`);

    // A background that looks right in small windows: gradient colors if the theme has them.
    const bg = theme.background || {};
    const colors = Array.isArray(bg.colors) ? bg.colors.filter(c => typeof c === 'string') : [];
    let panel = theme.colors && theme.colors.bg;
    if (colors.length >= 2 && bg.type !== 'aurora') panel = `linear-gradient(${Number(bg.angle) || 135}deg, ${colors.join(', ')})`;
    else if (colors.length && bg.type === 'aurora') {
      // Aurora: a soft static version of the blobs
      panel = `radial-gradient(circle at 15% 10%, ${colors[0]}66, transparent 55%),` +
        `radial-gradient(circle at 90% 95%, ${colors[1] || colors[0]}55, transparent 55%), ${theme.colors.bg || 'rgba(10,8,22,0.92)'}`;
    }
    if (!panel || panel === 'transparent') panel = 'rgba(18,12,30,0.92)';
    root.style.setProperty('--panel-bg', panel);
  }

  window.applyThemeColors = applyThemeColors;
})();
