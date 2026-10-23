import { openDialog } from './dialog-focus.js';
import { TERRAIN_TYPES } from '../generation/terrain-types.js';
import { POI_TYPES, SETTLEMENT_TYPES, variantsFor } from '../generation/hex-edits.js';
import { inspectDistances } from '../generation/campaign-world.js';
import { describeHex } from './map-link.js';
import { cloneTemplate } from './templates.js';
import { hexAddress } from '../generation/hex.js';
import { explainDisabled } from './control-help.js';

const title = (text) => (text ? text[0].toUpperCase() + text.slice(1) : 'None');
export function createHexInspector(
  host,
  {
    onApply,
    onVisit,
    onLock,
    onRegenerate,
    onReset,
    onUndo,
    onSetIcon,
    onMultiEdit,
    onNotify = () => {},
    visible,
    preview,
  },
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
    explainDisabled(
      el('elevation'),
      water ? 'Water elevation is fixed' : mountain ? 'Mountain elevation is fixed' : '',
    );
    el('elevation').querySelector('[value="4"]').disabled = !mountain;
    explainDisabled(el('settlement'), water ? 'Land hexes only' : '');
    explainDisabled(el('poi'), terrain === 'open water' ? 'Land or river hexes only' : '');
    explainDisabled(
      el('subtype'),
      terrain === 'open water'
        ? 'Land or river hexes only'
        : !el('poi').value
          ? 'Choose a point of interest first'
          : '',
    );
    explainDisabled(el('crossing'), terrain !== 'river' ? 'River hexes only' : '');
    el('constraint').textContent =
      terrain === 'open water'
        ? 'This removes settlements, points of interest and crossings.'
        : terrain === 'river'
          ? 'This removes settlements. Points of interest and crossings need usable banks.'
          : mountain
            ? 'Mountain elevation is fixed at 4.'
            : '';
    el('constraint').hidden = !editing || !el('constraint').textContent;
    for (const field of ['terrain', 'elevation', 'settlement', 'poi', 'subtype', 'crossing'])
      el(field).setAttribute('aria-describedby', 'hp-hex-constraint');
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
    enabled = enabled && !state?.fogOfWar;
    editing = enabled;
    dirty = false;
    el('fields').disabled = !enabled;
    el('form').classList.toggle('is-editing', enabled);
    el('constraint').hidden = !enabled;
    el('edit').hidden = enabled;
    el('apply').hidden = el('cancel').hidden = !enabled;
    for (const name of ['visited', 'lock', 'reset']) el(name).disabled = enabled;
    el('feedback').textContent = '';
    for (const input of el('fields').querySelectorAll('select'))
      input.removeAttribute('aria-invalid');
    syncActionAvailability();
    if (state) fill();
  }
  function syncActionAvailability() {
    explainDisabled(
      el('undo'),
      editing
        ? 'Finish editing first'
        : state?.undoReason || (!state?.canUndo ? 'Nothing to undo' : ''),
      `Undo ${state?.undoLabel || 'last action'}`,
    );
    el('undo').setAttribute('aria-label', `Undo ${state?.undoLabel || 'last action'}`);
    explainDisabled(
      el('regenerate'),
      editing ? 'Finish editing first' : state?.locked ? 'Unlock appearance first' : '',
      'Change props and decorations placement in this hex',
    );
    explainDisabled(
      el('icon'),
      editing ? 'Finish editing first' : state?.isIcon ? 'Already the campaign icon' : '',
    );
    el('visited').dataset.tooltip = editing
      ? 'Finish editing first'
      : state?.visited
        ? 'Mark as unvisited'
        : 'Mark as visited';
    el('lock').dataset.tooltip = editing
      ? 'Finish editing first'
      : state?.locked
        ? 'Unlock appearance'
        : 'Keep appearance when regenerating';
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
    el('edit').focus({ preventScroll: true });
    return true;
  }
  listen(el('edit'), 'click', () => {
    setEditing(true);
    el('terrain').focus({ preventScroll: true });
  });
  listen(el('cancel'), 'click', () => {
    const discarded = dirty;
    setEditing(false);
    el('edit').focus({ preventScroll: true });
    if (discarded) onNotify('Hex draft discarded.');
  });
  listen(el('form'), 'submit', (event) => {
    event.preventDefault();
    apply();
  });
  listen(el('fields'), 'change', (event) => {
    dirty = true;
    el('feedback').textContent = '';
    el('fields')
      .querySelectorAll('select')
      .forEach((control) => control.removeAttribute('aria-invalid'));
    if (event.target === el('poi')) subtype();
    constraints();
  });
  listen(el('visited'), 'click', onVisit);
  listen(el('lock'), 'click', onLock);
  listen(el('regenerate'), 'click', onRegenerate);
  listen(el('reset'), 'click', onReset);
  listen(el('undo'), 'click', onUndo);
  listen(el('icon'), 'click', onSetIcon);
  listen(el('multi-edit'), 'click', onMultiEdit);
  listen(unsaved, 'click', async (event) => {
    const action = event.target.closest('[data-unsaved]')?.dataset.unsaved;
    if (!action) return;
    if (action === 'apply' && !(await apply(event.target.closest('button')))) {
      unsaved.close();
      pending = null;
      focusError();
      return;
    }
    unsaved.close();
    if (action !== 'keep') {
      setEditing(false);
      const next = pending;
      pending = null;
      next?.();
    } else el('terrain').focus({ preventScroll: true });
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
      if (!unsaved.open) openDialog(unsaved);
      return false;
    }
    setEditing(false);
    return true;
  }
  return {
    update(next) {
      const same = state?.cell.key === next.cell.key;
      if (next.fogOfWar && state?.tile !== next.tile) {
        cancelAnimationFrame(frame);
        el('preview').removeAttribute('src');
        el('preview').hidden = true;
        previewTile = null;
      }
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
          value === null
            ? next.fogOfWar
              ? 'None discovered'
              : 'None on map'
            : `${value} ${value === 1 ? 'hex' : 'hexes'}`;
      el('visited').setAttribute('aria-checked', String(next.visited));
      el('lock-state').textContent = `Lock appearance ${next.locked ? 'ON' : 'OFF'}`;
      el('lock').setAttribute('aria-checked', String(next.locked));
      if (!editing || !same) setEditing(false);
      const unknown = next.cell.fogState === 'undiscovered';
      host.querySelector('.hp-hex-distances').hidden = unknown;
      el('fields').hidden = unknown;
      for (const name of ['edit', 'lock', 'regenerate', 'reset', 'icon'])
        el(name).hidden = Boolean(next.fogOfWar) || (name === 'edit' && editing);
      syncActionAvailability();
      refreshPreview();
    },
    beforeLeave,
    beforeSelection(key, select) {
      return state?.cell.key === key || beforeLeave(select);
    },
    error: (message) => {
      el('feedback').textContent = message;
      // Constraint errors identify a field when possible; otherwise focus the alert.
      const field = /crossing|banks/i.test(message)
        ? 'crossing'
        : /elevation/i.test(message)
          ? 'elevation'
          : /settlement/i.test(message)
            ? 'settlement'
            : /point of interest/i.test(message)
              ? 'poi'
              : null;
      if (field && !el(field).disabled) {
        el(field).setAttribute('aria-invalid', 'true');
        el(field).setAttribute('aria-describedby', 'hp-hex-constraint hp-hex-feedback');
      }
      if (!unsaved.open) focusError();
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
  function focusError() {
    (el('fields').querySelector('[aria-invalid="true"]:not(:disabled)') || el('feedback')).focus({
      preventScroll: true,
    });
  }
}
