(() => {
  const canvas = document.getElementById('drawing-canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const color = document.getElementById('drawing-color');
  const size = document.getElementById('drawing-size');
  const draw = document.getElementById('drawing-draw');
  const erase = document.getElementById('drawing-erase');
  const clear = document.getElementById('drawing-clear');
  const send = document.getElementById('drawing-send');
  const status = document.getElementById('drawing-status');
  const gallery = document.getElementById('drawing-gallery');
  const galleryStatus = document.getElementById('drawing-gallery-status');
  const controls = document.querySelectorAll('.drawing-tools input, .drawing-tools button');
  const displayed = new Set();
  let erasing = false;
  let pointer = null;
  let previous;
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

  function clearCanvas() {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    status.textContent = '';
  }
  function selectTool(value) {
    erasing = value;
    draw.setAttribute('aria-pressed', String(!value));
    erase.setAttribute('aria-pressed', String(value));
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - canvas.clientLeft) * canvas.width / canvas.clientWidth,
      y: (event.clientY - rect.top - canvas.clientTop) * canvas.height / canvas.clientHeight,
    };
  }
  function stroke(event) {
    const next = point(event);
    context.strokeStyle = erasing ? '#ffffff' : color.value;
    context.lineWidth = Number(size.value);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    previous = next;
  }
  canvas.addEventListener('pointerdown', event => {
    if (busy || pointer !== null || event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture(pointer);
    previous = point(event);
    context.fillStyle = erasing ? '#ffffff' : color.value;
    context.beginPath();
    context.arc(previous.x, previous.y, Number(size.value) / 2, 0, Math.PI * 2);
    context.fill();
    status.textContent = '';
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    const points = event.getCoalescedEvents?.();
    for (const sample of points?.length ? points : [event]) stroke(sample);
  });
  function endStroke(event) {
    if (event.pointerId !== pointer) return;
    if (event.type === 'pointerup') stroke(event);
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('lostpointercapture', endStroke);
  draw.addEventListener('click', () => selectTool(false));
  erase.addEventListener('click', () => selectTool(true));
  clear.addEventListener('click', clearCanvas);
  color.addEventListener('input', () => selectTool(false));
  size.addEventListener('input', () => { document.getElementById('drawing-size-value').value = size.value; });

  function blank() {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) return false;
    }
    return true;
  }
  function addDrawing(drawing) {
    if (!/^\d{13}-[a-f0-9]{32}\.png$/.test(drawing.filename) || displayed.has(drawing.filename)) return;
    displayed.add(drawing.filename);
    const link = document.createElement('a');
    link.href = `/drawings/${drawing.filename}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.filename = drawing.filename;
    const image = new Image(640, 480);
    image.src = link.href;
    image.alt = `Visitor drawing sent ${new Date(drawing.createdAt).toLocaleString()}`;
    image.loading = 'lazy';
    link.append(image);
    const next = [...gallery.children].find(item => item.dataset.filename < drawing.filename);
    gallery.insertBefore(link, next || null);
  }
  async function loadGallery() {
    try {
      const response = await fetch('/api/drawings', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const drawings = await response.json();
      if (!Array.isArray(drawings)) throw new Error();
      for (const drawing of drawings) addDrawing(drawing);
      galleryStatus.textContent = displayed.size ? '' : 'No drawings yet. Leave the first one!';
    } catch { galleryStatus.textContent = "Couldn't load drawings. Please refresh to try again."; }
  }
  send.addEventListener('click', async () => {
    if (busy) return;
    if (blank()) { status.textContent = 'Draw something before sending.'; return; }
    busy = true;
    for (const control of controls) control.disabled = true;
    status.textContent = 'Sending...';
    try {
      await challengeReady;
      if (challengeWidget !== undefined && !challengeToken) throw new Error('Please complete the drawing challenge.');
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
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
    }
  });
  clearCanvas();
  loadGallery();
})();
