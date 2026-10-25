import { openDialog } from './ui/dialog-focus.js';
import { generateWorld } from './generation/world.js';
import { prepareMap } from './generation/presentation.js';
import {
  palettes,
  paletteNames,
  paletteTheme,
  createColorScale,
  hexToOklch,
  DEFAULT_PALETTE,
} from './palette.js';
import { readUIPreferences, saveUIPreferences } from './ui/ui-preferences.js';
import { createBrowserStore } from './persistence/browser-store.js';
import { readMapLink, describeHex, shortCoordinates } from './ui/map-link.js';
import { createMapConsole } from './ui/map-console.js';
import { createSaveStatus } from './ui/save-status.js';
import { createCampaign, campaignIconCandidates } from './application/campaigns.js';
import { createFogView } from './application/fog-view.js';
import { createCampaignSession } from './application/campaign-session.js';
import { timeOfDay, nextTimeOfDay } from './application/time-of-day.js';
import { createCampaignMenu } from './ui/campaign-menu.js';
import { createPaletteLibrary } from './application/palette-library.js';
import { createPaletteManager } from './ui/palette-manager.js';
import { createSettings } from './ui/settings.js';
import { createCampaignHistory } from './ui/campaign-history.js';
import { createCampaignCreator } from './ui/campaign-creator.js';
import { createPanels } from './ui/panels.js';
import { createHexInspector } from './ui/hex-inspector.js';
import { createPartyInspector } from './ui/party-inspector.js';
import { createBatchInspector } from './ui/batch-inspector.js';
import { createMapAction } from './ui/map-action.js';
import { loadThumbnails, saveThumbnails } from './ui/thumbnail-cache.js';
import { createViewNavigation } from './ui/view-navigation.js';
import { createControlTooltips } from './ui/control-help.js';
import { PARTY_KEYS, partyDestinations } from './application/party-navigation.js';

const root = document.getElementById('campaign-workspace');
const navigation = createViewNavigation(document.getElementById('campaign-menu'), root);
const element = (id) => root.querySelector(`#hp-${id}`);
const mapAction = createMapAction(root, (text) => {
  element('announcement').textContent = text;
});
let storage;
try {
  storage = window.localStorage;
} catch {
  /* Restricted browser storage. */
}
const browserStore = await createBrowserStore({
  legacyStorage: storage,
  storageManager: navigator.storage,
});
const saved = { ...browserStore.preferences, ...readUIPreferences(storage) };
saveUIPreferences(storage, saved);
const linked = readMapLink(window.location.href);
const freshSeed = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
    part.toString(16).padStart(8, '0'),
  ).join('-');
const initialColors = linked.colors ?? saved.colors ?? palettes[DEFAULT_PALETTE].slice();
const paletteLibrary = createPaletteLibrary(saved);
const savedPalettes = paletteLibrary.custom;
let layout;
let displayView;
let viewLayoutSource;
let viewSignature;
let inspector;
let batchInspector;
let partyInspector;
const activeInspector = () =>
  session.snapshot()?.partySelected
    ? partyInspector
    : session.snapshot()?.multiEdit
      ? batchInspector
      : inspector;
let cellsByKey = new Map();
let renderer;
let mapView;
let mapViewLoading;
let disposed = false;
let iconCacheRevision = 0;
let iconCacheTimer;
let partyButtonSignature = '';
const session = createCampaignSession({ persist: persistCampaign });
const initialVariant =
  linked.variant ?? (linked.seed && linked.seed !== saved.seed ? 0 : (saved.variant ?? 0));
let movement = saved.motion ?? true;
let defaultTimeOfDay = saved.defaultTimeOfDay ?? 'dawn';
let campaignHistory;
const selection = element('selection');
const PARTY_SELECTION = '__party__';
const movePartyDialog = element('move-party-dialog');
let pendingPartyMove;
let movePartyPressedButton = null;
const preset = element('preset');
const message = element('message');
const saveStatus = createSaveStatus(({ campaigns, preferences, message }) => {
  document.getElementById('campaign-save-warning').hidden = !campaigns && !preferences;
  document.getElementById('campaign-save-message').textContent = message;
  element('save-warning').hidden = !campaigns && !preferences;
  element('save-message').textContent = message;
  element('download-unsaved').hidden = !campaigns;
});
const listeners = new AbortController();
const listen = (target, type, handler) =>
  target.addEventListener(type, handler, { signal: listeners.signal });
const panels = createPanels(root, saved, () => {
  if (session.snapshot()) session.save();
  inspector?.refreshPreview();
  partyInspector?.refreshPreview();
});
const mapConsole = createMapConsole({
  write(text, kind) {
    message.textContent = kind === 'summary' ? text.replace(' · ', '\n· ') : text;
    message.title = text;
    message.dataset.kind = kind;
    const notice = element('mobile-notice');
    notice.textContent = text;
    notice.dataset.kind = kind;
    notice.hidden = !['action', 'error'].includes(kind) || !text;
  },
  announce(text) {
    element('announcement').textContent = text;
  },
});
const mobileLayout = window.matchMedia(
  '(max-width: 760px), (max-width: 1024px) and (max-height: 500px)',
);
const mapOptions = element('map-options');
const expandMap = element('expand-map');
let settingsOpen = false;
let expanded = false;
let keyboardNavigation = false;
const controlTooltips = createControlTooltips();

