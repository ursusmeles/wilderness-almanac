import './styles.css';
import { generateWorld, generateDressing } from './generation/world.js';
import { prepareMap } from './generation/presentation.js';
import { createMapRenderer } from './rendering/map-renderer.js';
import { palettes, paletteTheme } from './palette.js';
import { readPreferences, savePreferences } from './ui/storage.js';
import { readMapLink, mapLink, copyText, describeHex } from './ui/map-link.js';
import { createCampaign, replaceCampaignMap } from './ui/campaigns.js';
import { createCampaignMenu } from './ui/campaign-menu.js';

const root = document.getElementById('hex-smooth-riverlands');
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
let colors = linked.colors ?? saved.colors ?? palettes.dusk.slice();
const savedPalettes = saved.palettes ?? [];
let world;
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
const mobileLayout = window.matchMedia(
  '(max-width: 760px), (max-width: 1024px) and (max-height: 500px)',
);
const mapOptions = element('map-options');
const expandMap = element('expand-map');
let expanded = false;

function setExpanded(enabled) {
  expanded = enabled;
  root.classList.toggle('hp-map-expanded', enabled);
  document.body.classList.toggle('hp-map-expanded', enabled);
  const label = enabled ? 'Exit expanded map' : 'Expand map to viewport';
  expandMap.setAttribute('aria-label', label);
  expandMap.setAttribute('aria-pressed', String(enabled));
  expandMap.title = label;
}

listen(expandMap, 'click', () => setExpanded(!expanded));
listen(document, 'keydown', (event) => {
  if (event.key === 'Escape' && expanded) {
    event.preventDefault();
    setExpanded(false);
  }
});
function syncMobileLayout() {
  mapOptions.open = !mobileLayout.matches;
  if (!mobileLayout.matches) setExpanded(false);
}
listen(mobileLayout, 'change', syncMobileLayout);
syncMobileLayout();

const campaignDefaults = {
  seed: saved.seed,
  colors: (saved.colors ?? palettes.dusk).slice(),
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
  campaignDefaults.colors = colors.slice();
  campaignDefaults.paletteName = currentPaletteName;
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
    campaignId: activeCampaign?.id,
  });
  const campaignSaved = activeCampaign ? campaignMenu.update(activeCampaign) : true;
  if (!campaignSaved)
    message.textContent =
      'Browser storage is unavailable. Download your campaign from the menu to keep it.';
  return preferencesSaved && campaignSaved;
}

function openCampaign(campaign) {
  activeCampaign = campaign;
  world = generateWorld(campaign.seed);
  campaign.nameEdited ??= campaign.name !== world.name;
  colors = campaign.colors.slice();
  variant = campaign.variant;
  currentPaletteName = campaign.paletteName;
  root.hidden = false;
  if (!renderer)
    renderer = createMapRenderer(element('scene'), {
      motion: movement,
      onSelect(key) {
        selected = key;
        selection.value = key;
        root.dataset.selected = key;
      },
    });
  renderer?.setMotion(movement);
  dressing = generateDressing(world, variant);
  applyPalette();
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
  renderer?.setMap(prepareMap(world, dressing), { resetView: true });
  if (mobileLayout.matches) renderer?.zoom(1.6);
  renderer?.select(selected);
  element('current-seed').textContent = world.seed;
  root.querySelector('.hp-title').textContent = campaign.name;
  document.title = `${campaign.name} · Wilderness Almanac`;
  root.dataset.mapName = world.name;
  root.dataset.seed = world.seed;
  root.dataset.variant = String(variant);
  root.dataset.hexCount = String(world.cells.length);
  message.textContent = `${world.cells.length} hexes · ${world.regions.length} regions`;
  persist();
}

function newMap(seed) {
  const nextWorld = generateWorld(seed);
  campaignMenu.enter(replaceCampaignMap(activeCampaign, nextWorld, world.name));
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
  if (world) persist();
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
    message.textContent = 'Seed copied';
  } catch {
    message.textContent = 'Could not copy the seed. Select the seed text to copy it.';
  }
});
listen(element('share-map'), 'click', async () => {
  const url = mapLink(window.location.href, { seed: world.seed, variant, colors });
  try {
    await copyText(url);
    message.textContent = 'Map link copied';
  } catch {
    message.textContent = 'Could not share. Copy the URL from the address bar.';
  }
});
element('motion').checked = movement;
listen(element('motion'), 'change', (event) => {
  movement = event.target.checked;
  renderer?.setMotion(movement);
  persist();
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
  // Only cosmetic dressing advances; names, terrain and settlements stay fixed.
  variant++;
  dressing = generateDressing(world, variant);
  if (world.stages.props) renderer?.setMap(prepareMap(world, dressing));
  root.dataset.variant = String(variant);
  persist();
  message.textContent = 'Dressing regenerated';
});
listen(preset, 'change', () => {
  const savedIndex = Number(preset.value.split(':')[1]);
  const palette = palettes[preset.value] ?? savedPalettes[savedIndex]?.colors;
  if (palette) {
    colors = palette.slice();
    currentPaletteName = preset.selectedOptions[0].textContent;
    applyPalette();
  }
});
['ground', 'water', 'elements'].forEach((name, index) =>
  listen(element(name), 'input', (event) => {
    colors[index] = event.target.value;
    currentPaletteName = 'Custom';
    applyPalette();
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
  applyPalette();
  message.textContent = persist()
    ? `Palette “${name}” saved`
    : 'Browser storage is unavailable; this palette is available for this session';
  input.value = '';
});
listen(element('palette-name'), 'input', () => element('palette-name').setCustomValidity(''));

updatePaletteOptions();
applyPalette();
campaignDefaults.paletteName = paletteLabel(campaignDefaults.colors);
campaignMenu = createCampaignMenu({ storage, previous: campaignDefaults, onEnter: openCampaign });
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
    renderer?.dispose();
    campaignMenu.dispose();
  });
