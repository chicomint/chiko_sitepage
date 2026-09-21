(() => {
  const script = document.currentScript;
  const endpoint = new URL('/presence', location.href);
  endpoint.protocol = endpoint.protocol === 'https:' || endpoint.protocol === 'wss:' ? 'wss:' : 'ws:';
  const asset = new URL('media/miku-miku-oo-ee-oo/Normal_96.gif', script.src);
  const still = new URL('media/miku-miku-oo-ee-oo/Normal_96-static.png', script.src);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const mouse = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const peers = new Map();
  const key = 'chicomint-visitor';
  let token = '';
  let socket;
  let ready = false;
  let stopped = false;
  let connecting = false;
  let retry;
  let attempts = 0;
  let pending;
  let movementTimer;
  let lastSent = 0;
  let cursorVisible = false;
  const active = () => !document.hidden;
  const readToken = () => { try { return localStorage.getItem(key) || token; } catch { return token; } };
  const writeToken = (value) => { token = value; try { localStorage.setItem(key, value); } catch {} };
  function send(message) {
    if (ready && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 4096) socket.send(JSON.stringify(message));
  }
  function remove(id) { peers.get(id)?.element.remove(); peers.delete(id); }
  function clearPeers() { for (const id of peers.keys()) remove(id); }
  function position(peer) {
    peer.element.style.transform = `translate3d(${peer.x * innerWidth}px, ${peer.y * innerHeight}px, 0)`;
  }
  function showPeer(data) {
    if (!active() || typeof data.id !== 'string' || typeof data.label !== 'string' ||
        !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    let peer = peers.get(data.id);
    if (!peer) {
      const element = document.createElement('div');
      element.className = 'remote-cursor';
      element.setAttribute('aria-hidden', 'true');
      const image = new Image(96, 96);
      image.alt = '';
      image.draggable = false;
      image.src = reducedMotion.matches ? still.href : asset.href;
      const label = document.createElement('span');
      label.textContent = data.label;
      element.append(image, label);
      document.body.append(element);
      peer = { element, image };
      peers.set(data.id, peer);
    }
    peer.x = Math.max(0, Math.min(1, data.x));
    peer.y = Math.max(0, Math.min(1, data.y));
    position(peer);
  }
  function updateStats(data) {
    for (const field of ['visits', 'online']) {
      if (!Number.isSafeInteger(data[field]) || data[field] < 0) continue;
      for (const element of document.querySelectorAll(`[data-presence-stat="${field}"]`)) {
        element.textContent = data[field].toLocaleString();
        if (field === 'online') element.title = 'Live visitors connected to the site';
      }
    }
  }
  function offline() {
    for (const element of document.querySelectorAll('[data-presence-stat="online"]')) {
      element.textContent = 'offline';
      element.title = 'Live cursors are disconnected. Open the site served by Node.js; the server or its WebSocket connection is unavailable.';
    }
  }
  function cancelMovement() {
    clearTimeout(movementTimer);
    movementTimer = null;
    pending = null;
  }
  function hideCursor() {
    cancelMovement();
    if (cursorVisible) send({ type: 'hide' });
    cursorVisible = false;
  }
  function flushCursor() {
    movementTimer = null;
    if (!pending || !ready || !active()) return;
    send({ type: 'cursor', ...pending });
    cursorVisible = true;
    pending = null;
    lastSent = performance.now();
  }
  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || !mouse.matches || !active() || !ready) return;
    pending = { x: event.clientX / innerWidth, y: event.clientY / innerHeight };
    if (!movementTimer) movementTimer = setTimeout(flushCursor, Math.max(0, 40 - (performance.now() - lastSent)));
  }, { passive: true });
  document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) cancelMovement(); });
  document.addEventListener('pointerdown', (event) => { if (event.pointerType !== 'mouse') hideCursor(); });
  document.addEventListener('dragstart', hideCursor);
  window.addEventListener('scroll', hideCursor, true);
  window.addEventListener('resize', () => { hideCursor(); for (const peer of peers.values()) position(peer); });
  reducedMotion.addEventListener('change', () => {
    for (const peer of peers.values()) peer.image.src = reducedMotion.matches ? still.href : asset.href;
  });

  function scheduleReconnect() {
    if (stopped || document.hidden || retry) return;
    retry = setTimeout(() => { retry = null; connect(); }, Math.min(30000, 1000 * 2 ** attempts++) + Math.random() * 500);
  }
  function openSocket() {
    return new Promise((done) => {
      if (stopped) { done(); return; }
      let current;
      try { current = socket = new WebSocket(endpoint); }
      catch { offline(); scheduleReconnect(); done(); return; }
      const timeout = setTimeout(() => { current.close(); done(); }, 8000);
      const finish = () => { clearTimeout(timeout); done(); };
      current.addEventListener('open', () => {
        current.send(JSON.stringify({ type: 'hello', token: readToken(), page: location.pathname, active: active() }));
      });
      current.addEventListener('message', (event) => {
        if (socket !== current) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'welcome') {
          writeToken(data.token);
          ready = true;
          attempts = 0;
          send({ type: 'active', active: active() });
          finish();
        } else if (data.type === 'stats') updateStats(data);
        else if (data.type === 'cursor') showPeer(data);
        else if (data.type === 'leave') remove(data.id);
        else if (data.type === 'snapshot' && Array.isArray(data.peers)) {
          clearPeers();
          for (const peer of data.peers) showPeer(peer);
        }
      });
      current.addEventListener('close', () => {
        finish();
        if (socket !== current) return;
        ready = false;
        hideCursor();
        clearPeers();
        offline();
        scheduleReconnect();
      });
      current.addEventListener('error', () => current.close());
    });
  }
  async function connect() {
    if (connecting || stopped || (socket && socket.readyState < WebSocket.CLOSING)) return;
    connecting = true;
    try {
      // Serializes first-time identity creation across tabs on this origin.
      if (navigator.locks) await navigator.locks.request('chicomint-presence-identity', openSocket);
      else await openSocket();
    } finally { connecting = false; }
  }
  function activityChanged() {
    cancelMovement();
    if (!active()) clearPeers();
    send({ type: 'active', active: active() });
    if (!document.hidden && !ready) { clearTimeout(retry); retry = null; connect(); }
  }
  document.addEventListener('visibilitychange', activityChanged);
  window.addEventListener('focus', activityChanged);
  window.addEventListener('pagehide', () => {
    stopped = true;
    clearTimeout(retry);
    retry = null;
    hideCursor();
    clearPeers();
    socket?.close();
  });
  window.addEventListener('pageshow', () => { stopped = false; connect(); });
  connect();
})();