function setSettingsOpen(enabled) {
  settingsOpen = enabled;
  mapOptions.classList.toggle('is-collapsed', !enabled);
  const button = element('toggle-settings');
  const label = `${enabled ? 'Close' : 'Open'} palette and settings`;
  button.setAttribute('aria-expanded', String(enabled));
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = enabled ? 'Close panel' : 'Open panel';
  button
    .querySelector('use')
    .setAttribute('href', `/icons/pixelarticons.svg#${enabled ? 'collapse' : 'expand'}`);
  element('motion').hidden = !enabled;
  element('regenerate').hidden = !enabled || Boolean(session.snapshot()?.campaign.fogOfWar);
  syncAppearanceLayout();
}
setSettingsOpen(settingsOpen);
listen(element('toggle-settings'), 'click', () => {
  setSettingsOpen(!settingsOpen);
});

function syncAppearanceLayout() {
  const modes = root.querySelector('.hp-map-modes');
  const picker = element('palette-picker');
  const time = element('time-of-day');
  const focused = document.activeElement;
  const timeParent = settingsOpen && !mobileLayout.matches ? modes : picker;
  if (time.parentElement !== timeParent) {
    if (timeParent === modes) modes.prepend(time);
    else picker.append(time);
  }
  if (focused === time && document.activeElement !== focused)
    focused.focus({ preventScroll: true });
}

function setExpanded(enabled) {
  expanded = enabled;
  root.classList.toggle('hp-map-expanded', enabled);
  document.body.classList.toggle('hp-map-expanded', enabled);
  const label = enabled ? 'Exit expanded map' : 'Expand map to viewport';
  expandMap.setAttribute('aria-label', label);
  expandMap.setAttribute('aria-pressed', String(enabled));
  expandMap.dataset.tooltip = enabled ? 'Exit expanded map' : 'Expand map';
  if (!enabled) inspector?.refreshPreview();
}

listen(expandMap, 'click', () => setExpanded(!expanded));
listen(document, 'pointerdown', () => {
  if (document.documentElement.dataset.mapInput !== 'pointer')
    document.documentElement.dataset.mapInput = 'pointer';
  keyboardNavigation = false;
  if (!root.hidden) renderer?.setPartyKeys(false);
});
listen(document, 'keydown', (event) => {
  if (document.documentElement.dataset.mapInput !== 'keyboard')
    document.documentElement.dataset.mapInput = 'keyboard';
  if (event.key === 'Tab' && !root.hidden && !document.querySelector('dialog[open]')) {
    keyboardNavigation = true;
    renderer?.setPartyKeys(Boolean(session.snapshot()?.partySelected));
  }
  if (event.key === 'Escape' && expanded) {
    event.preventDefault();
    setExpanded(false);
  }
  if (
    root.hidden ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    document.querySelector('dialog[open]') ||
    event.target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return;
  if (event.key === 'Tab' || Object.hasOwn(PARTY_KEYS, event.key.toLowerCase())) {
    keyboardNavigation = true;
    renderer?.setPartyKeys(Boolean(session.snapshot()?.partySelected));
  }
  const shortcut = event.key.toLowerCase();
  if (session.snapshot()?.partySelected && Object.hasOwn(PARTY_KEYS, shortcut)) {
    event.preventDefault();
    if (event.repeat || mapAction.isBusy() || renderer?.isInteracting()) return;
    const target = partyDestinations(
      session.snapshot().campaign.partyToken.key,
      displayView.layout,
    ).find((entry) => entry.shortcut === shortcut);
    if (target) handleAction(session.moveParty(target.key));
    else mapConsole.notify('Map edge: no adjacent hex in that direction.');
    return;
  }
  const pan = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  }[event.key];
  if (pan) {
    event.preventDefault();
    if (!event.repeat && !mapAction.isBusy()) renderer?.pan(...pan);
    return;
  }
  const factor = event.key === '+' || event.key === '=' ? 1.2 : event.key === '-' ? 1 / 1.2 : 0;
  if (factor) {
    event.preventDefault();
    if (!mapAction.isBusy()) renderer?.zoom(factor);
  }
});
function syncMobileLayout() {
  const viewControls = element('view-controls');
  if (mobileLayout.matches) {
    root.querySelector('.hp-map-stage').append(viewControls);
    root.querySelector('.hp-mobile-map-controls').prepend(selection);
  } else {
    root.querySelector('.hp-tools').prepend(viewControls);
    root.querySelector('.hp-status').prepend(selection);
  }
  if (!mobileLayout.matches) setExpanded(false);
  syncAppearanceLayout();
}
listen(mobileLayout, 'change', syncMobileLayout);
syncMobileLayout();

let campaignMenu;
let preferencesRevision = 0;
let preferencesFailed = false;
function persistPreferences() {
  // Noncritical UI defaults and panel preferences stay in localStorage.
  return saveUIPreferences(storage, {
    motion: movement,
    defaultTimeOfDay,
    ...panels.preferences(),
  });
}

async function persistPalettes() {
  const revision = ++preferencesRevision;
  const success = await browserStore.save({ palettes: paletteLibrary.preferences() });
  if (revision === preferencesRevision) {
    preferencesFailed = !success;
    saveStatus.update('preferences', success);
  }
  return success;
}

async function persistCampaign(campaign) {
  campaignHistory?.update(campaign);
  persistPreferences();
  const revision = ++preferencesRevision;
  const campaignSaved = await campaignMenu.update(campaign, paletteLibrary.preferences());
  if (revision === preferencesRevision) {
    preferencesFailed = !campaignSaved;
    saveStatus.update('preferences', campaignSaved);
  }
  return { campaignSaved, preferencesSaved: campaignSaved };
}

