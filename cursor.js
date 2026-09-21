(() => {
  const asset = new URL('media/miku-miku-oo-ee-oo/Normal_96.gif', document.currentScript.src);
  const enabled = matchMedia('(any-hover: hover) and (any-pointer: fine) and (prefers-reduced-motion: no-preference)');
  const root = document.documentElement;
  const cursor = new Image(96, 96);
  cursor.id = 'miku-cursor';
  cursor.alt = '';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.draggable = false;
  let loaded = false;
  const hide = () => root.classList.remove('miku-cursor-active');

  cursor.addEventListener('load', () => { loaded = true; });
  cursor.addEventListener('error', () => { loaded = false; hide(); });
  cursor.src = asset.href;
  document.body.append(cursor);

  document.addEventListener('pointermove', (event) => {
    // Keep native cursors for editing, drawing, and disabled controls.
    if (!loaded || !enabled.matches || event.pointerType !== 'mouse' ||
        event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), :disabled, [aria-disabled="true"], canvas, iframe')) {
      hide();
      return;
    }
    cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    root.classList.add('miku-cursor-active');
  }, { passive: true });

  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) hide();
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse') hide();
  });
  document.addEventListener('visibilitychange', hide);
  document.addEventListener('dragstart', hide);
  window.addEventListener('blur', hide);
  window.addEventListener('scroll', hide, true);
  enabled.addEventListener('change', hide);
})();
