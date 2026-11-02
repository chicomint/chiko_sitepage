// Small labels for the links and tools; native titles still work without JS.
(() => {
  'use strict';
  for (const element of document.querySelectorAll('.chiko_site a[title], .chiko_site button[title], .chiko_site input[title], .chiko_site summary[title]')) {
    element.dataset.tooltip = element.title;
    element.removeAttribute('title');
  }

  const tooltip = document.createElement('div');
  tooltip.id = 'site-tooltip';
  tooltip.className = 'site-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);

  let active = null, pointer = null, positionFrame = null, showTimer, hideTimer;

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    cancelAnimationFrame(positionFrame);
    positionFrame = null;
    if (active) {
      const descriptions = (active.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
      if (descriptions.length) active.setAttribute('aria-describedby', descriptions.join(' '));
      else active.removeAttribute('aria-describedby');
    }
    tooltip.hidden = true;
    active = null;
    pointer = null;
  }

  function position() {
    if (!active || tooltip.hidden) return;
    const label = tooltip.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    let left, top;
    if (pointer) {
      left = pointer.x + 14;
      top = pointer.y + 18;
      if (left + label.width > width - 8) left = pointer.x - label.width - 14;
      if (top + label.height > window.innerHeight - 8) top = pointer.y - label.height - 12;
    } else {
      // Keyboard focus keeps its label next to the link or control.
      const rect = active.getBoundingClientRect();
      left = rect.left + (rect.width - label.width) / 2;
      top = rect.top - label.height - 8;
      if (top < 8) top = rect.bottom + 8;
      if (active.closest('.little_map') && window.matchMedia('(min-width: 541px)').matches) {
        left = rect.right + 10;
        top = rect.top + (rect.height - label.height) / 2;
      }
    }
    left = Math.max(8, Math.min(left, width - label.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - label.height - 8));
    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';
  }

  function show(element, delay = 320, point = null) {
    clearTimeout(hideTimer);
    if (active === element) { pointer = point; position(); return; }
    hide();
    active = element;
    pointer = point;
    showTimer = setTimeout(() => {
      if (!element.isConnected) { hide(); return; }
      tooltip.textContent = element.dataset.tooltip;
      tooltip.hidden = false;
      position();

      const descriptions = new Set((element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      descriptions.add(tooltip.id);
      element.setAttribute('aria-describedby', [...descriptions].join(' '));
    }, delay);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const element = event.target.closest('[data-tooltip]');
    if (element) show(element, 320, { x: event.clientX, y: event.clientY });
  });

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !active?.contains(event.target)) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (!tooltip.hidden && positionFrame === null) {
      positionFrame = requestAnimationFrame(() => { positionFrame = null; position(); });
    }
  });

  document.addEventListener('pointerout', event => {
    if (!active || !active.contains(event.target) || active.contains(event.relatedTarget) || tooltip.contains(event.relatedTarget)) return;
    if (!active.matches(':focus-visible')) hideTimer = setTimeout(hide, 120);
  });
  // Leave enough time to move onto a label and read it.
  tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  tooltip.addEventListener('pointerleave', () => {
    if (!active?.matches(':focus-visible')) hide();
  });

  document.addEventListener('focusin', event => {
    const element = event.target.closest('[data-tooltip]');
    if (element?.matches(':focus-visible')) show(element, 0);
  });
  document.addEventListener('focusout', event => {
    if (active?.contains(event.target)) hide();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('pointerdown', event => { if (!tooltip.contains(event.target)) hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
})();
