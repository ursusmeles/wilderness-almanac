import { generateWorld } from './generation/world.js';
import { prepareMap } from './generation/presentation.js';
import { palettes, paletteTheme, DEFAULT_PALETTE } from './palette.js';
import { readPreferences, savePreferences } from './ui/storage.js';
import { readMapLink, mapLink, copyText, describeHex, shortCoordinates } from './ui/map-link.js';
import { createMapConsole } from './ui/map-console.js';
import { createSaveStatus } from './ui/save-status.js';
import { createCampaign, campaignIconCandidates } from './application/campaigns.js';
import { createCampaignSession } from './application/campaign-session.js';
import { createCampaignMenu } from './ui/campaign-menu.js';
import { createPanels } from './ui/panels.js';
import { createHexInspector } from './ui/hex-inspector.js';
import { loadThumbnails, saveThumbnails } from './ui/thumbnail-cache.js';
import { createViewNavigation } from './ui/view-navigation.js';
import { cloneTemplate } from './ui/templates.js';

const root = document.getElementById('campaign-workspace');
const navigation = createViewNavigation(document.getElementById('campaign-menu'), root);
const element = (id) => root.querySelector(`#hp-${id}`);
let storage;
try {
  storage = window.localStorage;
} catch {
  /* Restricted browser storage. */
}
const saved = readPreferences(storage);
const linked = readMapLink(window.location.href);
const freshSeed = () =>
  Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) =>
    part.toString(16).padStart(8, '0'),
  ).join('-');
const initialColors = linked.colors ?? saved.colors ?? palettes[DEFAULT_PALETTE].slice();
const savedPalettes = saved.palettes ?? [];
let layout;
let inspector;
let cellsByKey = new Map();
let renderer;
let mapView;
let mapViewLoading;
let disposed = false;
let iconCacheRevision = 0;
let iconCacheTimer;
const session = createCampaignSession({ persist: persistCampaign });
const initialVariant =
  linked.variant ?? (linked.seed && linked.seed !== saved.seed ? 0 : (saved.variant ?? 0));