async function retrySaving() {
  const uiSaved = persistPreferences();
  const revision = ++preferencesRevision;
  const success = await campaignMenu.save(
    paletteLibrary.preferences(),
    session.snapshot()?.campaign.id,
  );
  if (revision === preferencesRevision) {
    preferencesFailed = !success || !uiSaved;
    saveStatus.update('preferences', success && uiSaved);
  }
}
listen(document.getElementById('retry-campaign-save'), 'click', retrySaving);
listen(element('retry-save'), 'click', retrySaving);
const downloadUnsaved = () => campaignMenu.downloadRecovery(paletteLibrary.preferences());
listen(document.getElementById('download-unsaved-library'), 'click', downloadUnsaved);
listen(element('download-unsaved-data'), 'click', downloadUnsaved);
listen(window, 'beforeunload', (event) => {
  if (
    browserStore.status().pending ||
    browserStore.status().unsaved ||
    preferencesFailed ||
    (browserStore.status().reason && session.snapshot())
  ) {
    event.preventDefault();
    event.returnValue = '';
  }
});

async function loadMapView() {
  mapViewLoading ??= import('./ui/map-view.js').catch((error) => {
    mapViewLoading = undefined;
    throw error;
  });
  mapView = await mapViewLoading;
  return mapView;
}

async function openCampaign(campaign, { fromHistory = false } = {}) {
  try {
    const opened = await navigation.show('forward', async () => {
      await loadMapView();
      if (disposed) return false;
      const keepView = Boolean(renderer && session.snapshot()?.campaign.id === campaign.id);
      panels.enterCampaign();
      session.open(campaign);
      presentCampaign({ resetView: !keepView });
      if (!fromHistory) campaignHistory?.enter(session.snapshot().campaign);
    });
    if (opened) {
      inspector.refreshPreview();
    }
    return opened;
  } catch (error) {
    renderer?.setMotion(false);
    throw error;
  }
}

function presentCampaign({ resetView = false } = {}) {
  const { campaign, world } = session.snapshot();
  setSettingsOpen(false);
  inspector.reset();
  batchInspector.reset();
  root.hidden = false;
  if (!renderer)
    renderer = mapView.createMapRenderer(element('scene'), {
      motion: movement,
      touchMultiSelect: true,
      onPartyMove(key) {
        if (mapAction.isBusy() || movePartyDialog.open || !session.snapshot()?.partySelected)
          return false;
        return handleAction(session.moveParty(key));
      },
      onPartySelect: selectParty,
      onSelect(key, { additive = false, fromMap = false } = {}) {
        if (!key) return;
        if (mapAction.isBusy()) {
          renderer.select(session.snapshot().selected, { notify: false });
          syncSelection();
          return;
        }
        const { selected, multiEdit, partySelected } = session.snapshot();
        if (
          fromMap &&
          mobileLayout.matches &&
          partySelected &&
          key !== session.snapshot().campaign.partyToken.key
        ) {
          renderer.cancelInteraction();
          renderer.select(selected, { notify: false });
          syncSelection();
          movePartyPressedButton = null;
          pendingPartyMove = { key, campaignId: session.snapshot().campaign.id };
          const name = session.snapshot().campaign.partyToken.name ?? 'Adventurers';
          element('move-party-question').textContent =
            `Move ${name} token to ${selection.querySelector(`option[value="${key}"]`).textContent}?`;
          if (!movePartyDialog.open) openDialog(movePartyDialog);
          return;
        }
        const enableMultiEdit = additive && !multiEdit;
        const proceed = () => renderer.select(key, { additive });
        const ready = enableMultiEdit
          ? activeInspector().beforeLeave(proceed)
          : multiEdit
            ? batchInspector.beforeLeave(proceed)
            : session.snapshot().partySelected
              ? partyInspector.beforeLeave(proceed)
              : inspector.beforeSelection(key, proceed);
        if (!ready) {
          renderer.select(selected, { notify: false });
          selection.value = selected;
          syncSelection();
          return;
        }
        if (enableMultiEdit) {
          session.setMultiEdit(true);
          inspector.reset();
          batchInspector.reset();
        }
        if (!enableMultiEdit || key !== selected) session.select(key);
        selection.value = key;
        root.dataset.selected = key;
        mapConsole.hover(shortCoordinates(cellsByKey.get(key)));
        updateInspector();
        syncSelection();
      },
      onHover(key) {
        mapConsole.hover(shortCoordinates(cellsByKey.get(key)));
      },
    });
  if (!renderer) throw new Error('This map needs WebGL support. Try again or use another browser.');
  renderer?.setMotion(movement);
  syncTimeOfDay();
  applyPalette();
  renderWorld({ resetView });
  renderer?.focus(campaign.partyToken.key, { hexesWide: 9 / 1.2 ** 3 });
  root.querySelector('.hp-title').textContent = campaign.name;
  document.title = `${campaign.name} · Wilderness Almanac`;
  root.dataset.mapName = world.name;
  root.dataset.seed = campaign.seed;
  root.dataset.hexCount = String(world.cells.length);
  mapConsole.reset(`${world.cells.length} hexes · ${world.regions.length} regions`);
  scheduleCampaignIcons();
}

function scheduleCampaignIcons() {
  const revision = ++iconCacheRevision;
  clearTimeout(iconCacheTimer);
  // Let the map and page transition paint before preparing still previews.
  iconCacheTimer = setTimeout(() => void cacheCampaignIcons(revision), 300);
}

