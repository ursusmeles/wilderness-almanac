import { generateWorld } from './generation/world.js';
import { validateHexEdits } from './generation/hex-edits.js';
import { prepareMap } from './generation/presentation.js';
import { createMapRenderer } from './rendering/map-renderer.js';
import { palettes, paletteTheme, DEFAULT_PALETTE } from './palette.js';
import { readPreferences, savePreferences } from './ui/storage.js';
import { readMapLink, mapLink, copyText, describeHex, shortCoordinates } from './ui/map-link.js';
import { createMapConsole } from './ui/map-console.js';
import { createCampaign, replaceCampaignMap } from './ui/campaigns.js';
import { createCampaignMenu } from './ui/campaign-menu.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
} from './generation/campaign-world.js';
import { createPanels } from './ui/panels.js';
import { createHexInspector } from './ui/hex-inspector.js';
import { disposeTilePreview } from './ui/tile-preview.js';

const root = document.getElementById('campaign-workspace');
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
let colors = linked.colors ?? saved.colors ?? palettes[DEFAULT_PALETTE].slice();
const savedPalettes = saved.palettes ?? [];
let world;
let baseWorld;
let layout;
let inspector;
let undo = [];
let cellsByKey = new Map();
let dressing;
let activeCampaign;
let renderer;
let currentPaletteName;
let variant =
  linked.variant ?? (linked.seed && linked.seed !== saved.seed ? 0 : (saved.variant ?? 0));
let movement = saved.motion ?? true;
let selected = '0,0';
const selection = element('selection');
const preset = element('preset');
const message = element('message');
const dialog = element('new-map-dialog');
const listeners = new AbortController();
const listen = (target, type, handler) =>
  target.addEventListener(type, handler, { signal: listeners.signal });