let movement = saved.motion ?? true;
const selection = element('selection');
const preset = element('preset');
const message = element('message');
const dialog = element('new-map-dialog');
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
});
const mapConsole = createMapConsole({
  write(text, kind) {
    message.textContent = text;
    message.title = text;
    message.dataset.kind = kind;
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
let settingsOpen = saved.settingsOpen ?? !mobileLayout.matches;
let expanded = false;

function setSettingsOpen(enabled) {
  settingsOpen = enabled;
  mapOptions.classList.toggle('is-collapsed', !enabled);
  const button = element('toggle-settings');
  const label = `${enabled ? 'Collapse' : 'Open'} palette and settings`;
  button.setAttribute('aria-expanded', String(enabled));
  button.setAttribute('aria-label', label);
  button.title = label;
  element('palette-create').hidden = !enabled;
  element('palette-create')
    .querySelectorAll('input, button')
    .forEach((control) => {
      control.disabled = !enabled;
    });
  element('motion').hidden = !enabled;
}
setSettingsOpen(settingsOpen);
listen(element('toggle-settings'), 'click', () => {
  setSettingsOpen(!settingsOpen);
  if (session.snapshot()) session.save();
});

function setExpanded(enabled) {
  expanded = enabled;
  root.classList.toggle('hp-map-expanded', enabled);
  document.body.classList.toggle('hp-map-expanded', enabled);
  const label = enabled ? 'Exit expanded map' : 'Expand map to viewport';
  expandMap.setAttribute('aria-label', label);
  expandMap.setAttribute('aria-pressed', String(enabled));
  expandMap.title = label;
  if (!enabled) inspector?.refreshPreview();
}

listen(expandMap, 'click', () => setExpanded(!expanded));
listen(document, 'keydown', (event) => {
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
  const factor = event.key === '+' || event.key === '=' ? 1.2 : event.key === '-' ? 1 / 1.2 : 0;
  if (factor) {
    event.preventDefault();
    renderer?.zoom(factor);
  }
});
function syncMobileLayout() {
  if (!mobileLayout.matches) setExpanded(false);
}
listen(mobileLayout, 'change', syncMobileLayout);
syncMobileLayout();

const previousMap = {
  seed: saved.seed,
  colors: (saved.colors ?? palettes[DEFAULT_PALETTE]).slice(),
  variant: saved.variant ?? 0,
  paletteName: '',
};
let campaignMenu;

function persistCampaign(campaign) {
  try {
    history.replaceState(history.state, '', mapLink(window.location.href, campaign));
  } catch {
    /* Sandboxed embeddings can restrict history updates. */
  }
  const preferencesSaved = savePreferences(storage, {
    seed: campaign.seed,
    variant: campaign.variant,
    colors: campaign.colors,
    palettes: savedPalettes,
    motion: movement,
    settingsOpen,
    campaignId: campaign.id,
    ...panels.preferences(),
  });
  const campaignSaved = campaignMenu.update(campaign);
  saveStatus.update('preferences', preferencesSaved);
  return { campaignSaved, preferencesSaved };
}

async function openCampaign(campaign) {
  try {
    const opened = await navigation.show('forward', async () => {
      mapViewLoading ??= import('./ui/map-view.js').catch((error) => {
        mapViewLoading = undefined;
        throw error;
      });
      mapView = await mapViewLoading;
      if (disposed) return false;
      const keepView = Boolean(renderer && session.snapshot()?.campaign.id === campaign.id);
      session.open(campaign);
      presentCampaign({ resetView: !keepView });
    });
    if (opened) inspector.refreshPreview();
    return opened;
  } catch (error) {
    renderer?.setMotion(false);
    throw error;
  }
}

function presentCampaign({ resetView = false } = {}) {
  const { campaign, world } = session.snapshot();
  inspector.reset();
  root.hidden = false;
  if (!renderer)
    renderer = mapView.createMapRenderer(element('scene'), {
      motion: movement,
      onSelect(key) {
        if (!key) return;
        const { selected } = session.snapshot();
        if (!inspector.beforeSelection(key, () => renderer.select(key))) {
          renderer.select(selected);
          selection.value = selected;
          return;
        }
        session.select(key);
        selection.value = key;
        root.dataset.selected = key;
        mapConsole.hover(shortCoordinates(cellsByKey.get(key)));
        updateInspector();
      },
      onHover(key) {
        mapConsole.hover(shortCoordinates(cellsByKey.get(key)));
      },
    });
  renderer?.setMotion(movement);
  applyPalette();
  renderWorld({ resetView });
  if (resetView) renderer?.zoom(mobileLayout.matches ? 1.6 : 1.4 * 1.2);
  element('current-seed').textContent = campaign.seed;
  element('current-seed').title = campaign.seed;
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
    const images = [];
    for (const key of keys) {
      if (!current()) return;
      let entry = cached.get(key);
      if (!entry) {
        // One tile per task keeps the map interactive while the gallery fills.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!current()) return;
        const image = mapView.tilePreview(
          tiles?.find((tile) => tile.key === key),
          campaign.colors,
        );
        if (image) entry = { key, image };
      }
      if (entry) images.push(entry);
    }
    if (!current()) return;
    if (
      images.length !== previous.length ||
      images.some((entry, index) => entry !== previous[index])
    )
      await saveThumbnails(campaign, images);
    if (current()) campaignMenu.refreshThumbnail(campaign);
  } catch {
    /* Optional thumbnails never interfere with the current campaign. */
  }
}

function handleAction(result) {
  if (!result.ok) {
    if (result.error) inspector.error(result.error);
    return false;
  }
  if (result.scope === 'world') renderWorld();
  else if (result.scope === 'palette') {
    applyPalette();
    updateInspector();
  } else updateInspector();
  scheduleCampaignIcons();
  if (result.notification) mapConsole.notify(result.notification);
  return true;
}

function renderWorld({ resetView = false } = {}) {
  const { world, dressing, selected, campaign } = session.snapshot();
  cellsByKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  const dressedCells = new Map(dressing.cells.map((cell) => [cell.key, cell]));
  selection.replaceChildren(
    ...world.cells.map((cell) => {
      const option = document.createElement('option');
      option.value = cell.key;
      option.textContent = describeHex({ ...cell, forest: dressedCells.get(cell.key)?.forest });
      option.dataset.elevation = String(cell.elevation);
      option.dataset.terrain = cell.terrain;
      option.dataset.settlement = cell.pointOfLight?.type ?? '';
      option.dataset.poi =
        cell.pointsOfInterest.map((poi) => poi.kind).join(',') || cell.crossing?.kind || '';
      return option;
    }),
  );
  layout = prepareMap(world, dressing);
  renderer?.setMap(layout, { resetView });
  renderer?.select(selected);
  root.dataset.variant = String(campaign.variant);
  updateInspector();
}

function newMap(seed, confirmed = false) {
  if (!confirmed && !inspector.beforeLeave(() => newMap(seed))) return;
  const result = session.replace(seed, { confirmed });
  if (result.requiresConfirmation) {
    pendingMapSeed = seed;
    if (!replaceDialog.open) replaceDialog.showModal();
    return;
  }
  presentCampaign();
  mapConsole.notify(result.notification);
}

function updatePaletteOptions() {
  preset.querySelectorAll('[data-saved]').forEach((option) => option.remove());
  savedPalettes.forEach((palette, index) => {
    const option = document.createElement('option');
    option.value = `saved:${index}`;
    option.textContent = palette.name;
    option.dataset.saved = '';
    preset.append(option);
  });
}

function applyPalette() {
  const colors = session.snapshot()?.campaign.colors ?? initialColors;
  renderer?.setPalette(colors);
  Object.entries(paletteTheme(colors)).forEach(([role, value]) =>
    root.style.setProperty(`--hp-${role}`, value),
  );
  ['ground', 'water', 'elements'].forEach((name, index) => {
    element(name).value = colors[index];
    element(name).closest('.hp-swatch').style.setProperty('--swatch-color', colors[index]);
    element(`${name}-value`).textContent = colors[index].toUpperCase();
  });
  const same = (candidate) =>
    candidate.every((color, index) => color.toLowerCase() === colors[index].toLowerCase());
  const builtin = Object.keys(palettes).find((key) => same(palettes[key]));
  const custom = savedPalettes.findIndex((palette) => same(palette.colors));
  preset.value = builtin ?? (custom >= 0 ? `saved:${custom}` : 'custom');
}

function paletteLabel(candidate) {
  const same = (other) =>
    other.every((color, index) => color.toLowerCase() === candidate[index].toLowerCase());
  const builtin = Object.keys(palettes).find((key) => same(palettes[key]));
  return builtin
    ? preset.querySelector(`option[value="${builtin}"]`).textContent
    : (savedPalettes.find((palette) => same(palette.colors))?.name ?? 'Custom');
}

listen(selection, 'change', () => renderer?.select(selection.value));
listen(element('in'), 'click', () => renderer?.zoom(1.2));
listen(element('out'), 'click', () => renderer?.zoom(1 / 1.2));
listen(element('mobile-in'), 'click', () => renderer?.zoom(1.2));
listen(element('mobile-out'), 'click', () => renderer?.zoom(1 / 1.2));
listen(element('copy-seed'), 'click', async () => {
  try {
    await copyText(session.snapshot().campaign.seed);
    mapConsole.notify('Seed copied');
  } catch {
    mapConsole.notify('Could not copy the seed. Select the seed text to copy it.');
  }
});
listen(element('share-map'), 'click', async () => {
  const url = mapLink(window.location.href, session.snapshot().campaign);
  try {
    await copyText(url);
    mapConsole.notify('Seed link copied');
  } catch {
    mapConsole.notify('Could not share. Copy the URL from the address bar.');
  }
});
function updateMovementToggle() {
  element('motion').setAttribute('aria-checked', String(movement));
  element('motion-state').textContent = movement ? 'ON' : 'OFF';
}
updateMovementToggle();
listen(element('motion'), 'click', () => {
  movement = !movement;
  updateMovementToggle();
  renderer?.setMotion(movement);
  if (session.save().saved) mapConsole.notify(movement ? 'Wind turned on' : 'Wind turned off');
});
function returnToMenu() {
  if (inspector.beforeLeave(showMenu)) showMenu();
}
async function showMenu() {
  setExpanded(false);
  session.save();
  renderer?.setMotion(false);
  const url = new URL(window.location.href);
  ['seed', 'variant', 'colors'].forEach((key) => url.searchParams.delete(key));
  try {
    history.replaceState(history.state, '', url);
  } catch {
    /* Sandboxed embeddings can restrict history updates. */
  }
  document.title = 'Wilderness Almanac';
  await navigation.show('back', () => {
    campaignMenu.show();
  });
}
listen(element('return-menu'), 'click', returnToMenu);
listen(element('mobile-menu'), 'click', returnToMenu);
listen(element('download-unsaved'), 'click', () =>
  campaignMenu.download(session.snapshot().campaign),
);
listen(element('new-map'), 'click', () => newMap(freshSeed()));
listen(element('map-settings'), 'click', () => {
  element('seed').value = freshSeed();
  element('seed').setCustomValidity('');
  dialog.showModal();
  element('seed').select();
});
listen(element('cancel-new-map'), 'click', () => dialog.close());
listen(element('new-map-form'), 'submit', (event) => {
  event.preventDefault();
  const input = element('seed');
  if (!input.value.trim()) {
    input.setCustomValidity('Enter a seed.');
    input.reportValidity();
    return;
  }
  newMap(input.value.trim());
  dialog.close();
});
listen(element('seed'), 'input', () => element('seed').setCustomValidity(''));
listen(element('regenerate'), 'click', () => {
  handleAction(session.regenerate());
});
listen(preset, 'change', () => {
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
    handleAction(session.palette(colors, 'Custom'));
  }),
);
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
  const palette = { name, colors: colors.slice() };
  if (index < 0) savedPalettes.push(palette);
  else savedPalettes[index] = palette;
  updatePaletteOptions();
  handleAction({
    ...session.palette(colors, name),
    notification: index < 0 ? 'Palette created' : 'Palette updated',
  });
  input.value = '';
});
listen(element('palette-name'), 'input', () => element('palette-name').setCustomValidity(''));