async function cacheCampaignIcons(revision) {
  const { campaign, world } = session.snapshot();
  const tiles = layout;
  const current = () => !disposed && revision === iconCacheRevision;
  try {
    const previous = await loadThumbnails(campaign);
    const cached = new Map(previous.map((entry) => [entry.key, entry]));
    const keys = [
      ...new Set([...campaignIconCandidates(world).map((cell) => cell.key), campaign.iconKey]),
    ];
    const images = new Map();
    const entries = () => keys.map((key) => images.get(key)).filter(Boolean);
    // Publish the chosen tile first; a cancelled gallery job still leaves a cover.
    for (const key of new Set([campaign.iconKey, ...keys])) {
      if (!current()) return;
      let entry = cached.get(key);
      if (!entry) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!current()) return;
        const image = mapView.tilePreview(
          tiles?.find((tile) => tile.key === key),
          campaign.colors,
        );
        if (image) entry = { key, image };
      }
      if (!entry && key === campaign.iconKey) return;
      if (entry) images.set(key, entry);
      if (key === campaign.iconKey && !cached.has(key)) {
        await saveThumbnails(campaign, entries());
        if (current()) campaignMenu.refreshThumbnail(campaign);
      }
    }
    const gallery = entries();
    if (!current()) return;
    if (
      gallery.length !== previous.length ||
      gallery.some((entry, index) => entry !== previous[index])
    )
      await saveThumbnails(campaign, gallery);
    if (current()) campaignMenu.refreshThumbnail(campaign);
  } catch {
    /* Optional thumbnails never interfere with the current campaign. */
  }
}

function handleAction(result) {
  if (!result.ok) {
    if (result.error) {
      activeInspector().error(result.error);
      mapConsole.error(result.error);
    }
    return false;
  }
  if (result.scope === 'lighting') syncTimeOfDay();
  else if (result.scope === 'world') renderWorld();
  else {
    if (result.scope === 'palette') applyPalette();
    refreshPresentation();
    syncSelection();
    updateInspector();
  }
  syncParty();
  if (['world', 'palette', 'icon'].includes(result.scope)) scheduleCampaignIcons();
  if (result.notification) mapConsole.notify(result.notification);
  return true;
}

function syncFogControls() {
  const enabled = Boolean(session.snapshot()?.campaign.fogOfWar);
  element('fog').setAttribute('aria-checked', String(enabled));
  element('fog-state').textContent = enabled ? 'ON' : 'OFF';
  element('fog').dataset.tooltip = enabled ? 'Turn fog of war off' : 'Turn fog of war on';
  root.dataset.fogOfWar = String(enabled);
  element('regenerate').hidden = !settingsOpen || enabled;
}

function refreshPresentation({ resetView = false } = {}) {
  const { world, campaign, visibility } = session.snapshot();
  syncFogControls();
  const signature = visibility ? world.cells.map((cell) => visibility.get(cell.key)).join(',') : '';
  if (viewLayoutSource === layout && viewSignature === signature) return;
  displayView = createFogView(world, layout, visibility);
  viewLayoutSource = layout;
  viewSignature = signature;
  cellsByKey = new Map(displayView.world.cells.map((cell) => [cell.key, cell]));
  const partyOption = document.createElement('option');
  partyOption.value = PARTY_SELECTION;
  partyOption.textContent = campaign.partyToken.name ?? 'Adventurers';
  selection.replaceChildren(
    partyOption,
    ...displayView.layout.map((cell) => {
      const option = document.createElement('option');
      option.value = cell.key;
      option.textContent = describeHex(cell);
      if (cell.fogState !== 'undiscovered') {
        option.dataset.elevation = String(cell.elevation);
        option.dataset.terrain = cell.terrain;
        option.dataset.settlement = cell.pointOfLight?.type ?? '';
        option.dataset.poi =
          cell.pointsOfInterest.map((poi) => poi.kind).join(',') || cell.crossing?.kind || '';
      }
      return option;
    }),
  );
  renderer?.setMap(displayView.layout, { resetView, preserveFraming: !resetView });
  renderer?.select(session.snapshot().selected, { notify: false });
  syncParty();
}

function renderWorld({ resetView = false } = {}) {
  const { world, dressing, campaign } = session.snapshot();
  layout = prepareMap(world, dressing);
  refreshPresentation({ resetView });
  syncSelection();
  root.dataset.variant = String(campaign.variant);
  updateInspector();
}

function updatePaletteOptions() {
  preset.querySelectorAll('[data-saved]').forEach((option) => option.remove());
  savedPalettes.forEach((palette, index) => {
    const option = document.createElement('option');
    option.value = `saved:${index}`;
    option.textContent = palette.name;
    option.dataset.saved = '';
    preset.insertBefore(option, preset.querySelector('option[value="save-new"]'));
  });
}

function applyMenuTheme() {
  const palette = paletteLibrary.default();
  const theme = palette.id === 'forbidden' ? null : paletteTheme(palette.colors);
  const menu = document.getElementById('campaign-menu');
  const values = theme
    ? { ...theme, surface: theme.bg, 'page-bg': theme.bg, focus: theme.text, gold: theme.text }
    : {};
  for (const role of ['surface', 'text', 'muted', 'line', 'page-bg', 'focus', 'gold']) {
    if (values[role]) menu.style.setProperty(`--${role}`, values[role]);
    else menu.style.removeProperty(`--${role}`);
  }
  if (theme) document.documentElement.style.setProperty('--menu-page-bg', theme.bg);
  else document.documentElement.style.removeProperty('--menu-page-bg');
}

function applyPalette() {
  const colors = session.snapshot()?.campaign.colors ?? initialColors;
  renderer?.setPalette(colors);
  syncParty();
  Object.entries(paletteTheme(colors)).forEach(([role, value]) =>
    root.style.setProperty(`--hp-${role}`, value),
  );
  const background = paletteTheme(colors).bg;
  root.style.setProperty(
    '--hp-panel-bg',
    createColorScale([background])(0, hexToOklch(background)[0], 0.925),
  );
  ['ground', 'water', 'elements'].forEach((name, index) => {
    element(name).value = colors[index];
    element(name).closest('.hp-swatch').style.setProperty('--swatch-color', colors[index]);
    element(`${name}-value`).textContent = colors[index].toUpperCase();
    element(name).dataset.tooltip =
      `${name[0].toUpperCase() + name.slice(1)} · ${colors[index].toUpperCase()}`;
  });
  selectPalette(colors);
}

