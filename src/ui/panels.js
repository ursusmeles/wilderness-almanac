import { cloneTemplate } from './templates.js';

export function createPanels(root, preferences, onChange) {
  const listeners = new AbortController();
  const map = document.createElement('section');
  map.className = 'hp-map-panel';
  map.setAttribute('aria-label', 'Map');
  map.append(...[...root.children].filter((child) => child.tagName !== 'DIALOG'));
  root.prepend(map);
  const side = document.createElement('aside');
  side.className = 'hp-side-panels';
  side.setAttribute('aria-label', 'Campaign tools');
  root.append(side);
  let order = preferences.panelOrder ?? ['tracker', 'inspector'];
  const collapsed = { ...(preferences.panelsCollapsed ?? { tracker: true, inspector: false }) };
  const mobileCollapsed = { tracker: true, inspector: true };
  const horizontal = preferences.panelsHorizontal ?? { tracker: false, inspector: false };
  const mobile = window.matchMedia(
    '(max-width: 760px), (max-width: 1024px) and (max-height: 500px)',
  );
  const activeCollapsed = () => (mobile.matches ? mobileCollapsed : collapsed);
  const panels = {};
  let inspectorMode = 'hex';
  let multiEdit = false;
  for (const [id, name] of [
    ['tracker', 'Sandbox tools'],
    ['inspector', 'Hex Inspector'],
  ]) {
    const panel = cloneTemplate('tool-panel-template').firstElementChild;
    panel.classList.add(`hp-${id}-panel`);
    panel.dataset.panel = id;
    panel.setAttribute('aria-labelledby', `hp-${id}-title`);
    const heading = panel.querySelector('h2');
    heading.id = `hp-${id}-title`;
    heading.textContent = name;
    panel.querySelector('.hp-panel-body').id = `hp-${id}-body`;
    for (const button of panel.querySelectorAll('[data-direction]'))
      button.setAttribute(
        'aria-label',
        `Move ${name} ${button.dataset.direction === '-1' ? 'up' : 'down'}`,
      );
    for (const button of panel.querySelectorAll('[data-horizontal], [data-collapse]'))
      button.setAttribute('aria-controls', `hp-${id}-body`);
    panels[id] = panel;
    panel.addEventListener(
      'click',
      (event) => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        if (button.hasAttribute('data-collapse')) {
          if (id === 'tracker' && multiEdit) return;
          const current = activeCollapsed();
          current[id] = !current[id];
        } else if (button.hasAttribute('data-horizontal')) horizontal[id] = !horizontal[id];
        else if (button.dataset.direction) {
          const index = order.indexOf(id),
            next = index + Number(button.dataset.direction);
          if (next < 0 || next > 1) return;
          [order[index], order[next]] = [order[next], order[index]];
        } else return;
        render();
        onChange();
        const focusTarget =
          button.disabled && button.dataset.direction
            ? panel.querySelector(`[data-direction="${-Number(button.dataset.direction)}"]`)
            : button;
        focusTarget.focus({ preventScroll: true });
      },
      { signal: listeners.signal },
    );
  }
  function render() {
    const preferred = activeCollapsed();
    const current = { ...preferred, tracker: multiEdit || preferred.tracker };
    const railIds = mobile.matches ? [] : order.filter((id) => horizontal[id]);
    const stackedIds = order.filter((id) => !railIds.includes(id));
    root.dataset.panelRails = String(railIds.length);
    side.style.setProperty('--rail-count', railIds.length);
    const rows = stackedIds.map((id) =>
      current[id]
        ? 'max-content'
        : id === 'inspector'
          ? inspectorMode === 'party'
            ? 'max-content'
            : 'minmax(var(--inspector-min-height, 300px), 1fr)'
          : 'minmax(52px, 2fr)',
    );
    if (!stackedIds.some((id) => !current[id])) rows.push('minmax(0, 1fr)');
    side.style.setProperty('--panel-rows', rows.join(' '));
    side.style.setProperty(
      '--panel-columns',
      stackedIds.length
        ? `minmax(0, 1fr)${railIds.length ? ` repeat(${railIds.length}, var(--panel-rail-size))` : ''}`
        : `repeat(${railIds.length}, var(--panel-rail-size))`,
    );
    for (const [index, id] of order.entries()) {
      const panel = panels[id];
      side.append(panel);
      panel.classList.toggle('is-collapsed', current[id]);
      const rail = railIds.includes(id);
      panel.classList.toggle('is-side-collapsed', rail);
      const body = panel.querySelector('.hp-panel-body');
      const wasHidden = body.hidden;
      body.hidden = current[id] || rail;
      if (wasHidden && !body.hidden) body.scrollTop = 0;
      panel.style.setProperty(
        '--panel-column',
        rail ? (stackedIds.length ? railIds.indexOf(id) + 2 : railIds.indexOf(id) + 1) : 1,
      );
      panel.style.setProperty('--panel-row', rail ? '1 / -1' : stackedIds.indexOf(id) + 1);
      panel.querySelector('.hp-move-up').disabled = index === 0;
      panel.querySelector('.hp-move-down').disabled = index === 1;
      const toggle = panel.querySelector('[data-collapse]');
      const unavailable = id === 'tracker' && multiEdit;
      toggle.disabled = unavailable;
      const name =
        id === 'tracker'
          ? 'Sandbox tools'
          : inspectorMode === 'party'
            ? 'Party Inspector'
            : 'Hex Inspector';
      panel.querySelector('h2').textContent = name;
      for (const button of panel.querySelectorAll('[data-direction]'))
        button.setAttribute(
          'aria-label',
          `Move ${name} ${button.dataset.direction === '-1' ? 'up' : 'down'}`,
        );
      toggle.setAttribute('aria-expanded', String(!current[id]));
      toggle.setAttribute('aria-label', `${current[id] ? 'Expand' : 'Minimise'} ${name}`);
      toggle.title = unavailable
        ? 'Turn off multiselect to expand Sandbox tools'
        : `${current[id] ? 'Expand' : 'Minimise'} panel`;
      toggle
        .querySelector('use')
        .setAttribute('href', `/icons/pixelarticons.svg#${current[id] ? 'expand' : 'collapse'}`);
      const sideways = panel.querySelector('[data-horizontal]');
      sideways.setAttribute('aria-expanded', String(!rail));
      sideways.setAttribute(
        'aria-label',
        `${rail ? 'Restore' : 'Collapse'} ${name} ${rail ? 'from' : 'to'} vertical bar`,
      );
      sideways.title = rail ? 'Restore panel width' : 'Collapse panel to vertical bar';
      sideways
        .querySelector('use')
        .setAttribute(
          'href',
          `/icons/pixelarticons.svg#${rail ? 'arrow-bar-left' : 'arrow-bar-right'}`,
        );
    }
  }
  mobile.addEventListener(
    'change',
    () => {
      if (mobile.matches) mobileCollapsed.tracker = mobileCollapsed.inspector = true;
      render();
      onChange();
    },
    { signal: listeners.signal },
  );
  const observer = new ResizeObserver(() => {
    const overview = panels.inspector.querySelector('.hp-inspector-overview');
    if (!overview || !overview.getBoundingClientRect().height) return;
    const bar = panels.inspector.querySelector('.hp-panel-bar');
    side.style.setProperty(
      '--inspector-min-height',
      `${Math.ceil(overview.getBoundingClientRect().height + bar.getBoundingClientRect().height + 2)}px`,
    );
  });
  observer.observe(panels.inspector);
  observer.observe(panels.inspector.querySelector('.hp-panel-bar'));
  const contentObserver = new MutationObserver(() => {
    const overview = panels.inspector.querySelector('.hp-inspector-overview');
    if (overview) {
      observer.observe(overview);
      contentObserver.disconnect();
    }
  });
  contentObserver.observe(panels.inspector.querySelector('.hp-panel-body'), { childList: true });
  render();
  return {
    inspector: panels.inspector.querySelector('.hp-panel-body'),
    setMultiEdit(enabled) {
      enabled = Boolean(enabled);
      if (multiEdit === enabled) return;
      multiEdit = enabled;
      render();
    },
    setInspectorMode(mode) {
      if (inspectorMode === mode) return;
      inspectorMode = mode;
      root.dataset.inspectorMode = mode;
      render();
    },
    enterCampaign() {
      mobileCollapsed.tracker = mobileCollapsed.inspector = true;
      render();
    },
    inspectorVisible: () =>
      !activeCollapsed().inspector &&
      (mobile.matches || !horizontal.inspector) &&
      !root.hidden &&
      !root.classList.contains('hp-map-expanded'),
    preferences: () => ({
      panelOrder: order.slice(),
      panelsCollapsed: { ...collapsed },
      panelsHorizontal: { ...horizontal },
    }),
    dispose() {
      listeners.abort();
      observer.disconnect();
      contentObserver.disconnect();
      delete root.dataset.panelRails;
      root.prepend(...map.children);
      map.remove();
      side.remove();
    },
  };
}