function updateInspector() {
  const state = session.snapshot();
  if (!state) return;
  const { world, dressing, selected, campaign, canUndo } = state;
  const colors = campaign.colors;
  const cell = cellsByKey.get(selected);
  if (!cell || !dressing || !layout) return;
  const edit = campaign.hexEdits?.cells[selected];
  inspector?.update({
    world,
    cell,
    dressed: dressing.cells.find((entry) => entry.key === selected),
    tile: layout.find((entry) => entry.key === selected),
    colors,
    visited: edit?.visited ?? false,
    locked: Boolean(edit?.lock),
    canUndo,
    isIcon: campaign.iconKey === selected,
  });
}

inspector = createHexInspector(panels.inspector, {
  visible: panels.inspectorVisible,
  preview: (tile, colors) => mapView?.tilePreview(tile, colors) ?? '',
  onApply: (patch) => handleAction(session.apply(patch)),
  onVisit: () => handleAction(session.visit()),
  onLock: () => handleAction(session.lock()),
  onRegenerate: () => handleAction(session.regenerateHex()),
  onReset: () => handleAction(session.reset()),
  onUndo: () => handleAction(session.undo()),
  onSetIcon: () => handleAction(session.icon()),
});

let pendingMapSeed;
const replaceDialog = cloneTemplate('replace-world-dialog-template').firstElementChild;
root.append(replaceDialog);
listen(replaceDialog, 'click', (event) => {
  const action = event.target.closest('[data-replace]')?.dataset.replace;
  if (!action) return;
  if (action === 'confirm') {
    newMap(pendingMapSeed, true);
  }
  replaceDialog.close();
});

