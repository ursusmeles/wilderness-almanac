import { TERRAIN_TYPES } from '../generation/terrain-types.js';
import { POI_TYPES, SETTLEMENT_TYPES, variantsFor } from '../generation/hex-edits.js';
import { inspectDistances } from '../generation/campaign-world.js';
import { describeHex } from './map-link.js';
import { cloneTemplate } from './templates.js';
import { hexAddress } from '../generation/hex.js';

const title = (text) => (text ? text[0].toUpperCase() + text.slice(1) : 'None');
export function createHexInspector(
  host,
  { onApply, onVisit, onLock, onRegenerate, onReset, onUndo, onSetIcon, visible, preview },
) {
  const listeners = new AbortController();
  const listen = (target, event, handler) =>
    target.addEventListener(event, handler, { signal: listeners.signal });
  host.replaceChildren(cloneTemplate('hex-inspector-template'));
  const el = (name) => host.querySelector(`#hp-hex-${name}`);
  const options = (control, values, none = false) => {
    control.replaceChildren(
      ...(none ? [''] : []).concat(values).map((value) => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = typeof value === 'number' ? `Variation ${value + 1}` : title(value);
        return option;
      }),
    );
  };
  options(el('terrain'), TERRAIN_TYPES);
  options(el('settlement'), SETTLEMENT_TYPES, true);
  options(el('poi'), POI_TYPES, true);
  let state,
    editing = false,
    dirty = false,
    pending,
    frame,
    previewTile,
    previewColors;
  const unsaved = cloneTemplate('unsaved-hex-dialog-template').firstElementChild;
  host.closest('#campaign-workspace').append(unsaved);

  function constraints() {
    const terrain = el('terrain').value;
    const water = ['river', 'open water'].includes(terrain),
      mountain = terrain === 'mountains';
    if (water || mountain) el('elevation').value = water ? '0' : '4';
    else if (el('elevation').value === '4') el('elevation').value = '3';
    el('elevation').disabled = water || mountain;
    el('elevation').querySelector('[value="4"]').disabled = !mountain;
    el('settlement').disabled = water;
    el('poi').disabled = terrain === 'open water';
    el('subtype').disabled = terrain === 'open water' || !el('poi').value;
    el('crossing').disabled = terrain !== 'river';
    el('constraint').textContent =
      terrain === 'open water'
        ? 'This removes settlements, points of interest and crossings.'
        : terrain === 'river'
          ? 'This removes settlements. Points of interest and crossings need usable banks.'
          : mountain
            ? 'Mountain elevation is fixed at 4.'
            : '';
    el('constraint').hidden = !editing || !el('constraint').textContent;
  }
  function subtype(value) {
    options(el('subtype'), el('poi').value ? variantsFor(el('poi').value) : []);
    if (value !== undefined) el('subtype').value = String(value);
  }
  function fill() {
    const cell = state.cell,
      poi = cell.pointsOfInterest[0];
    el('terrain').value = cell.terrain;
    el('settlement').value = cell.pointOfLight?.type ?? '';
    el('poi').value = poi?.kind ?? '';
    subtype(poi?.variant);
    el('elevation').value = String(cell.elevation);
    el('crossing').value = cell.crossing?.kind ?? '';
    constraints();
  }
  function setEditing(enabled) {
    editing = enabled;
    dirty = false;
    el('fields').disabled = !enabled;
    el('form').classList.toggle('is-editing', enabled);
    el('constraint').hidden = !enabled;
    el('edit').hidden = enabled;
    el('apply').hidden = el('cancel').hidden = !enabled;
    for (const name of ['visited', 'lock', 'regenerate', 'reset', 'undo', 'icon'])
      el(name).disabled =
        enabled ||
        (name === 'undo' && !state?.canUndo) ||
        (name === 'regenerate' && state?.locked) ||
        (name === 'icon' && state?.isIcon);
    el('feedback').textContent = '';
    if (state) fill();
  }
  function patch() {
    const terrain = el('terrain').value,
      water = ['river', 'open water'].includes(terrain);
    const kind = el('poi').value,
      variants = variantsFor(kind);
    return {
      terrain,
      elevation: water ? 0 : terrain === 'mountains' ? 4 : Number(el('elevation').value),
      settlement: water ? null : el('settlement').value || null,
      poi:
        terrain === 'open water' || !kind
          ? null
          : { kind, variant: variants.find((value) => String(value) === el('subtype').value) },
      crossing: terrain === 'river' ? el('crossing').value || null : null,
    };
  }
  async function apply(button = el('apply')) {
    if ((await onApply(patch(), button)) === false) return false;
    setEditing(false);
    return true;
  }
  listen(el('edit'), 'click', () => {
    setEditing(true);
    el('terrain').focus({ preventScroll: true });
  });
  listen(el('cancel'), 'click', () => setEditing(false));
  listen(el('form'), 'submit', (event) => {
    event.preventDefault();
    apply();
  });
  listen(el('fields'), 'change', (event) => {
    dirty = true;
    el('feedback').textContent = '';
    if (event.target === el('poi')) subtype();
    constraints();
  });
  listen(el('visited'), 'click', onVisit);
  listen(el('lock'), 'click', onLock);
  listen(el('regenerate'), 'click', onRegenerate);
  listen(el('reset'), 'click', onReset);
  listen(el('undo'), 'click', onUndo);
  listen(el('icon'), 'click', onSetIcon);
  listen(unsaved, 'click', async (event) => {
    const action = event.target.closest('[data-unsaved]')?.dataset.unsaved;
    if (!action) return;
    if (action === 'apply' && !(await apply(event.target.closest('button')))) {
      unsaved.close();
      pending = null;
      el('apply').focus({ preventScroll: true });
      return;
    }
    unsaved.close();
    if (action !== 'keep') {
      setEditing(false);
      const next = pending;
      pending = null;
      next?.();
    }
  });
  function refreshPreview() {
    cancelAnimationFrame(frame);
    if (!state || !visible()) return;
    if (previewTile === state.tile && previewColors === state.colors.join(',')) return;
    frame = requestAnimationFrame(() => {
      if (!visible()) return;
      const src = preview(state.tile, state.colors);
      previewTile = state.tile;
      previewColors = state.colors.join(',');
      el('preview').hidden = !src;
      if (src) el('preview').src = src;
      el('preview').alt = `Isometric view of ${el('name').textContent}`;
    });
  }
  function beforeLeave(action) {
    if (dirty) {
      pending = action;
      if (!unsaved.open) unsaved.showModal();
      return false;
    }
    setEditing(false);
    return true;
  }
  return {
    update(next) {
      const same = state?.cell.key === next.cell.key;
      state = next;
      el('name').textContent = describeHex({ ...next.cell, forest: next.dressed?.forest })
        .split(' · ')
        .slice(2)
        .join(' · ');
      el('address').textContent = hexAddress(next.cell);
      host.dataset.hexKey = next.cell.key;
      const distances = inspectDistances(next.world, next.cell);
      for (const [name, value] of Object.entries(distances))
        el(`distance-${name}`).textContent =
          value === null ? 'None on map' : `${value} ${value === 1 ? 'hex' : 'hexes'}`;
      el('visited').setAttribute('aria-checked', String(next.visited));
      el('visited').title = next.visited ? 'Mark as not visited' : 'Mark as visited';
      el('lock-state').textContent = next.locked ? 'Unlock hex' : 'Lock hex';
      el('lock').setAttribute('aria-checked', String(next.locked));
      el('lock').title = next.locked
        ? 'Unlock this hex’s dressing'
        : 'Keep this hex’s dressing during map regeneration';
      el('regenerate').title = next.locked
        ? 'Unlock dressing to regenerate this hex'
        : 'Regenerate only this hex’s dressing';
      if (!editing || !same) setEditing(false);
      refreshPreview();
    },
    beforeLeave,
    beforeSelection(key, select) {
      return state?.cell.key === key || beforeLeave(select);
    },
    error: (message) => {
      el('feedback').textContent = message;
    },
    refreshPreview,
    reset() {
      if (unsaved.open) unsaved.close();
      pending = null;
      setEditing(false);
    },
    dispose() {
      listeners.abort();
      cancelAnimationFrame(frame);
      unsaved.remove();
    },
  };
}