function syncParty() {
  const campaign = session.snapshot()?.campaign;
  if (campaign?.partyToken) {
    renderer?.setParty(campaign.partyToken, campaign.colors);
    const option = selection.querySelector(`option[value="${PARTY_SELECTION}"]`);
    if (option) option.textContent = campaign.partyToken.name ?? 'Adventurers';
    const color = campaign.partyToken.color ?? mapView.partyColor(campaign.colors);
    const signature = JSON.stringify([campaign.partyToken.style, color, campaign.colors]);
    if (signature !== partyButtonSignature) {
      const src = mapView.partyPreview(campaign.partyToken, campaign.colors, color);
      if (src) {
        const image = element('find-party-preview');
        image.src = src;
        image.hidden = false;
        element('find-party').querySelector('svg').setAttribute('hidden', '');
        partyButtonSignature = signature;
      }
    }
  }
}

function selectPalette(colors) {
  const same = (candidate) =>
    candidate.every((color, index) => color.toLowerCase() === colors[index].toLowerCase());
  const builtin = Object.keys(palettes).find((key) => same(palettes[key]));
  const custom = savedPalettes.findIndex((palette) => same(palette.colors));
  const namedCustom = savedPalettes.findIndex(
    (palette) => palette.name === session.snapshot()?.campaign.paletteName && same(palette.colors),
  );
  preset.value =
    namedCustom >= 0
      ? `saved:${namedCustom}`
      : (builtin ?? (custom >= 0 ? `saved:${custom}` : 'custom'));
}

function paletteLabel(candidate) {
  const same = (other) =>
    other.every((color, index) => color.toLowerCase() === candidate[index].toLowerCase());
  const builtin = Object.keys(palettes).find((key) => same(palettes[key]));
  return builtin
    ? paletteNames[builtin]
    : (savedPalettes.find((palette) => same(palette.colors))?.name ?? 'Custom');
}

