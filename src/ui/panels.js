import { cloneTemplate } from './templates.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MOBILE = '(max-width: 760px), (max-width: 1024px) and (max-height: 500px)';

// Own layout and noncritical preferences; campaign selection/content stay with the session.
export function createPanels(root, preferences, onChange) {
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  const map = document.createElement('section');
  map.className = 'hp-map-panel';
  map.setAttribute('aria-label', 'Map');
  map.append(...[...root.children].filter((child) => child.tagName !== 'DIALOG'));
  root.prepend(map);
  const side = document.createElement('aside');
  side.className = 'hp-side-panels';
  side.setAttribute('aria-label', 'Campaign tools');
  root.append(side);
  const mobile = matchMedia(MOBILE);
  const campaignLayouts = new Map(Object.entries(preferences.campaignPanels ?? {}));
  let campaignId, panelSplit, mapSplit, drag, measurementFrame;
  let journalFirst = preferences.journalFirst ?? false;
  let collapsed = { inspector: false, tracker: false };
  const mobileCollapsed = { inspector: true, tracker: true, party: false };
  let folded = false,
    partyMode = false,
    multiEdit = false,
    overviewHeight = 300;
  const order = () => (journalFirst ? ['tracker', 'inspector'] : ['inspector', 'tracker']);
  const panels = {};
  const title = (id) => ({ inspector: 'Inspector', tracker: 'Journal', party: 'Party panel' })[id];
  const desktopPreferences = () => ({
    ...(panelSplit !== undefined ? { panelSplit } : {}),
    ...(mapSplit !== undefined ? { mapSplit } : {}),
    panelsCollapsed: { ...collapsed },
    sidePanelsFolded: folded,
  });
  for (const id of ['inspector', 'tracker', 'party']) {
    const panel = cloneTemplate('tool-panel-template').firstElementChild;
    panel.classList.add(`hp-${id}-panel`);
    panel.dataset.panel = id;
    panel.setAttribute('aria-label', title(id));
    const heading = panel.querySelector('h2');
    heading.id = `hp-${id}-title`;
    heading.textContent = title(id);
    panel.querySelector('.hp-panel-body').id = `hp-${id}-body`;
    const handle = panel.querySelector('.hp-panel-resize');
    const disclosure = panel.querySelector('[data-collapse]');
    disclosure.setAttribute('aria-controls', `hp-${id}-body`);
    listen(disclosure, 'click', () => {
      if (mobile.matches && !(id === 'tracker' && multiEdit)) toggleMobile(id);
    });
    handle.setAttribute('aria-controls', `hp-${id}-body`);
    handle.setAttribute('aria-label', `Resize ${title(id)}`);
    panels[id] = panel;
    side.append(panel);
    listen(handle, 'pointerdown', (event) => {
      if (event.button !== 0 || mobile.matches || (id === 'tracker' && multiEdit)) return;
      event.preventDefault();
      handle.blur();
      drag = {
        id,
        handle,
        pointerId: event.pointerId,
        start: event.clientY,
        height: panel.getBoundingClientRect().height,
        moved: false,
      };
      handle.setPointerCapture(event.pointerId);
    });
    listen(handle, 'pointermove', (event) => {
      if (!drag || drag.handle !== handle || drag.pointerId !== event.pointerId) return;
      const delta = event.clientY - drag.start;
      if (Math.abs(delta) < 3 && !drag.moved) return;
      drag.moved = true;
      resizeTop(drag.height + delta);
    });
    listen(handle, 'pointerup', () => {
      if (drag?.handle !== handle) return;
      finishResize();
    });
    for (const type of ['pointercancel', 'lostpointercapture'])
      listen(handle, type, () => finishResize());
    listen(handle, 'dblclick', () => {
      if (!mobile.matches) toggleTop();
    });
    listen(handle, 'keydown', (event) => {
      if (mobile.matches || (id === 'tracker' && multiEdit)) return;
      const bounds = splitBounds();
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleTop();
      } else if (bounds) {
        const height = panel.getBoundingClientRect().height,
          step = event.shiftKey ? 40 : 10;
        const next = {
          ArrowUp: height - step,
          ArrowDown: height + step,
          Home: bounds.min,
          End: bounds.max,
        }[event.key];
        if (next !== undefined) {
          event.preventDefault();
          resizeTop(next);
          onChange();
        }
      }
    });
  }
  const partyHeader = panels.party.querySelector('.hp-panel-bar');
  partyHeader.insertBefore(
    cloneTemplate('party-panel-name-template'),
    partyHeader.querySelector('[data-collapse]'),
  );
  const mapHandle = document.createElement('div');
  mapHandle.className = 'hp-map-resize';
  mapHandle.tabIndex = 0;
  mapHandle.setAttribute('role', 'separator');
  mapHandle.setAttribute('aria-orientation', 'vertical');
  mapHandle.setAttribute('aria-label', 'Resize map and side panels');
  mapHandle.setAttribute('aria-controls', 'hp-inspector-body hp-tracker-body hp-party-body');
  map.append(mapHandle);
  function widthBounds() {
    const style = getComputedStyle(root);
    const available = Math.max(1, root.clientWidth - parseFloat(style.columnGap));
    const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      available,
      mapMin: Math.min(24 * unit, available / 2),
      sideMin: Math.min(18.75 * unit, available / 2),
    };
  }
  function resizeMap(width) {
    const bounds = widthBounds();
    if (width > bounds.available - bounds.sideMin + 48) folded = true;
    else {
      folded = false;
      mapSplit = clamp(width, bounds.mapMin, bounds.available - bounds.sideMin) / bounds.available;
    }
    render();
  }
  function defaultSplit() {
    panelSplit = undefined;
    collapsed.inspector = collapsed.tracker = false;
  }
  function toggleMap() {
    folded = !folded;
    if (!folded) {
      mapSplit = undefined;
      defaultSplit();
    }
    render();
    onChange();
  }
  listen(mapHandle, 'pointerdown', (event) => {
    if (event.button !== 0 || mobile.matches) return;
    event.preventDefault();
    mapHandle.blur();
    drag = { id: 'map', handle: mapHandle, pointerId: event.pointerId, moved: false };
    mapHandle.setPointerCapture(event.pointerId);
  });
  listen(mapHandle, 'pointermove', (event) => {
    if (drag?.id !== 'map' || drag.pointerId !== event.pointerId) return;
    drag.moved = true;
    resizeMap(event.clientX - root.getBoundingClientRect().left);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(mapHandle, type, () => finishResize());
  listen(mapHandle, 'dblclick', toggleMap);
  listen(mapHandle, 'keydown', (event) => {
    const bounds = widthBounds(),
      width = map.getBoundingClientRect().width;
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleMap();
    } else if (
      event.key === 'End' ||
      (event.key === 'ArrowRight' && !folded && width >= bounds.available - bounds.sideMin - 1)
    ) {
      event.preventDefault();
      folded = true;
      render();
      onChange();
    } else if (event.key === 'ArrowLeft' && folded) {
      event.preventDefault();
      folded = false;
      mapSplit = (bounds.available - bounds.sideMin) / bounds.available;
      render();
      onChange();
    } else {
      const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: bounds.mapMin }[
        event.key
      ];
      if (next !== undefined) {
        event.preventDefault();
        resizeMap(next);
        onChange();
      }
    }
  });
  function splitBounds() {
    if (mobile.matches || partyMode || folded || multiEdit) return null;
    const top = order()[0],
      lower = order()[1];
    const min = panels[top].querySelector('.hp-panel-bar').getBoundingClientRect().height + 2;
    const bottom = panels[lower].querySelector('.hp-panel-bar').getBoundingClientRect().height + 2;
    const available = Math.max(
      min + bottom,
      side.clientHeight - parseFloat(getComputedStyle(side).rowGap),
    );
    return { id: top, lower, min, max: available - bottom, available };
  }
  function defaultTop(bounds) {
    const inspector = clamp(overviewHeight, bounds.min, bounds.max);
    return order()[0] === 'inspector' ? inspector : bounds.available - inspector;
  }
  function resizeTop(height) {
    const bounds = splitBounds();
    if (!bounds) return;
    const next = clamp(height, bounds.min, bounds.max);
    collapsed[bounds.id] = next <= bounds.min + 3;
    collapsed[bounds.lower] = !collapsed[bounds.id] && next >= bounds.max - 3;
    panelSplit = next / bounds.available;
    render();
  }
  function toggleTop() {
    const bounds = splitBounds();
    if (!bounds) return;
    const height = panels[bounds.id].getBoundingClientRect().height;
    if (collapsed[bounds.id] || height > defaultTop(bounds) + 3) defaultSplit();
    else {
      collapsed[bounds.id] = true;
      collapsed[bounds.lower] = false;
      panelSplit = undefined;
    }
    render();
    onChange();
  }
  function toggleMobile(id) {
    mobileCollapsed[id] = !mobileCollapsed[id];
    render();
    onChange();
  }
  function finishResize(save = true) {
    if (!drag) return;
    const { handle, pointerId, moved } = drag;
    drag = undefined;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (moved && save && !mobile.matches) onChange();
  }
  function render() {
    const ids = partyMode ? ['party'] : order();
    root.dataset.inspectorMode = partyMode ? 'party' : 'hex';
    root.dataset.panelRails = String(!mobile.matches && folded ? ids.length : 0);
    root.style.setProperty('--visible-panel-count', String(ids.length));
    if (mobile.matches) root.style.removeProperty('--workspace-columns');
    else if (folded)
      root.style.setProperty(
        '--workspace-columns',
        `minmax(0, 1fr) calc(var(--panel-rail-size) * ${ids.length} + var(--panel-margin) * ${ids.length - 1})`,
      );
    else if (mapSplit !== undefined) {
      const bounds = widthBounds();
      const width = clamp(
        mapSplit * bounds.available,
        bounds.mapMin,
        bounds.available - bounds.sideMin,
      );
      root.style.setProperty('--workspace-columns', `${width}px minmax(0, 1fr)`);
    } else if (root.clientWidth) {
      const bounds = widthBounds();
      const unit = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const width = clamp(
        Math.max(innerWidth * 0.6, bounds.available - 35 * unit),
        bounds.mapMin,
        bounds.available - bounds.sideMin,
      );
      root.style.setProperty('--workspace-columns', `${width}px minmax(0, 1fr)`);
    } else root.style.removeProperty('--workspace-columns');
    side.style.setProperty(
      '--panel-columns',
      !mobile.matches && folded
        ? `repeat(${ids.length}, var(--panel-rail-size))`
        : 'minmax(0, 1fr)',
    );
    const bounds = splitBounds();
    let rows = 'minmax(0, 1fr)';
    if (!partyMode && !folded && !mobile.matches) {
      const top = order()[0],
        lower = order()[1];
      if (multiEdit)
        rows = top === 'tracker' ? 'max-content minmax(0, 1fr)' : 'minmax(0, 1fr) max-content';
      else if (collapsed[top]) rows = 'max-content minmax(0, 1fr)';
      else if (collapsed[lower]) rows = 'minmax(0, 1fr) max-content';
      else if (bounds)
        rows = `${panelSplit === undefined ? defaultTop(bounds) : clamp(panelSplit * bounds.available, bounds.min, bounds.max)}px minmax(0, 1fr)`;
    }
    side.style.setProperty('--panel-rows', rows);
    for (const id of ['inspector', 'tracker', 'party']) {
      const panel = panels[id],
        index = ids.indexOf(id);
      panel.hidden = index < 0;
      if (index < 0) continue;
      if (side.children[index] !== panel) side.insertBefore(panel, side.children[index]);
      const rail = !mobile.matches && folded;
      const closed = mobile.matches
        ? mobileCollapsed[id]
        : id !== 'party' && (collapsed[id] || (id === 'tracker' && multiEdit));
      panel.classList.toggle('is-side-collapsed', rail);
      panel.classList.toggle('is-collapsed', closed);
      panel.style.setProperty('--panel-column', rail ? String(index + 1) : '1');
      panel.style.setProperty('--panel-row', rail ? '1' : String(index + 1));
      const body = panel.querySelector('.hp-panel-body');
      body.hidden = closed || rail;
      const heading = panel.querySelector('h2');
      if (id === 'party') heading.classList.toggle('sr-only', !rail);
      const handle = panel.querySelector('.hp-panel-resize');
      handle.hidden = mobile.matches || rail || partyMode || index !== 0 || multiEdit;
      handle.setAttribute('aria-disabled', String(id === 'tracker' && multiEdit));
      handle.tabIndex = id === 'tracker' && multiEdit ? -1 : 0;
      const disclosure = panel.querySelector('[data-collapse]');
      disclosure.hidden = !mobile.matches;
      disclosure.disabled = id === 'tracker' && multiEdit;
      disclosure.setAttribute('aria-expanded', String(!closed));
      disclosure.setAttribute('aria-label', `${closed ? 'Open' : 'Close'} ${title(id)}`);
      disclosure.dataset.tooltip = disclosure.disabled
        ? 'Turn off multiselect to open Journal'
        : `${closed ? 'Open' : 'Close'} panel`;
      disclosure
        .querySelector('use')
        .setAttribute('href', `/icons/pixelarticons.svg#${closed ? 'expand' : 'collapse'}`);
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
      handle.setAttribute(
        'aria-valuenow',
        String(
          closed
            ? 0
            : mobile.matches
              ? 100
              : Math.round(
                  (panel.getBoundingClientRect().height /
                    Math.max(1, bounds?.available ?? side.clientHeight)) *
                    100,
                ),
        ),
      );
      handle.setAttribute(
        'aria-valuetext',
        closed ? 'Collapsed; activate to open' : 'Open; drag to resize',
      );
    }
    mapHandle.hidden = mobile.matches;
    mapHandle.setAttribute('aria-valuemin', '0');
    mapHandle.setAttribute('aria-valuemax', '100');
    mapHandle.setAttribute(
      'aria-valuenow',
      String(root.clientWidth ? Math.round((map.clientWidth / root.clientWidth) * 100) : 60),
    );
    mapHandle.setAttribute(
      'aria-valuetext',
      folded
        ? 'Side panels folded; activate to restore default layout'
        : 'Side panels open; activate to fold',
    );
  }
  function measureOverview() {
    measurementFrame = undefined;
    const overview = panels.inspector.querySelector('.hp-inspector-overview');
    if (overview?.offsetHeight)
      overviewHeight =
        overview.offsetHeight + panels.inspector.querySelector('.hp-panel-bar').offsetHeight + 2;
    render();
  }
  const observer = new ResizeObserver(() => {
    measurementFrame ??= requestAnimationFrame(measureOverview);
  });
  observer.observe(root);
  observer.observe(side);
  const contentObserver = new MutationObserver(() => {
    const overview = panels.inspector.querySelector('.hp-inspector-overview');
    if (overview) {
      observer.observe(overview);
      contentObserver.disconnect();
    }
  });
  contentObserver.observe(panels.inspector.querySelector('.hp-panel-body'), {
    childList: true,
    subtree: true,
  });
  listen(mobile, 'change', () => {
    finishResize();
    if (mobile.matches) mobileCollapsed.inspector = mobileCollapsed.tracker = true;
    render();
    onChange();
  });
  const visible = (id) =>
    !root.hidden &&
    !root.classList.contains('hp-map-expanded') &&
    (mobile.matches ? !mobileCollapsed[id] : !folded && (id === 'party' || !collapsed[id]));
  render();
  return {
    inspector: panels.inspector.querySelector('.hp-panel-body'),
    tracker: panels.tracker.querySelector('.hp-panel-body'),
    party: panels.party.querySelector('.hp-panel-body'),
    partyHeader: panels.party.querySelector('.hp-panel-bar'),
    openParty() {
      if (!mobile.matches) folded = false;
      mobileCollapsed.party = false;
      render();
      onChange();
    },
    setMultiEdit(enabled) {
      if (multiEdit !== Boolean(enabled)) {
        multiEdit = Boolean(enabled);
        render();
      }
    },
    setInspectorMode(mode) {
      if (partyMode !== (mode === 'party')) {
        partyMode = mode === 'party';
        render();
      }
    },
    journalFirst: () => journalFirst,
    setJournalFirst(value) {
      if (journalFirst === value) return;
      journalFirst = value;
      defaultSplit();
      for (const [id, layout] of campaignLayouts)
        campaignLayouts.set(id, {
          ...layout,
          panelSplit: undefined,
          panelsCollapsed: { inspector: false, tracker: false },
        });
      render();
    },
    enterCampaign(id) {
      finishResize();
      if (campaignId) campaignLayouts.set(campaignId, desktopPreferences());
      campaignId = id;
      const layout = campaignLayouts.get(id) ?? {};
      collapsed = { ...(layout.panelsCollapsed ?? { inspector: false, tracker: false }) };
      if (collapsed.inspector && collapsed.tracker) collapsed[order()[1]] = false;
      folded =
        layout.sidePanelsFolded ?? Object.values(layout.panelsHorizontal ?? {}).some(Boolean);
      panelSplit = layout.panelSplit;
      mapSplit = layout.mapSplit;
      mobileCollapsed.inspector = mobileCollapsed.tracker = true;
      render();
    },
    inspectorVisible: () => !partyMode && visible('inspector'),
    partyVisible: () => partyMode && visible('party'),
    preferences() {
      const layouts = new Map(campaignLayouts);
      if (campaignId) layouts.set(campaignId, desktopPreferences());
      return { journalFirst, campaignPanels: Object.fromEntries(layouts) };
    },
    dispose() {
      finishResize(false);
      listeners.abort();
      cancelAnimationFrame(measurementFrame);
      observer.disconnect();
      contentObserver.disconnect();
      delete root.dataset.panelRails;
      root.style.removeProperty('--workspace-columns');
      mapHandle.remove();
      root.prepend(...map.children);
      map.remove();
      side.remove();
    },
  };
}