const panels = createPanels(root, saved, () => {
  if (world) persist();
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
  if (world) persist();
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

function persist() {
  if (activeCampaign) {
    Object.assign(activeCampaign, {
      seed: world.seed,
      variant,
      colors: colors.slice(),
      paletteName: currentPaletteName,
    });
  }
  try {
    history.replaceState(
      history.state,
      '',
      mapLink(window.location.href, { seed: world.seed, variant, colors }),
    );
  } catch {
    /* Sandboxed embeddings can restrict history updates. */
  }
  const preferencesSaved = savePreferences(storage, {
    seed: world.seed,
    variant,
    colors,
    palettes: savedPalettes,
    motion: movement,
    settingsOpen,
    campaignId: activeCampaign?.id,
    ...panels.preferences(),
  });
  const campaignSaved = activeCampaign ? campaignMenu.update(activeCampaign) : true;
  if (!campaignSaved || !preferencesSaved)
    mapConsole.notify('Browser storage is unavailable. Download your campaign to keep it.', 0);
  return preferencesSaved && campaignSaved;
}

function openCampaign(campaign) {
  const keepView = Boolean(renderer && activeCampaign?.id === campaign.id);
  activeCampaign = campaign;
  baseWorld = generateWorld(campaign.seed);
  world = campaignWorld(campaign, baseWorld);
  cellsByKey = new Map(world.cells.map((cell) => [cell.key, cell]));
  campaign.nameEdited ??= campaign.name !== world.name;
  colors = campaign.colors.slice();
  variant = campaign.variant;
  currentPaletteName = campaign.paletteName;
  undo = [];
  inspector?.reset();
  root.hidden = false;
  if (!renderer)
    renderer = createMapRenderer(element('scene'), {
      motion: movement,
      onSelect(key) {
        if (!key) return;
        if (inspector && !inspector.beforeSelection(key, () => renderer.select(key))) {
          renderer?.select(selected);
          selection.value = selected;
          return;
        }
        selected = key;
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
  dressing = campaignDressing(campaign, world);
  applyPalette({ save: false });
  renderWorld({ resetView: !keepView });
  if (!keepView) renderer?.zoom(mobileLayout.matches ? 1.6 : 1.4 * 1.2);
  element('current-seed').textContent = world.seed;
  element('current-seed').title = world.seed;
  root.querySelector('.hp-title').textContent = campaign.name;
  document.title = `${campaign.name} · Wilderness Almanac`;
  root.dataset.mapName = world.name;
  root.dataset.seed = world.seed;
  root.dataset.variant = String(variant);
  root.dataset.hexCount = String(world.cells.length);
  mapConsole.reset(`${world.cells.length} hexes · ${world.regions.length} regions`);
  persist();
}

function renderWorld({ resetView = false } = {}) {
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
  root.dataset.variant = String(variant);
  updateInspector();
}

function newMap(seed) {
  if (Object.keys(activeCampaign.hexEdits?.cells ?? {}).length && !replaceDialog.open) {
    pendingMapSeed = seed;
    replaceDialog.showModal();
    return;
  }
  const nextWorld = generateWorld(seed);
  campaignMenu.enter(replaceCampaignMap(activeCampaign, nextWorld, world.name));
  mapConsole.notify('New map created');
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

function applyPalette({ save = true } = {}) {
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
  if (!currentPaletteName) currentPaletteName = preset.selectedOptions[0].textContent;
  if (world && layout) updateInspector();
  return world && save ? persist() : true;
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
    await copyText(world.seed);
    mapConsole.notify('Seed copied');
  } catch {
    mapConsole.notify('Could not copy the seed. Select the seed text to copy it.');
  }
});
listen(element('share-map'), 'click', async () => {
  const url = mapLink(window.location.href, { seed: world.seed, variant, colors });
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
  if (persist()) mapConsole.notify(movement ? 'Wind turned on' : 'Wind turned off');
});
function returnToMenu() {
  setExpanded(false);
  persist();
  renderer?.setMotion(false);
  root.hidden = true;
  const url = new URL(window.location.href);
  ['seed', 'variant', 'colors'].forEach((key) => url.searchParams.delete(key));
  try {
    history.replaceState(history.state, '', url);
  } catch {
    /* Sandboxed embeddings can restrict history updates. */
  }
  document.title = 'Wilderness Almanac';
  campaignMenu.show();
  document.getElementById('new-campaign').focus({ preventScroll: true });
}
listen(element('return-menu'), 'click', returnToMenu);
listen(element('mobile-menu'), 'click', returnToMenu);
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
  commit({ ...activeCampaign, variant: variant + 1 }, 'Dressing regenerated');
});
listen(preset, 'change', () => {
  const savedIndex = Number(preset.value.split(':')[1]);
  const palette = palettes[preset.value] ?? savedPalettes[savedIndex]?.colors;
  if (palette) {
    colors = palette.slice();
    currentPaletteName = preset.selectedOptions[0].textContent;
    if (applyPalette()) mapConsole.notify('Palette changed');
  }
});
['ground', 'water', 'elements'].forEach((name, index) =>
  listen(element(name), 'input', (event) => {
    colors[index] = event.target.value;
    currentPaletteName = 'Custom';
    if (applyPalette()) mapConsole.notify('Palette changed');
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
  const palette = { name, colors: colors.slice() };
  if (index < 0) savedPalettes.push(palette);
  else savedPalettes[index] = palette;
  updatePaletteOptions();
  currentPaletteName = name;
  if (applyPalette()) mapConsole.notify(index < 0 ? 'Palette created' : 'Palette updated');
  input.value = '';
});
listen(element('palette-name'), 'input', () => element('palette-name').setCustomValidity(''));

function updateInspector() {
  const cell = cellsByKey.get(selected);
  if (!cell || !dressing || !layout) return;
  const edit = activeCampaign.hexEdits?.cells[selected];
  inspector?.update({
    world,
    cell,
    dressed: dressing.cells.find((entry) => entry.key === selected),
    tile: layout.find((entry) => entry.key === selected),
    colors,
    visited: edit?.visited ?? false,
    locked: Boolean(edit?.lock),
    canUndo: undo.length > 0,
  });
}

function commit(next, notification, { fixedCells, relock = false, rerollKey } = {}) {
  try {
    const nextWorld = campaignWorld(next, baseWorld);
    const request = next.hexEdits?.cells[selected]?.crossing;
    if (
      request &&
      nextWorld.cells.find((cell) => cell.key === selected)?.crossing?.kind !== request
    )
      throw new Error(
        'This river hex has no two usable banks for a crossing. Try a neighbouring river hex.',
      );
    const nextDressing = campaignDressing(next, nextWorld, {
      fixedCells,
      rerollKey,
      mountainBase: rerollKey ? dressing.mountains : [],
    });
    if (rerollKey) {
      const edit = next.hexEdits.cells[rerollKey];
      edit.dressing = structuredClone(nextDressing.cells.find((cell) => cell.key === rerollKey));
      const range = nextWorld.cells.find((cell) => cell.key === rerollKey)?.mountainRangeId;
      if (range)
        edit.dressing.mountain = nextDressing.mountains.find((shape) => shape.rangeId === range);
      edit.dressingVariant = next.variant;
      next.hexEdits.cells[rerollKey] = validateHexEdits({
        version: 1,
        cells: { [rerollKey]: edit },
      }).cells[rerollKey];
    }
    if (relock) next = lockHex(next, selected, nextWorld, nextDressing);
    undo.push({ variant, hexEdits: activeCampaign.hexEdits });
    if (undo.length > 20) undo.shift();
    activeCampaign = next;
    world = nextWorld;
    dressing = nextDressing;
    variant = next.variant;
    renderWorld();
    persist();
    mapConsole.notify(notification);
    return true;
  } catch (error) {
    inspector.error(error.message);
    return false;
  }
}

inspector = createHexInspector(panels.inspector, {
  visible: panels.inspectorVisible,
  onApply(patch) {
    const wasLocked = Boolean(activeCampaign.hexEdits?.cells[selected]?.lock);
    return commit(
      updateHex(activeCampaign, selected, patch),
      wasLocked ? 'Hex updated and dressing relocked' : 'Hex updated',
      { relock: wasLocked },
    );
  },
  onVisit() {
    const visited = !activeCampaign.hexEdits?.cells[selected]?.visited;
    // Tracking changes never regenerate terrain or dressing.
    undo.push({ variant, hexEdits: activeCampaign.hexEdits });
    if (undo.length > 20) undo.shift();
    activeCampaign = updateHex(activeCampaign, selected, { visited });
    updateInspector();
    persist();
    mapConsole.notify(visited ? 'Hex marked visited' : 'Hex marked not visited');
  },
  onLock() {
    const locked = Boolean(activeCampaign.hexEdits?.cells[selected]?.lock);
    const next = locked
      ? updateHex(activeCampaign, selected, {})
      : lockHex(activeCampaign, selected, world, dressing);
    if (locked) {
      const edit = next.hexEdits.cells[selected];
      edit.dressing = structuredClone(edit.lock);
      edit.dressingVariant = variant;
      delete edit.lock;
    }
    undo.push({ variant, hexEdits: activeCampaign.hexEdits });
    if (undo.length > 20) undo.shift();
    activeCampaign = next;
    updateInspector();
    persist();
    mapConsole.notify(locked ? 'Dressing unlocked' : 'Dressing locked');
  },
  onRegenerate() {
    const revision = (activeCampaign.hexEdits?.cells[selected]?.revision ?? 0) + 1;
    const fixedCells = Object.fromEntries(
      dressing.cells.filter((cell) => cell.key !== selected).map((cell) => [cell.key, cell]),
    );
    commit(updateHex(activeCampaign, selected, { revision }), 'Hex dressing regenerated', {
      fixedCells,
      rerollKey: selected,
    });
  },
  onReset() {
    const next = updateHex(activeCampaign, selected, {});
    const visited = next.hexEdits.cells[selected].visited;
    if (visited !== undefined) next.hexEdits.cells[selected] = { visited };
    else delete next.hexEdits.cells[selected];
    commit(next, 'Hex reset to generated');
  },
  onUndo() {
    const previous = undo.pop();
    if (!previous) return;
    activeCampaign = { ...activeCampaign, ...previous };
    variant = previous.variant;
    world = campaignWorld(activeCampaign, baseWorld);
    dressing = campaignDressing(activeCampaign, world);
    renderWorld();
    persist();
    mapConsole.notify('Hex action undone');
  },
});

let pendingMapSeed;
const replaceDialog = document.createElement('dialog');
replaceDialog.setAttribute('aria-labelledby', 'hp-replace-title');
replaceDialog.innerHTML =
  '<h2 id="hp-replace-title">Replace this world?</h2><p>A new map clears hex edits, visited statuses and dressing locks in this campaign. Export the campaign first to keep a copy.</p><div class="hp-tools"><button type="button" data-replace="cancel">Keep world</button><button type="button" data-replace="confirm">Create new map</button></div>';
root.append(replaceDialog);
listen(replaceDialog, 'click', (event) => {
  const action = event.target.closest('[data-replace]')?.dataset.replace;
  if (!action) return;
  if (action === 'confirm') {
    const nextWorld = generateWorld(pendingMapSeed);
    campaignMenu.enter(replaceCampaignMap(activeCampaign, nextWorld, world.name));
    mapConsole.notify('New map created');
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
});
if (linked.seed) {
  const state = { seed: linked.seed, variant, colors, campaignId: saved.campaignId };
  let campaign = campaignMenu.findReplay(state);
  if (!campaign) {
    campaign = createCampaign(generateWorld(linked.seed), colors, currentPaletteName, variant);
    campaignMenu.add(campaign);
  }
  campaignMenu.enter(campaign);
} else campaignMenu.show();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    setExpanded(false);
    listeners.abort();
    mapConsole.dispose();
    renderer?.dispose();
    campaignMenu.dispose();
    inspector.dispose();
    panels.dispose();
    replaceDialog.remove();
    disposeTilePreview();
  });
