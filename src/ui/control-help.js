export function explainDisabled(control, reason, help = '') {
  control.disabled = Boolean(reason);
  if (reason || help) control.dataset.tooltip = reason || help;
  else delete control.dataset.tooltip;
}

// One delegated tooltip handles existing and dynamically rendered controls.
export function createControlTooltips() {
  const tooltip = document.createElement('div');
  tooltip.id = 'control-tooltip';
  tooltip.className = 'ui-tooltip';
  tooltip.popover = 'manual';
  tooltip.setAttribute('role', 'tooltip');
  document.body.append(tooltip);
  const listeners = new AbortController();
  const listen = (type, handler, options = {}) =>
    document.addEventListener(type, handler, { ...options, signal: listeners.signal });
  let current;
  let touch = false;
  let dismissTimer;
  function hide() {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    if (current) {
      const ids = (current.getAttribute('aria-describedby') || '')
        .split(' ')
        .filter((id) => id && id !== tooltip.id);
      if (ids.length) current.setAttribute('aria-describedby', ids.join(' '));
      else current.removeAttribute('aria-describedby');
    }
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
    current = undefined;
  }
  function show(event) {
    const control = event.target.closest('[data-tooltip]');
    if (!control?.dataset.tooltip || !control.getClientRects().length) return hide();
    const dialog = document.activeElement.closest('dialog[open]');
    if (dialog && !dialog.contains(control)) return hide();
    if (control !== current) {
      hide();
      current = control;
      const ids = [control.getAttribute('aria-describedby'), tooltip.id].filter(Boolean);
      control.setAttribute('aria-describedby', ids.join(' '));
    }
    tooltip.textContent = control.dataset.tooltip;
    tooltip.showPopover();
    const anchor = control.getBoundingClientRect(),
      rect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, anchor.left + (anchor.width - rect.width) / 2))}px`;
    tooltip.style.top = `${anchor.top > rect.height + 12 ? anchor.top - rect.height - 8 : Math.min(innerHeight - rect.height - 8, anchor.bottom + 8)}px`;
    clearTimeout(dismissTimer);
    dismissTimer = touch ? setTimeout(hide, 2000) : undefined;
  }
  listen('pointerdown', (event) => {
    touch = event.pointerType === 'touch';
  });
  listen('pointerover', (event) => {
    if (event.pointerType !== 'touch') {
      touch = false;
      show(event);
    }
  });
  listen('pointerout', (event) => {
    if (event.pointerType !== 'touch' && current && !current.contains(event.relatedTarget)) hide();
  });
  listen(
    'pointerup',
    (event) => {
      if (event.pointerType === 'touch') {
        touch = true;
        show(event);
      }
    },
    { capture: true },
  );
  listen('focusin', show);
  listen('focusout', (event) => {
    if (current?.contains(event.target)) hide();
  });
  listen('click', show);
  listen('keydown', (event) => {
    touch = false;
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    if (event.key === 'Escape') hide();
  });
  document.addEventListener('scroll', hide, { capture: true, signal: listeners.signal });
  window.addEventListener('resize', hide, { signal: listeners.signal });
  return {
    dispose() {
      hide();
      listeners.abort();
      tooltip.remove();
    },
  };
}