function selectParty(afterSelect = () => {}) {
  if (mapAction.isBusy()) {
    syncSelection();
    return false;
  }
  if (session.snapshot().partySelected) {
    element('scene').querySelector('canvas')?.focus({ preventScroll: true });
    afterSelect();
    return true;
  }
  const change = () => {
    session.selectParty();
    inspector.reset();
    batchInspector.reset();
    partyInspector.reset();
    syncSelection();
    updateInspector();
    element('scene').querySelector('canvas')?.focus({ preventScroll: true });
    afterSelect();
  };
  if (!activeInspector().beforeLeave(change)) {
    syncSelection();
    return false;
  }
  change();
  return true;
}
listen(element('find-party'), 'click', () => {
  selectParty(() => {
    const party = session.snapshot().campaign.partyToken;
    renderer.focus(party.key, { hexesWide: 9 / 1.2 ** 3 });
    mapConsole.notify(`Showing ${party.name ?? 'Adventurers'} token`);
  });
});
listen(selection, 'change', () => {
  if (selection.value === PARTY_SELECTION) selectParty();
  else renderer?.select(selection.value, { additive: session.snapshot()?.multiEdit });
});
listen(movePartyDialog, 'pointerdown', (event) => {
  movePartyPressedButton = event.button === 0 ? event.target.closest('button') : null;
});
listen(movePartyDialog, 'pointercancel', () => {
  movePartyPressedButton = null;
});
movePartyDialog.addEventListener(
  'click',
  (event) => {
    const button = event.target.closest('button');
    const pressed = movePartyPressedButton;
    movePartyPressedButton = null;
    const pointerClick =
      event.detail > 0 || Boolean(event.pointerType) || event.sourceCapabilities?.firesTouchEvents;
    // Opening on map pointerup can retarget that tap's synthetic click to a modal button.
    // Pointer activation must begin on the button after the dialog opens.
    if (button && pointerClick && button !== pressed) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  { capture: true, signal: listeners.signal },
);
function cancelPartyMove() {
  const target = pendingPartyMove;
  pendingPartyMove = undefined;
  movePartyPressedButton = null;
  renderer?.cancelInteraction();
  movePartyDialog.close();
  if (target && target.campaignId === session.snapshot()?.campaign.id) renderer.select(target.key);
  element('scene').querySelector('canvas')?.focus({ preventScroll: true });
}
listen(element('move-party-cancel'), 'click', cancelPartyMove);
listen(movePartyDialog, 'cancel', (event) => {
  event.preventDefault();
  cancelPartyMove();
});
listen(element('move-party-confirm'), 'click', () => {
  const target = pendingPartyMove;
  pendingPartyMove = undefined;
  movePartyPressedButton = null;
  renderer?.cancelInteraction();
  if (target && target.campaignId === session.snapshot()?.campaign.id && !mapAction.isBusy())
    handleAction(session.moveParty(target.key));
  movePartyDialog.close();
  element('scene').querySelector('canvas')?.focus({ preventScroll: true });
});
listen(element('in'), 'click', () => renderer?.zoom(1.2));
listen(element('out'), 'click', () => renderer?.zoom(1 / 1.2));
function updateMovementToggle() {
  element('motion').setAttribute('aria-checked', String(movement));
  element('motion-state').textContent = movement ? 'ON' : 'OFF';
  element('motion').dataset.tooltip = movement
    ? 'Pause wind, waves, light pulses and lighthouse sweeps'
    : 'Resume wind, waves, light pulses and lighthouse sweeps';
}
updateMovementToggle();
function syncTimeOfDay() {
  const value = timeOfDay(session.snapshot()?.campaign.timeOfDay);
  const label = value[0].toUpperCase() + value.slice(1);
  const next = nextTimeOfDay(value);
  element('time-of-day-label').textContent = `Time: ${label}`;
  element('time-of-day').dataset.tooltip =
    `Change time to ${next[0].toUpperCase() + next.slice(1)}`;
  element('time-of-day')
    .querySelector('use')
    .setAttribute(
      'href',
      `/icons/pixelarticons.svg#${value === 'dawn' || value === 'day' ? 'sun' : 'moon'}`,
    );
  renderer?.setTimeOfDay(value);
  root.dataset.timeOfDay = value;
}
listen(element('time-of-day'), 'click', () => {
  handleAction(session.setTimeOfDay(nextTimeOfDay(session.snapshot().campaign.timeOfDay)));
});
listen(element('motion'), 'click', async () => {
  movement = !movement;
  updateMovementToggle();
  renderer?.setMotion(movement);
  if ((await session.save()).saved)
    mapConsole.notify(movement ? 'Movement turned on' : 'Movement turned off');
});
listen(element('fog'), 'click', (event) => {
  if (mapAction.isBusy()) return;
  const button = event.currentTarget;
  const enabled = !session.snapshot().campaign.fogOfWar;
  const change = () =>
    mapAction.run(
      button,
      () => {
        inspector.reset();
        batchInspector.reset();
        return handleAction(session.fogOfWar(enabled));
      },
      'Updating fog…',
    );
  if (activeInspector().beforeLeave(change)) change();
});
function syncSelection() {
  const state = session.snapshot();
  if (!state) return;
  renderer?.setSelection(state.partySelected ? [] : state.multiEdit ? state.selectedKeys : null);
  renderer?.setPartySelected(state.partySelected);
  root.dataset.multiEdit = String(state.multiEdit);
  root.dataset.selectionCount = String(
    state.partySelected ? 0 : state.multiEdit ? state.selectedKeys.length : 1,
  );
  root.dataset.selected = state.partySelected ? '' : state.selected;
  selection.value = state.partySelected ? PARTY_SELECTION : state.selected;
  selection.setAttribute(
    'aria-label',
    state.multiEdit ? 'Add or remove a hex' : 'Select hex or party',
  );
  renderer?.setPartyKeys(state.partySelected && keyboardNavigation);
  singleInspectorHost.hidden = state.partySelected || state.multiEdit;
  batchInspectorHost.hidden = state.partySelected || !state.multiEdit;
  partyInspectorHost.hidden = !state.partySelected;
  panels.setMultiEdit(state.multiEdit);
  panels.setInspectorMode(state.partySelected ? 'party' : 'hex');
}
function toggleMultiEdit() {
  const change = () => {
    session.setMultiEdit(!session.snapshot().multiEdit);
    inspector.reset();
    batchInspector.reset();
    syncSelection();
    updateInspector();
    mapConsole.notify(session.snapshot().multiEdit ? 'Multiselect on' : 'Multiselect off');
    const focus = root.querySelector(
      session.snapshot().multiEdit ? '#hp-batch-count' : '#hp-hex-edit',
    );
    if (panels.inspectorVisible()) focus?.focus({ preventScroll: true });
  };
  if (!mapAction.isBusy() && activeInspector().beforeLeave(change)) change();
}
async function showMenu() {
  setExpanded(false);
  session.save();
  renderer?.setMotion(false);
  document.title = 'The Wilderness Almanac';
  await navigation.show('back', () => {
    campaignMenu.show();
  });
}
listen(element('back-menu'), 'click', () => {
  if (!mapAction.isBusy()) campaignHistory.back();
});
listen(element('download-unsaved'), 'click', () =>
  campaignMenu.download(session.snapshot().campaign),
);
listen(element('regenerate'), 'click', (event) =>
  mapAction.run(event.currentTarget, () => handleAction(session.regenerate()), 'Regenerating…'),
);
listen(preset, 'change', () => {
  if (preset.value === 'save-new') {
    selectPalette(session.snapshot().campaign.colors);
    element('palette-name').value = '';
    element('palette-name').setCustomValidity('');
    syncPaletteSaveLabel();
    openDialog(element('save-palette-dialog'), element('palette-name'));
    return;
  }
  const savedIndex = Number(preset.value.split(':')[1]);
  const palette = palettes[preset.value] ?? savedPalettes[savedIndex]?.colors;
  if (palette) {
    handleAction(session.palette(palette, preset.selectedOptions[0].textContent));
  }
});
['ground', 'water', 'elements'].forEach((name, index) =>
  listen(element(name), 'input', (event) => {
    const colors = session.snapshot().campaign.colors.slice();
    colors[index] = event.target.value;
    handleAction({ ...session.palette(colors, 'Custom'), notification: undefined });
  }),
);
for (const name of ['ground', 'water', 'elements'])
  listen(element(name), 'change', () =>
    mapConsole.notify(
      `${name[0].toUpperCase() + name.slice(1)} colour saved: ${element(name).value.toUpperCase()}`,
    ),
  );
function syncPaletteSaveLabel() {
  const name = element('palette-name').value.trim();
  const existing = savedPalettes.find(
    (palette) => palette.name.toLowerCase() === name.toLowerCase(),
  );
  element('save-palette').textContent = existing ? `Update ${existing.name}` : 'Save palette';
  element('save-palette').dataset.tooltip = existing
    ? `Replace the saved colours in “${existing.name}”; other campaigns keep their colours.`
    : 'Save these colours as a new custom palette.';
}
listen(element('palette-form'), 'submit', (event) => {
  event.preventDefault();
  const input = element('palette-name');
  const name = input.value.trim();
  if (!name) {
    input.setCustomValidity('Enter a palette name.');
    input.reportValidity();
    return;
  }
  const index = savedPalettes.findIndex(
    (palette) => palette.name.toLowerCase() === name.toLowerCase(),
  );
  const colors = session.snapshot().campaign.colors;
  const palette = index < 0 ? paletteLibrary.add(colors) : savedPalettes[index];
  paletteLibrary.rename(palette.id, name);
  palette.colors = colors.slice();
  updatePaletteOptions();
  handleAction({
    ...session.palette(colors, name),
    notification: index < 0 ? 'Palette created' : 'Palette updated',
  });
  input.value = '';
  syncPaletteSaveLabel();
  element('save-palette-dialog').close();
});
listen(element('cancel-save-palette'), 'click', () => element('save-palette-dialog').close());
listen(element('palette-name'), 'input', () => {
  element('palette-name').setCustomValidity('');
  syncPaletteSaveLabel();
});

function updateInspector() {
  const state = session.snapshot();
  if (!state) return;
  const { dressing, selected, campaign, canUndo } = state;
  if (state.partySelected) {
    partyInspector?.update({ ...state, visibleWorld: displayView.world });
    return;
  }
  if (state.multiEdit) {
    const keys = new Set(state.selectedKeys);
    batchInspector?.update({
      cells: displayView.world.cells.filter((cell) => keys.has(cell.key)),
      fogOfWar: Boolean(campaign.fogOfWar),
      edits: campaign.hexEdits?.cells,
      join: campaign.fogOfWar ? null : state.join,
      canUndo,
      undoLabel: state.undoLabel,
      undoReason: state.undoReason,
    });
    return;
  }
  const colors = campaign.colors;
  const cell = cellsByKey.get(selected);
  if (!cell || !dressing || !layout) return;
  const edit = campaign.hexEdits?.cells[selected];
  inspector?.update({
    world: displayView.world,
    cell,
    dressed: displayView.layout.find((entry) => entry.key === selected),
    tile: displayView.layout.find((entry) => entry.key === selected),
    fogOfWar: Boolean(campaign.fogOfWar),
    colors,
    visited: edit?.visited ?? false,
    locked: Boolean(edit?.lock),
    canUndo,
    undoLabel: state.undoLabel,
    undoReason: state.undoReason,
    isIcon: campaign.iconKey === selected,
  });
}

const singleInspectorHost = document.createElement('div');
const batchInspectorHost = document.createElement('div');
const partyInspectorHost = document.createElement('div');
partyInspectorHost.hidden = true;
batchInspectorHost.hidden = true;
panels.inspector.append(singleInspectorHost, batchInspectorHost, partyInspectorHost);
partyInspector = createPartyInspector(partyInspectorHost, {
  onChange: (patch) => handleAction(session.partyDetails(patch)),
  onNavigate(key) {
    if (mapAction.isBusy()) return;
    renderer.select(key);
    const state = session.snapshot();
    if (!state.partySelected && !state.multiEdit && state.selected === key) {
      renderer.focus(key);
      mapConsole.notify(`Showing ${hexAddress(cellsByKey.get(key))}`);
    }
  },
  onSelectVisited: (button) =>
    mapAction.run(
      button,
      () => {
        if (!session.selectVisited()) return;
        inspector.reset();
        batchInspector.reset();
        renderer.select(session.snapshot().selected, { notify: false });
        syncSelection();
        updateInspector();
        mapConsole.notify(`${session.snapshot().selectedKeys.length} visited hexes selected`);
      },
      'Selecting…',
    ),
  preview: (party, colors, color) => mapView?.partyPreview(party, colors, color) ?? '',
  colorFor: (colors) => mapView.partyColor(colors),
  visible: () => Boolean(session.snapshot()?.partySelected) && panels.inspectorVisible(),
});
inspector = createHexInspector(singleInspectorHost, {
  visible: panels.inspectorVisible,
  preview: (tile, colors) => mapView?.tilePreview(tile, colors, { fitContent: true }) ?? '',
  onApply: (patch, button) => mapAction.run(button, () => handleAction(session.apply(patch))),
  onVisit: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.visit()), 'Updating visit…'),
  onLock: () => handleAction(session.lock()),
  onRegenerate: (event) =>
    mapAction.run(
      event.currentTarget,
      () => handleAction(session.regenerateHex()),
      'Regenerating…',
    ),
  onReset: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.reset()), 'Resetting…'),
  onUndo: (event) =>
    mapAction.run(event.currentTarget, () => handleAction(session.undo()), 'Undoing…'),
  onSetIcon: () => handleAction(session.icon()),
  onMultiEdit: toggleMultiEdit,
  onNotify: (text) => mapConsole.notify(text),
});
batchInspector = createBatchInspector(batchInspectorHost, {
  onNotify: (text) => mapConsole.notify(text),
  onApply: (patch, button) => mapAction.run(button, () => handleAction(session.applyBatch(patch))),
  onJoin: (button) =>
    mapAction.run(button, () => handleAction(session.joinSelection()), 'Joining…'),
  onResetSelected: (button) =>
    mapAction.run(
      button,
      () => handleAction(session.resetSelected({ confirmed: true })),
      'Resetting…',
    ),
  onUndo: (button) => mapAction.run(button, () => handleAction(session.undo()), 'Undoing…'),
  onSelectAll: (button) =>
    mapAction.run(
      button,
      () => {
        session.selectAll();
        syncSelection();
        updateInspector();
        mapConsole.notify(`${session.snapshot().selectedKeys.length} hexes selected`);
      },
      'Selecting…',
    ),
  onTurnOff: toggleMultiEdit,
  onClear: (button) =>
    mapAction.run(
      button,
      () => {
        session.clearSelection();
        syncSelection();
        updateInspector();
        mapConsole.notify('Selection cleared');
      },
      'Clearing…',
    ),
});

