(() => {
  'use strict';
  const canvas = document.getElementById('drawing-canvas') || document.getElementById('board');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const color = document.getElementById('drawing-color'), size = document.getElementById('drawing-size');
  const status = document.getElementById('drawing-status');
  const list = document.getElementById('drawing-layers');
  const undoButton = document.getElementById('drawing-undo'), redoButton = document.getElementById('drawing-redo');
  const tools = document.querySelectorAll('[data-drawing-tool]');
  const draftKey = canvas.id === 'board' ? 'fullscreen' : 'public';
  const undoStack = [], redoStack = [];
  let layers = [], selected, tool = 'draw', stroke = null, frame = null, saveTimer, busy = true, db, saving = Promise.resolve();
  let nextId = 1;
  const newCanvas = () => { const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; return c; };
  const copy = c => { const result = newCanvas(); result.getContext('2d').drawImage(c, 0, 0); return result; };
  const active = () => layers.find(layer => layer.id === selected);
  function snapshot() { return { selected, layers: layers.map(layer => ({ ...layer, canvas: copy(layer.canvas) })) }; }
  function remember() {
    undoStack.push(snapshot()); redoStack.length = 0;
    // Bound history memory (64 MiB), including multi-layer actions.
    while (undoStack.length > 20 || undoStack.length > 1 && undoStack.reduce((n, s) => n + s.layers.length * canvas.width * canvas.height * 4, 0) > 64 * 1024 * 1024) undoStack.shift();
  }
  function render(target = context, preview = true) {
    target.clearRect(0, 0, canvas.width, canvas.height);
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (preview && stroke && layer.id === selected) {
        const image = copy(layer.canvas), ctx = image.getContext('2d');
        segment(ctx, stroke.mid, stroke.last, stroke.last.width, stroke.last.width, stroke.erase);
        target.drawImage(image, 0, 0);
      } else target.drawImage(layer.canvas, 0, 0);
    }
  }
  function scheduleRender() { if (frame === null) frame = requestAnimationFrame(() => { frame = null; render(); }); }
  function updatePanel() {
    list.replaceChildren();
    for (const layer of [...layers].reverse()) {
      const row = document.createElement('div'); row.className = 'drawing-layer'; row.dataset.layerId = layer.id;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = layer.visible;
      checkbox.setAttribute('aria-label', 'Show ' + layer.name); checkbox.disabled = busy || !!stroke;
      checkbox.addEventListener('change', () => change(() => { layer.visible = checkbox.checked; }));
      const button = document.createElement('button'); button.type = 'button'; button.textContent = layer.name;
      button.setAttribute('aria-pressed', String(layer.id === selected)); button.disabled = busy || !!stroke;
      button.addEventListener('click', () => { selected = layer.id; updatePanel(); persistSoon(); });
      row.append(checkbox, button); list.append(row);
    }
    undoButton.disabled = busy || !!stroke || !undoStack.length; redoButton.disabled = busy || !!stroke || !redoStack.length;
    for (const el of document.querySelectorAll('.drawing-layer-actions button')) el.disabled = busy || !!stroke;
    document.getElementById('drawing-layer-delete').disabled ||= layers.length === 1;
    document.getElementById('drawing-layer-add').disabled ||= layers.length >= 12;
    document.getElementById('drawing-layer-up').disabled ||= layers.indexOf(active()) === layers.length - 1;
    document.getElementById('drawing-layer-down').disabled ||= layers.indexOf(active()) === 0;
    document.getElementById('drawing-layer-name').value = active()?.name || '';
  }
  function change(work) {
    if (busy || stroke) return;
    remember(); work(); render(); updatePanel(); persistSoon();
  }
  function restore(from, to) {
    if (busy || stroke || !from.length) return;
    to.push(snapshot()); const state = from.pop(); layers = state.layers; selected = state.selected;
    render(); updatePanel(); persistSoon();
  }
  function setTool(value) { if (stroke) return; tool = value; for (const button of tools) button.setAttribute('aria-pressed', String(button.dataset.drawingTool === value)); }
  for (const button of tools) button.addEventListener('click', () => setTool(button.dataset.drawingTool));
  color.addEventListener('input', () => setTool('draw'));
  size.addEventListener('input', () => { document.getElementById('drawing-size-value').value = size.value; });
  document.getElementById('drawing-layer-add').addEventListener('click', () => change(() => {
    if (layers.length >= 12) return;
    const layer = { id: nextId++, name: 'Layer ' + (nextId - 1), visible: true, canvas: newCanvas() };
    layers.push(layer); selected = layer.id;
  }));
  document.getElementById('drawing-layer-delete').addEventListener('click', () => change(() => {
    if (layers.length === 1) return;
    const index = layers.indexOf(active()); layers.splice(index, 1); selected = layers[Math.min(index, layers.length - 1)].id;
  }));
  document.getElementById('drawing-layer-rename').addEventListener('click', () => {
    const name = document.getElementById('drawing-layer-name').value.trim(); if (name) change(() => { active().name = name.slice(0, 40); });
  });
  for (const [id, delta] of [['drawing-layer-up', 1], ['drawing-layer-down', -1]]) document.getElementById(id).addEventListener('click', () => change(() => {
    const index = layers.indexOf(active()), next = index + delta;
    if (next >= 0 && next < layers.length) [layers[index], layers[next]] = [layers[next], layers[index]];
  }));
  function clearAll() {
    if (busy || stroke || !window.confirm('Clear all drawings on every layer? This includes hidden layers.')) return;
    change(() => {
      for (const layer of layers) layer.canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      status.textContent = 'All layers cleared.';
    });
  }
  document.getElementById('drawing-clear').addEventListener('click', clearAll);
  document.getElementById('floatingButton')?.addEventListener('click', clearAll);
  undoButton.addEventListener('click', () => restore(undoStack, redoStack));
  redoButton.addEventListener('click', () => restore(redoStack, undoStack));
  document.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select, [contenteditable]') || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? restore(redoStack, undoStack) : restore(undoStack, redoStack); }
    else if (event.key.toLowerCase() === 'y') { event.preventDefault(); restore(redoStack, undoStack); }
  });
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const pressure = event.pointerType === 'pen' && event.pressure > 0 ? Math.max(.15, event.pressure) : stroke?.lastPressure || 1;
    return { x: (event.clientX - rect.left - canvas.clientLeft) * canvas.width / canvas.clientWidth,
      y: (event.clientY - rect.top - canvas.clientTop) * canvas.height / canvas.clientHeight,
      width: Number(size.value) * pressure, pressure };
  }
  function stamp(ctx, p, width, erase) {
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.fillStyle = erase ? '#000' : stroke?.color || color.value;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(.25, width / 2), 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  function segment(ctx, a, b, w0, w1, erase, control = null) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y) + (control ? Math.hypot(control.x - a.x, control.y - a.y) : 0);
    const steps = Math.max(1, Math.ceil(distance / Math.max(.5, Math.min(w0, w1) / 5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, u = 1 - t;
      const p = control ? { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y } : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      stamp(ctx, p, w0 + (w1 - w0) * t, erase);
    }
  }
  canvas.addEventListener('pointerdown', event => {
    if (busy || stroke || event.button !== 0 && event.button !== 5) return;
    if (!active().visible) { status.textContent = 'Show the selected layer before drawing.'; return; }
    event.preventDefault(); remember();
    const start = point(event); stroke = { pointer: event.pointerId, start, last: start, mid: start, lastPressure: start.pressure,
      color: color.value, erase: tool === 'erase' || event.button === 5 || event.buttons === 32 || event.shiftKey };
    canvas.setPointerCapture(event.pointerId);
    stamp(active().canvas.getContext('2d'), start, start.width, stroke.erase);
    status.textContent = ''; updatePanel(); render();
  });
  function sample(event) {
    const p = point(event);
    const last = stroke.last;
    const next = p;
    const mid = { x: (last.x + next.x) / 2, y: (last.y + next.y) / 2, width: (last.width + next.width) / 2 };
    segment(active().canvas.getContext('2d'), stroke.mid, mid, stroke.mid.width, mid.width, stroke.erase, last);
    stroke.mid = mid; stroke.last = next; stroke.lastPressure = p.pressure;
  }
  canvas.addEventListener('pointermove', event => {
    if (!stroke || event.pointerId !== stroke.pointer) return;
    const coalesced = event.getCoalescedEvents?.();
    for (const p of coalesced?.length ? coalesced : [event]) sample(p);
    scheduleRender();
  });
  function finish(event) {
    if (!stroke || event.pointerId !== stroke.pointer) return;
    if (event.type === 'pointerup') sample(event);
    const ctx = active().canvas.getContext('2d');
    const end = event.type === 'pointerup' ? point(event) : stroke.last;
    segment(ctx, stroke.mid, end, stroke.mid.width, stroke.last.width, stroke.erase, stroke.last);
    stroke = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    render(); updatePanel(); persistSoon();
  }
  canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish); canvas.addEventListener('lostpointercapture', finish);
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  function persistSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 200); }
  function persist() {
    if (!db || busy || stroke) return saving;
    const record = { key: draftKey, width: canvas.width, height: canvas.height, selected, layers: layers.map(layer => ({ id: layer.id, name: layer.name, visible: layer.visible, canvas: copy(layer.canvas) })) };
    saving = saving.then(async () => {
      const rows = await Promise.all(record.layers.map(async layer => ({ ...layer, canvas: undefined, blob: await new Promise(resolve => layer.canvas.toBlob(resolve)) })));
      await new Promise((resolve, reject) => {
        const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put({ ...record, layers: rows });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    }).catch(() => { status.textContent = 'Draft could not be saved in this browser. Download a copy before leaving.'; });
    return saving;
  }
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  document.getElementById('drawing-download').addEventListener('click', () => {
    if (busy || stroke) return;
    const image = newCanvas(); render(image.getContext('2d'), false);
    image.toBlob(blob => { if (!blob) return; const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'chiko-drawing.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  });
  window.ChikoDrawingBoard = { canvas, ready: null, exportCanvas() { const image = newCanvas(); render(image.getContext('2d'), false); return image; },
    isBusy: () => busy || !!stroke, setBusy(value) { busy = value; updatePanel(); }, persist };
  async function initialize() {
    layers = [{ id: nextId++, name: 'Layer 1', visible: true, canvas: newCanvas() }]; selected = layers[0].id;
    try {
      db = await new Promise((resolve, reject) => { const request = indexedDB.open('chiko-drawings', 1); request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const record = await new Promise((resolve, reject) => { const request = db.transaction('drafts').objectStore('drafts').get(draftKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (record?.layers?.length && record.layers.length <= 12) {
        canvas.width = record.width; canvas.height = record.height;
        const restored = [];
        for (const row of record.layers) {
          const image = await createImageBitmap(row.blob), layer = { id: nextId++, name: String(row.name).slice(0, 40), visible: row.visible !== false, canvas: newCanvas() };
          layer.canvas.getContext('2d').drawImage(image, 0, 0); image.close(); restored.push(layer);
          if (row.id === record.selected) selected = layer.id;
        }
        layers = restored; if (!active()) selected = layers[0].id;
        status.textContent = 'Draft restored.';
      } else if (draftKey === 'fullscreen') {
        // Read the old draft without removing it or unrelated localStorage keys.
        const old = localStorage.getItem('dataURL');
        if (old?.startsWith('data:image/png')) {
          const image = new Image(); image.src = old; await image.decode();
          canvas.width = image.width; canvas.height = image.height; active().canvas = newCanvas();
          active().canvas.getContext('2d').drawImage(image, 0, 0);
          status.textContent = 'Your original drawing was restored.';
        }
      }
    } catch { status.textContent = 'Browser draft storage is unavailable. You can still draw, send, and download.'; }
    busy = false; render(); updatePanel(); persistSoon();
  }
  window.ChikoDrawingBoard.ready = initialize();
})();