updatePaletteOptions();
applyPalette();
previousMap.paletteName = paletteLabel(previousMap.colors);
campaignMenu = createCampaignMenu({
  storage,
  previous: previousMap,
  defaultPalette: {
    colors: palettes[DEFAULT_PALETTE],
    paletteName: paletteLabel(palettes[DEFAULT_PALETTE]),
  },
  onEnter: openCampaign,
  saveStatus,
});
if (linked.seed) {
  const state = {
    seed: linked.seed,
    variant: initialVariant,
    colors: initialColors,
    campaignId: saved.campaignId,
  };
  let campaign = campaignMenu.findReplay(state);
  if (!campaign) {
    campaign = createCampaign(
      generateWorld(linked.seed),
      initialColors,
      paletteLabel(initialColors),
      initialVariant,
    );
    campaignMenu.add(campaign);
  }
  campaignMenu.enter(campaign);
} else campaignMenu.show();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposed = true;
    clearTimeout(iconCacheTimer);
    iconCacheRevision++;
    navigation.dispose();
    setExpanded(false);
    listeners.abort();
    mapConsole.dispose();
    renderer?.dispose();
    campaignMenu.dispose();
    inspector.dispose();
    panels.dispose();
    replaceDialog.remove();
    mapView?.disposeTilePreview();
  });