updatePaletteOptions();
applyMenuTheme();
applyPalette();
campaignMenu = createCampaignMenu({
  store: browserStore,
  defaultPalette: () => {
    const palette = paletteLibrary.default();
    return { colors: palette.colors, paletteName: palette.name };
  },
  onEnter: openCampaign,
  onNewCampaign: () => campaignCreator.open(),
  saveStatus,
});
const campaignCreator = createCampaignCreator({
  library: paletteLibrary,
  loadMapView,
  freshSeed,
  defaultTimeOfDay: () => defaultTimeOfDay,
  async onCreate(campaign) {
    await campaignMenu.add(campaign);
    return campaignMenu.enter(campaign);
  },
});
const paletteManager = createPaletteManager({
  library: paletteLibrary,
  onChange() {
    applyMenuTheme();
    updatePaletteOptions();
    selectPalette(session.snapshot()?.campaign.colors ?? initialColors);
    return persistPalettes();
  },
});
const settings = createSettings({
  library: paletteLibrary,
  read: () => ({ defaultTimeOfDay, motion: movement }),
  async onSave(values, imported) {
    paletteLibrary.setDefault(values.defaultPalette);
    defaultTimeOfDay = values.defaultTimeOfDay;
    movement = values.motion;
    updateMovementToggle();
    renderer?.setMotion(false);
    const uiSaved = persistPreferences();
    applyMenuTheme();
    const revision = ++preferencesRevision;
    const saved = imported
      ? await campaignMenu.add(imported, paletteLibrary.preferences())
      : await campaignMenu.save(paletteLibrary.preferences());
    if (revision === preferencesRevision) {
      preferencesFailed = !saved || !uiSaved;
      saveStatus.update('preferences', saved && uiSaved);
    }
    campaignMenu.render();
    const message = document.getElementById('campaign-message');
    message.dataset.kind = saved && uiSaved ? 'status' : 'error';
    message.textContent =
      !saved || !uiSaved
        ? 'Some settings could not be saved in this browser. Keep this page open and retry saving.'
        : imported
          ? `Settings saved. Imported “${imported.name}”.`
          : 'Settings saved.';
  },
});
const accountButton = document.getElementById('open-account');
accountButton.hidden = import.meta.env.VITE_API_ENABLED !== 'true';
let accountPanel;
let accountLoading;
listen(accountButton, 'click', async () => {
  accountButton.disabled = true;
  try {
    accountLoading ??= import('./ui/account-sync.js');
    const { createAccountPanel } = await accountLoading;
    if (disposed) return;
    accountPanel ??= createAccountPanel({ store: browserStore, library: campaignMenu });
    // Disabling a button during lazy loading removes browser focus. Restore it
    // before openDialog captures the invoker for its close/focus contract.
    accountButton.disabled = false;
    accountButton.focus({ preventScroll: true });
    await accountPanel.open();
  } catch {
    accountLoading = undefined;
    document.getElementById('campaign-message').textContent =
      'Account sync could not open. Your local campaigns are still available.';
  } finally {
    accountButton.disabled = false;
  }
});
const replayState = {
  seed: linked.seed,
  generatorVersion: linked.generatorVersion ?? 6,
  preferences: linked.preferences,
  variant: initialVariant,
  colors: initialColors,
};
const matchesLink = (campaign) =>
  !linked.seed ||
  campaignMenu.findReplay({ ...replayState, campaignId: campaign.id })?.id === campaign.id;
