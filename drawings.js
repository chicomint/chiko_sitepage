(() => {
  'use strict';
  const location = new URL(window.location.href);
  if (location.pathname === '/drawings' && location.searchParams.get('restored') === '1') {
    location.searchParams.delete('restored');
    history.replaceState(history.state, '', location.pathname + location.search + location.hash);
  }
  const board = window.ChikoDrawingBoard;
  const canvas = board.canvas;
  const send = document.getElementById('drawing-send');
  const status = document.getElementById('drawing-status');
  const gallery = document.getElementById('drawing-gallery');
  const galleryStatus = document.getElementById('drawing-gallery-status');
  const displayed = new Set();
  const controls = document.querySelectorAll('.drawing-tools input, .drawing-tools button, .drawing-layer-actions input');
  let busy = false;
  let challengeWidget;
  let challengeToken = '';
  const challengeReady = fetch('/api/drawings/config').then(async response => {
    if (!response.ok) throw new Error('Unable to load drawing settings. Refresh to try again.');
    const config = await response.json();
    if (!config.turnstileSiteKey) return;
    const container = document.createElement('div');
    status.before(container);
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Unable to load drawing challenge. Refresh to try again.'));
      document.head.append(script);
    });
    challengeWidget = window.turnstile.render(container, {
      sitekey: config.turnstileSiteKey, action: 'drawing',
      callback: token => { challengeToken = token; },
      'expired-callback': () => { challengeToken = ''; },
      'error-callback': () => { challengeToken = ''; },
    });
  });
  challengeReady.catch(error => { status.textContent = error.message; });

  function blank(image) {
    const pixels = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255)) return false;
    return true;
  }
  function addDrawing(drawing) {
    const key = drawing._id || drawing.filename;
    const url = drawing.image || drawing.url || `/drawings/${drawing.filename}`;
    if (!key || displayed.has(key) || !/^\/(?:uploads\/[a-f0-9]{24}|drawings\/\d{13}-[a-f0-9]{32}\.png)$/.test(url)) return;
    displayed.add(key);
    const figure = document.createElement('figure');
    const link = document.createElement('a'); link.href = url;
    const image = new Image(640, 480); image.src = drawing.thumbnail || url;
    image.alt = drawing.title || 'Visitor drawing'; image.loading = 'lazy'; link.append(image);
    const caption = document.createElement('figcaption');
    const date = drawing.date || drawing.createdAt;
    const time = document.createElement('time'); time.dateTime = date || '';
    time.textContent = date ? new Date(date.length === 10 ? date + 'T00:00:00' : date).toLocaleDateString() : '';
    caption.append(time);
    figure.append(link, caption); gallery.prepend(figure);
  }
  async function loadGallery() {
    try {
      const response = await fetch('/api/drawings', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const drawings = await response.json();
      if (!Array.isArray(drawings)) throw new Error();
      gallery.replaceChildren(); displayed.clear();
      for (const drawing of [...drawings].reverse()) addDrawing(drawing);
      galleryStatus.textContent = displayed.size ? '' : 'No drawings yet. Leave the first one!';
    } catch { galleryStatus.textContent = "Couldn't load drawings. Please refresh to try again."; }
  }
  send.addEventListener('click', async () => {
    if (busy || board.isBusy()) return;
    const image = board.exportCanvas();
    if (blank(image)) { status.textContent = 'Draw something before sending.'; return; }
    busy = true; board.setBusy(true);
    for (const control of controls) control.disabled = true;
    status.textContent = 'Sending...';
    try {
      await challengeReady;
      if (challengeWidget !== undefined && !challengeToken) throw new Error('Please complete the drawing challenge.');
      const blob = await new Promise(resolve => image.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error("Couldn't create the drawing image.");
      if (blob.size > 2 * 1024 * 1024) throw new Error('Drawing is too large (maximum 2 MiB).');
      const response = await fetch('/api/drawings', {
        method: 'POST', headers: { 'Content-Type': 'image/png', ...(challengeToken ? { 'X-Turnstile-Token': challengeToken } : {}) }, body: blob,
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) {
        const messages = { 413: 'Drawing is too large (maximum 2 MiB).',
          429: "You're sending drawings too quickly. Try again later.",
          400: 'Please send a valid, non-empty drawing.',
          403: 'Please refresh and complete the drawing challenge if shown.',
          507: 'Drawing storage is full. Please try again later.',
          422: 'Draw something before sending.',
          503: 'Drawing board is busy. Please try again shortly.' };
        throw new Error(messages[response.status] || "Couldn't send drawing. Please try again.");
      }
      addDrawing(await response.json());
      galleryStatus.textContent = '';
      status.textContent = 'Drawing sent!';
      // Leave the canvas intact so visitors can keep it or clear it themselves.
    } catch (error) {
      status.textContent = error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)
        ? "Couldn't send drawing. Check your connection and try again." : error.message;
    } finally {
      if (challengeWidget !== undefined) { challengeToken = ''; window.turnstile.reset(challengeWidget); }
      busy = false;
      for (const control of controls) control.disabled = false;
      board.setBusy(false);
    }
  });
  if (gallery.children.length) {
    for (const link of gallery.querySelectorAll('a')) displayed.add(link.getAttribute('href').split('/').pop());
  } else loadGallery();
})();
