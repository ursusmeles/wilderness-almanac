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
  const campaignLayouts = new Map(Object.entries(preferences.campaignPanels ?? {}));
  let campaignId;
  let order = ['inspector', 'tracker'];
  let collapsed = { tracker: false, inspector: false };
  const mobileCollapsed = { tracker: true, inspector: true };
  let horizontal = { tracker: false, inspector: false };
  let panelSplit;
  let drag;
  const desktopPreferences = () => ({
    ...(panelSplit !== undefined ? { panelSplit } : {}),
    panelOrder: order.slice(),
    panelsCollapsed: { ...collapsed },
    panelsHorizontal: { ...horizontal },
  });
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
    const handle = panel.querySelector('.hp-panel-resize');
    handle.setAttribute('aria-controls', `hp-${id}-body`);
    handle.addEventListener(
      'pointerdown',
      (event) => {
        if (event.button !== 0 || !splitBounds()) return;
        event.preventDefault();
        handle.blur();
        drag = {
          pointerId: event.pointerId,
          handle,
          y: event.clientY,
          height: panel.getBoundingClientRect().height,
        };
        handle.setPointerCapture(event.pointerId);
      },
      { signal: listeners.signal },
    );
    handle.addEventListener(
      'pointermove',
      (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        resizeTop(drag.height + event.clientY - drag.y);
      },
      { signal: listeners.signal },
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
      handle.addEventListener(type, () => finishResize(), { signal: listeners.signal });
    const resetSplit = () => {
      panelSplit = undefined;
      for (const key of order) collapsed[key] = false;
      render();
      onChange();
    };
    handle.addEventListener('dblclick', resetSplit, { signal: listeners.signal });
    handle.addEventListener(
      'keydown',
      (event) => {
        const bounds = splitBounds();
        if (!bounds) return;
        const step = event.shiftKey ? 40 : 10;
        const height = panel.getBoundingClientRect().height;
        const next = {
          ArrowUp: height - step,
          ArrowDown: height + step,
          Home: bounds.min,
          End: bounds.max,
        }[event.key];
        if (event.key === 'Enter') {
          event.preventDefault();
          resetSplit();
        } else if (next !== undefined) {
          event.preventDefault();
          resizeTop(next);
          onChange();
        }
      },
      { signal: listeners.signal },
    );
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
  function splitBounds() {
    const stacked = order.filter((id) => !horizontal[id]);
    if (mobile.matches || multiEdit || stacked.length !== 2) return null;
    const min =
      panels[stacked[0]].querySelector('.hp-panel-bar').getBoundingClientRect().height +
      (collapsed[stacked[0]] ? 2 : 1);
    const lower =
      panels[stacked[1]].querySelector('.hp-panel-bar').getBoundingClientRect().height +
      (collapsed[stacked[1]] ? 2 : 1);
    const available = Math.max(
      min + lower,
      side.getBoundingClientRect().height - parseFloat(getComputedStyle(side).rowGap),
    );
    return { id: stacked[0], min, max: available - lower, available };
  }
  function resizeTop(height) {
    const bounds = splitBounds();
    if (!bounds) return;
    const next = Math.min(bounds.max, Math.max(bounds.min, height));
    collapsed[bounds.id] = next <= bounds.min + 4;
    const lower = order.find((id) => id !== bounds.id);
    collapsed[lower] = !collapsed[bounds.id] && next >= bounds.max - 4;
    panelSplit =
      (collapsed[bounds.id] ? bounds.min : collapsed[lower] ? bounds.max : next) / bounds.available;
    if (drag) drag.changed = true;
    render();
  }
  function finishResize(save = true) {
    if (!drag) return;
    const { handle, pointerId, changed } = drag;
    drag = undefined;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (changed && save) onChange();
  }
  function render() {
    const preferred = activeCollapsed();
    const current = { ...preferred, tracker: multiEdit || preferred.tracker };
    const railIds = mobile.matches ? [] : order.filter((id) => horizontal[id]);
    const stackedIds = order.filter((id) => !railIds.includes(id));
    const bothOpen =
      !mobile.matches && stackedIds.length === 2 && stackedIds.every((id) => !current[id]);
    const bounds = splitBounds();
    root.dataset.panelRails = String(railIds.length);
    side.style.setProperty('--rail-count', railIds.length);
    const rows = stackedIds.map((id) =>
      current[id]
        ? 'max-content'
        : id === 'inspector'
          ? inspectorMode === 'party'
            ? 'max-content'
            : bothOpen
              ? 'min(var(--inspector-overview-height, 300px), calc(100% - var(--panel-bar-size) - 2px - var(--panel-margin)))'
              : 'minmax(0, 1fr)'
          : 'minmax(calc(var(--panel-bar-size) + 2px), 1fr)',
    );
    if (bounds && panelSplit !== undefined && !current[bounds.id]) {
      rows[0] = `${Math.min(bounds.max, Math.max(bounds.min, panelSplit * bounds.available))}px`;
      rows[1] = current[stackedIds[1]] ? 'max-content' : 'minmax(0, 1fr)';
    }
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
      if (side.children[index] !== panel) side.append(panel);
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
      const resizable = bounds?.id === id;
      toggle.hidden = Boolean(bounds);
      const handle = panel.querySelector('.hp-panel-resize');
      handle.hidden = !resizable;
      const name =
        id === 'tracker'
          ? 'Sandbox tools'
          : inspectorMode === 'party'
            ? 'Party Inspector'
            : 'Hex Inspector';
      panel.querySelector('h2').textContent = name;
      handle.setAttribute('aria-label', `Resize ${name}`);
      if (resizable) {
        const height = panel.getBoundingClientRect().height;
        handle.setAttribute('aria-valuemin', '0');
        handle.setAttribute('aria-valuemax', '100');
        handle.setAttribute('aria-valuenow', String(Math.round((height / bounds.available) * 100)));
        handle.setAttribute(
          'aria-valuetext',
          current[id] ? 'Collapsed' : `${Math.round(height)} pixels`,
        );
      }
      for (const button of panel.querySelectorAll('[data-direction]'))
        button.setAttribute(
          'aria-label',
          `Move ${name} ${button.dataset.direction === '-1' ? 'up' : 'down'}`,
        );
      toggle.setAttribute('aria-expanded', String(!current[id]));
      toggle.setAttribute('aria-label', `${current[id] ? 'Open' : 'Close'} ${name}`);
      toggle.dataset.tooltip = unavailable
        ? 'Turn off multiselect to open panel'
        : current[id]
          ? 'Open panel'
          : 'Close panel';
      toggle
        .querySelector('use')
        .setAttribute('href', `/icons/pixelarticons.svg#${current[id] ? 'expand' : 'collapse'}`);
      const sideways = panel.querySelector('[data-horizontal]');
      sideways.setAttribute('aria-expanded', String(!rail));
      sideways.setAttribute('aria-label', rail ? `Expand ${name}` : `Collapse ${name} to the side`);
      sideways.dataset.tooltip = rail ? 'Expand panel' : 'Collapse panel to the side';
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
      finishResize();
      if (mobile.matches) mobileCollapsed.tracker = mobileCollapsed.inspector = true;
      render();
      onChange();
    },
    { signal: listeners.signal },
  );
  let measurementFrame;
  function measureOverview() {
    measurementFrame = undefined;
    render();
    const overview = panels.inspector.querySelector('.hp-inspector-overview');
    if (!overview || !overview.getBoundingClientRect().height) return;
    const bar = panels.inspector.querySelector('.hp-panel-bar');
    const style = getComputedStyle(panels.inspector);
    const height = `${overview.getBoundingClientRect().height + bar.getBoundingClientRect().height + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    if (side.style.getPropertyValue('--inspector-overview-height') !== height)
      side.style.setProperty('--inspector-overview-height', height);
  }
  const observer = new ResizeObserver(() => {
    measurementFrame ??= requestAnimationFrame(measureOverview);
  });
  observer.observe(panels.inspector);
  observer.observe(side);
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
    enterCampaign(id) {
      finishResize();
      if (campaignId) campaignLayouts.set(campaignId, desktopPreferences());
      campaignId = id;
      const layout = campaignLayouts.get(id) ?? {};
      order = (layout.panelOrder ?? ['inspector', 'tracker']).slice();
      collapsed = { ...(layout.panelsCollapsed ?? { tracker: false, inspector: false }) };
      horizontal = { ...(layout.panelsHorizontal ?? { tracker: false, inspector: false }) };
      panelSplit = layout.panelSplit;
      mobileCollapsed.tracker = mobileCollapsed.inspector = true;
      render();
    },
    inspectorVisible: () =>
      !activeCollapsed().inspector &&
      (mobile.matches || !horizontal.inspector) &&
      !root.hidden &&
      !root.classList.contains('hp-map-expanded'),
    preferences() {
      const layouts = new Map(campaignLayouts);
      if (campaignId) layouts.set(campaignId, desktopPreferences());
      return { campaignPanels: Object.fromEntries(layouts) };
    },
    dispose() {
      finishResize(false);
      listeners.abort();
      cancelAnimationFrame(measurementFrame);
      observer.disconnect();
      contentObserver.disconnect();
      delete root.dataset.panelRails;
      root.prepend(...map.children);
      map.remove();
      side.remove();
    },
  };
}