campaignHistory = createCampaignHistory({
  hasCampaign: (id) =>
    browserStore.campaigns.some((campaign) => campaign.id === id && matchesLink(campaign)),
  async onNavigate(id, retry) {
    if (mapAction.isBusy() || document.querySelector('dialog[open]')) return false;
    if (!root.hidden && !activeInspector().beforeLeave(retry)) return false;
    if (id === null) {
      await showMenu();
      return true;
    }
    const campaign = campaignMenu.snapshotCampaigns().find((campaign) => campaign.id === id);
    if (!campaign) return false;
    try {
      return root.hidden
        ? await campaignMenu.enter(campaign, undefined, { fromHistory: true })
        : await openCampaign(campaign, { fromHistory: true });
    } catch (error) {
      document.getElementById('campaign-message').textContent =
        `Could not open the map. ${error.message}`;
      return false;
    }
  },
});
const routedCampaign = campaignMenu
  .snapshotCampaigns()
  .find((campaign) => campaign.id === campaignHistory.initialCampaignId);
if (routedCampaign && matchesLink(routedCampaign)) {
  campaignMenu.show();
  campaignMenu.enter(routedCampaign);
} else if (linked.seed) {
  const state = {
    ...replayState,
    campaignId: campaignHistory.initialCampaignId ?? saved.campaignId,
  };
  let campaign = campaignMenu.findReplay(state);
  if (!campaign) {
    campaign = createCampaign(
      generateWorld(linked.seed, {
        generatorVersion: linked.generatorVersion ?? 6,
        preferences: linked.preferences,
      }),
      initialColors,
      paletteLabel(initialColors),
      initialVariant,
      defaultTimeOfDay,
    );
    await campaignMenu.add(campaign);
  }
  campaignMenu.enter(campaign);
} else campaignMenu.show();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    clearTimeout(iconCacheTimer);
    iconCacheRevision++;
    navigation.dispose();
    campaignHistory.dispose();
    setExpanded(false);
    listeners.abort();
    mapAction.dispose();
    mapConsole.dispose();
    controlTooltips.dispose();
    renderer?.dispose();
    campaignMenu.dispose();
    browserStore.close();
    campaignCreator.dispose();
    paletteManager.dispose();
    settings.dispose();
    accountPanel?.dispose();
    inspector.dispose();
    partyInspector.dispose();
    batchInspector.dispose();
    panels.dispose();
    mapView?.disposeTilePreview();
  });
