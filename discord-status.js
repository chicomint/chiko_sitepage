(() => {
  'use strict';
  const widget = document.getElementById('discord-status');
  if (!widget) return;
  const label = widget.querySelector('.discord-label'), duration = widget.querySelector('.discord-duration');
  const names = { online: "I'm Online!", idle: "I'm Idle!", dnd: "I'm Busy!", offline: "I'm Offline!" };
  let state, receivedAt = 0, source, pollTimer, staleTimer, stopped = false;
  function elapsed(ms) {
    const minutes = Math.floor(Math.max(0, ms) / 60000);
    if (!minutes) return 'less than a minute';
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), mins = minutes % 60;
    return [[days, 'day'], [hours, 'hour'], [mins, 'minute']].filter(([n]) => n).slice(0, 2).map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`).join(', ');
  }
  function tick() {
    const since = state?.since ? Date.parse(state.since) : NaN;
    duration.textContent = state?.available && Number.isFinite(since) && Number.isFinite(state.serverNow)
      ? elapsed(state.serverNow + performance.now() - receivedAt - since) : 'Duration unavailable';
  }
  function unavailable() { if (state) state.available = false; widget.dataset.status = 'unknown'; label.textContent = 'Status unavailable'; tick(); }
  function update(data) {
    state = data; receivedAt = performance.now();
    widget.dataset.status = data.available && names[data.status] ? data.status : 'unknown';
    label.textContent = data.available && names[data.status] ? names[data.status] : 'Status unavailable';
    clearTimeout(staleTimer); staleTimer = setTimeout(unavailable, 90000); tick();
  }
  async function poll() {
    try { const response = await fetch('/api/discord/status', { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(); update(await response.json()); }
    catch { unavailable(); }
  }
  function connect() {
    if (stopped || document.hidden) return;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/discord/events');
      source.onmessage = event => { try { update(JSON.parse(event.data)); } catch { unavailable(); } };
      source.onerror = () => { unavailable(); void poll(); };
    }
    void poll(); pollTimer = setInterval(poll, 30000);
  }
  function disconnect() { source?.close(); source = null; clearInterval(pollTimer); clearTimeout(staleTimer); }
  document.addEventListener('visibilitychange', () => { disconnect(); if (!document.hidden) connect(); });
  window.addEventListener('pagehide', () => { stopped = true; disconnect(); });
  window.addEventListener('pageshow', () => { if (stopped) { stopped = false; connect(); } });
  setInterval(tick, 1000); connect();
})();
