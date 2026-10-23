import { openDialog } from './dialog-focus.js';
import { generateWorld, generateDressing } from '../generation/world.js';
import { prepareMap } from '../generation/presentation.js';
import { createCampaign } from '../application/campaigns.js';

const preferenceNames = ['water', 'elevation', 'forests', 'settlements'];
const preferenceLabels = {
  water: ['Much less water', 'Less water', 'Default', 'More water', 'Much more water'],
  elevation: ['Very gentle', 'Gentle', 'Default', 'Rugged', 'Very rugged'],
  forests: ['Very sparse', 'Sparse', 'Default', 'Dense', 'Very dense'],
  settlements: ['Wilderness', 'Mostly wild', 'Default', 'Settled', 'Densely settled'],
};

export function createCampaignCreator({ library, loadMapView, freshSeed, onCreate }) {
  const dialog = document.getElementById('create-campaign-dialog');
  const discardDialog = document.getElementById('discard-campaign-draft-dialog');
  const el = (name) => dialog.querySelector(`#cc-${name}`);
  const nameInput = el('name');
  const seedInput = el('seed');
  const paletteInput = el('palette');
  const generateButton = el('generate');
  const createButton = el('create');
  const status = el('preview-status');
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  let draft;
  let renderer;
  let revision = 0;

  const preferences = () =>
    Object.fromEntries(preferenceNames.map((name) => [name, Number(el(name).value)]));
  const snapshot = () =>
    JSON.stringify([nameInput.value, seedInput.value, paletteInput.value, preferences()]);
  const seedValid = () => Boolean(seedInput.value.trim()) && seedInput.value.length <= 128;

  function feedback(text, error = false) {
    if (status.textContent !== text) status.textContent = text;
    status.dataset.kind = error ? 'error' : 'status';
  }

  function sync() {
    if (!draft) return;
    const { busy, creating, needsGeneration, world } = draft;
    nameInput.disabled = seedInput.disabled = paletteInput.disabled = busy;
    el('random-seed').disabled = busy;
    for (const name of preferenceNames) el(name).disabled = busy;
    el('reset-preferences').disabled =
      busy || preferenceNames.every((name) => Number(el(name).value) === 0);
    generateButton.disabled = busy || !seedValid() || (!needsGeneration && Boolean(world));
    createButton.disabled =
      busy || needsGeneration || !world || !seedValid() || !nameInput.value.trim();
    generateButton.classList.toggle('cc-primary', needsGeneration);
    createButton.classList.toggle('cc-primary', !needsGeneration);
    el('restore').hidden = !needsGeneration || !world;
    el('restore').disabled = busy;
    generateButton.classList.toggle('hp-working', busy && !creating);
    createButton.classList.toggle('hp-working', creating);
    generateButton.querySelector('span').textContent =
      busy && !creating ? 'Generating…' : 'Generate preview';
    delete generateButton.dataset.tooltip;
    delete createButton.dataset.tooltip;
    if (!busy && !seedValid()) generateButton.dataset.tooltip = 'Enter a seed';
    else if (!busy && !needsGeneration && world)
      generateButton.dataset.tooltip = 'Preview is up to date';
    if (!busy && needsGeneration) createButton.dataset.tooltip = 'Generate preview first';
    else if (!busy && !nameInput.value.trim())
      createButton.dataset.tooltip = 'Enter a campaign name';
    createButton.setAttribute('aria-describedby', 'cc-preview-status');
    createButton.textContent = creating ? 'Creating campaign…' : 'Create campaign';
    for (const [button, working] of [
      [generateButton, busy && !creating],
      [createButton, creating],
    ]) {
      if (working) button.setAttribute('aria-busy', 'true');
      else button.removeAttribute('aria-busy');
    }
    el('dismiss').disabled = el('close').disabled = creating;
    for (const name of ['zoom-in', 'zoom-out', 'expand']) el(name).disabled = busy || !renderer;
    el('title-name').textContent = nameInput.value.trim() || 'New campaign';
  }

  function changedGeneration() {
    draft.needsGeneration =
      !draft.generatedSettings ||
      seedInput.value.trim() !== draft.generatedSettings.seed ||
      preferenceNames.some(
        (name) => Number(el(name).value) !== draft.generatedSettings.preferences[name],
      );
    feedback(draft.needsGeneration ? 'Preview needs updating.' : 'Preview ready.');
    sync();
  }

  function updateSliders() {
    for (const name of preferenceNames) {
      const value = Number(el(name).value);
      el(`${name}-value`).value = preferenceLabels[name][value + 2];
      el(name).setAttribute(
        'aria-valuetext',
        `${value > 0 ? '+' : ''}${value}: ${preferenceLabels[name][value + 2]}`,
      );
    }
  }

  function expand(enabled) {
    dialog.classList.toggle('cc-preview-expanded', enabled);
    el('expand').setAttribute('aria-pressed', String(enabled));
    const label = enabled ? 'Exit expanded preview' : 'Expand map preview';
    el('expand').setAttribute('aria-label', label);
    el('expand').dataset.tooltip = enabled ? 'Exit expanded preview (Esc)' : 'Expand preview';
    el('expand')
      .querySelector('use')
      .setAttribute('href', `/icons/pixelarticons.svg#${enabled ? 'close' : 'scale'}`);
  }

  function releasePreview() {
    renderer?.dispose();
    renderer = undefined;
  }

  function close() {
    revision++;
    expand(false);
    releasePreview();
    discardDialog.close();
    dialog.close();
    draft = undefined;
  }

  function requestClose() {
    if (!draft || draft.creating) return;
    if (snapshot() !== draft.initial) {
      if (!discardDialog.open) openDialog(discardDialog);
    } else close();
  }

  function backdrop(target, dismiss) {
    const outside = (event) => {
      if (event.target !== target) return false;
      const rect = target.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    let pressed = false;
    listen(target, 'pointerdown', (event) => {
      pressed = outside(event);
    });
    listen(target, 'click', (event) => {
      if (pressed && outside(event)) dismiss();
      pressed = false;
    });
  }

  function paintPreview(view, world, layout) {
    const initialView = !renderer;
    renderer ??= view.createMapRenderer(el('scene'), { motion: false });
    if (!renderer) throw new Error('The map preview needs WebGL. Try another browser.');
    renderer.setPalette(library.get(paletteInput.value).colors);
    renderer.setMap(layout, { resetView: initialView });
    if (initialView) renderer.zoom(1.6);
    el('scene')
      .querySelector('canvas')
      .setAttribute(
        'aria-label',
        'Map preview. Drag to pan or use arrow keys to jump two hexes. Scroll or pinch to zoom; + and − also zoom.',
      );
    el('scene').dataset.seed = world.seed;
  }

  async function generate(initial = false) {
    if (!draft || draft.busy) return;
    if (!seedValid()) {
      seedInput.reportValidity();
      return;
    }
    const current = ++revision;
    draft.busy = true;
    feedback('Generating map…');
    sync();
    try {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (current !== revision || !draft) return;
      const view = await loadMapView();
      if (current !== revision || !draft) return;
      const seed = seedInput.value.trim();
      const world = generateWorld(seed, { preferences: preferences() });
      const layout = prepareMap(world, generateDressing(world, 0));
      paintPreview(view, world, layout);
      draft.world = world;
      draft.layout = layout;
      draft.view = view;
      draft.seed = world.seed;
      draft.generatedSettings = { seed: world.seed, preferences: preferences() };
      seedInput.value = world.seed;
      if (!draft.nameEdited) nameInput.value = world.name;
      draft.needsGeneration = false;
      if (initial) draft.initial = snapshot();
      feedback('Preview ready.');
    } catch (error) {
      if (current === revision && draft) {
        draft.needsGeneration = true;
        feedback(`Could not prepare the preview. ${error.message}`, true);
      }
    } finally {
      if (current === revision && draft) {
        draft.busy = false;
        sync();
      }
    }
  }

  listen(el('dismiss'), 'click', requestClose);
  listen(el('close'), 'click', requestClose);
  listen(dialog, 'cancel', (event) => {
    event.preventDefault();
    if (dialog.classList.contains('cc-preview-expanded')) expand(false);
    else requestClose();
  });
  backdrop(dialog, requestClose);
  backdrop(discardDialog, () => discardDialog.close());
  listen(document.getElementById('cc-keep-editing'), 'click', () => discardDialog.close());
  listen(document.getElementById('cc-discard'), 'click', close);
  listen(nameInput, 'input', () => {
    draft.nameEdited = true;
    sync();
  });
  listen(seedInput, 'input', changedGeneration);
  listen(el('random-seed'), 'click', () => {
    draft.seed = freshSeed();
    seedInput.value = draft.seed;
    changedGeneration();
  });
  for (const name of preferenceNames)
    listen(el(name), 'input', () => {
      updateSliders();
      changedGeneration();
    });
  listen(el('reset-preferences'), 'click', () => {
    for (const name of preferenceNames) el(name).value = '0';
    updateSliders();
    changedGeneration();
    feedback('Preferences reset.');
  });
  listen(paletteInput, 'change', () => {
    renderer?.setPalette(library.get(paletteInput.value).colors);
    sync();
  });
  listen(generateButton, 'click', () => generate());
  listen(el('restore'), 'click', () => {
    const settings = draft.generatedSettings;
    draft.seed = seedInput.value = settings.seed;
    for (const name of preferenceNames) el(name).value = String(settings.preferences[name]);
    updateSliders();
    draft.needsGeneration = false;
    feedback('Preview settings restored.');
    sync();
  });
  listen(el('zoom-in'), 'click', () => renderer?.zoom(1.2));
  listen(el('zoom-out'), 'click', () => renderer?.zoom(1 / 1.2));
  listen(el('expand'), 'click', () => expand(!dialog.classList.contains('cc-preview-expanded')));
  listen(dialog, 'keydown', (event) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      discardDialog.open ||
      event.target.closest('input, select, textarea') ||
      draft?.busy
    )
      return;
    const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[
      event.key
    ];
    if (pan) {
      event.preventDefault();
      if (!event.repeat) renderer?.pan(...pan);
      return;
    }
    const factor = event.key === '+' || event.key === '=' ? 1.2 : event.key === '-' ? 1 / 1.2 : 0;
    if (factor) {
      event.preventDefault();
      renderer?.zoom(factor);
    }
  });
  listen(createButton, 'click', async () => {
    if (!draft || createButton.disabled) return;
    const palette = library.get(paletteInput.value);
    const campaign = createCampaign(draft.world, palette.colors, palette.name);
    campaign.name = nameInput.value.trim();
    campaign.nameEdited = draft.nameEdited;
    draft.busy = draft.creating = true;
    sync();
    releasePreview();
    expand(false);
    dialog.close();
    try {
      await onCreate(campaign);
      if (listeners.signal.aborted) return;
      close();
    } catch (error) {
      if (!draft || listeners.signal.aborted) return;
      openDialog(dialog);
      paintPreview(draft.view, draft.world, draft.layout);
      feedback(`Could not open the campaign. ${error.message}`, true);
    } finally {
      if (draft) {
        draft.busy = draft.creating = false;
        sync();
      }
    }
  });

  return {
    open() {
      if (dialog.open || draft?.creating || listeners.signal.aborted) return;
      seedInput.value = freshSeed();
      nameInput.value = 'New campaign';
      paletteInput.replaceChildren(
        ...library.all().map((palette) => {
          const option = document.createElement('option');
          option.value = palette.id;
          option.textContent = palette.name;
          return option;
        }),
      );
      paletteInput.value = library.default().id;
      for (const name of preferenceNames) el(name).value = '0';
      updateSliders();
      draft = {
        seed: seedInput.value,
        nameEdited: false,
        needsGeneration: false,
        busy: false,
        creating: false,
        initial: snapshot(),
      };
      expand(false);
      sync();
      openDialog(dialog);
      void generate(true);
    },
    dispose() {
      listeners.abort();
      close();
    },
  };
}
