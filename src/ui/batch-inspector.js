import { openDialog } from './dialog-focus.js';
import { TERRAIN_OPTIONS, terrainValue, terrainPatch } from './terrain-options.js';
import { SETTLEMENT_TYPES } from '../generation/hex-edits.js';
import { cloneTemplate } from './templates.js';
import { explainDisabled } from './control-help.js';
import { POI_OPTIONS, poiValue, poiLabel, poiFromValue } from './poi-options.js';

const KEEP = '__keep__';
const title = (value) => (value ? value[0].toUpperCase() + value.slice(1) : 'None');
const fields = ['terrain', 'settlement', 'poi', 'elevation', 'crossing', 'visited'];

export function createBatchInspector(
  host,
  {
    onApply,
    onJoin,
    onUndo,
    onResetSelected,
    onSelectAll,
    onClear,
    onTurnOff,
    onNotify = () => {},
  },
) {
  host.replaceChildren(cloneTemplate('batch-inspector-template'));
  const el = (name) => host.querySelector(`#hp-batch-${name}`);
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  const option = (value, label) => {
    const node = document.createElement('option');
    node.value = String(value);
    node.textContent = label;
    return node;
  };
  for (const [field, values] of Object.entries({
    terrain: TERRAIN_OPTIONS,
    settlement: ['', ...SETTLEMENT_TYPES],
    elevation: [0, 1, 2, 3],
    crossing: ['', 'bridge', 'ferry'],
    visited: ['true', 'false'],
  })) {
    el(field).replaceChildren(
      option(KEEP, 'Keep'),
      ...values.map((value) =>
        option(
          value,
          field === 'visited'
            ? value === 'true'
              ? 'Visited'
              : 'Not visited'
            : title(String(value)),
        ),
      ),
    );
  }
  el('poi').replaceChildren(
    option(KEEP, 'Keep'),
    ...POI_OPTIONS.map(({ value, label }) => option(value, label)),
  );
  const unsaved = cloneTemplate('unsaved-batch-dialog-template').firstElementChild;
  const resetDialog = cloneTemplate('reset-selected-dialog-template').firstElementChild;
  host.closest('#campaign-workspace').append(unsaved, resetDialog);
  let state, pending;
  const dirty = () => fields.some((field) => el(field).value !== KEEP);

  function constraints() {
    const terrain = el('terrain').value;
    const water = ['river', 'open water'].includes(terrain);
    for (const [field, reason] of Object.entries({
      elevation: water
        ? 'Water elevation is fixed'
        : terrain === 'mountains'
          ? 'Mountain elevation is fixed'
          : '',
      settlement: water ? 'Land hexes only' : '',
      poi: terrain === 'open water' ? 'Land or river hexes only' : '',
      crossing: terrain !== KEEP && terrain !== 'river' ? 'River hexes only' : '',
    })) {
      explainDisabled(el(field), reason);
      if (reason) el(field).value = KEEP;
    }
    el('note').textContent =
      terrain === 'open water'
        ? 'This removes settlements, points of interest and crossings.'
        : terrain === 'river'
          ? 'This removes settlements. Points of interest and crossings need usable banks.'
          : '';
    el('note').hidden = !el('note').textContent;
    el('apply').textContent =
      `Apply to ${state?.cells.length ?? 0} ${(state?.cells.length ?? 0) === 1 ? 'hex' : 'hexes'}`;
    explainDisabled(
      el('apply'),
      !state?.cells.length ? 'Select a hex first' : !dirty() ? 'Choose changes to apply' : '',
    );
    explainDisabled(el('cancel'), !dirty() ? 'No changes to discard' : '');
  }
  function reset() {
    for (const field of fields) el(field).value = KEEP;
    el('feedback').textContent = '';
    el('fields')
      .querySelectorAll('select')
      .forEach((control) => control.removeAttribute('aria-invalid'));
    constraints();
  }
  function patch() {
    const result = {};
    for (const field of fields) {
      const value = el(field).value;
      if (value === KEEP) continue;
      result[field] =
        field === 'poi'
          ? poiFromValue(value)
          : field === 'elevation'
            ? Number(value)
            : field === 'visited'
              ? value === 'true'
              : ['settlement', 'crossing'].includes(field)
                ? value || null
                : value;
    }
    if (result.terrain !== undefined) Object.assign(result, terrainPatch(result.terrain));
    return result;
  }
  async function apply(button = el('apply')) {
    if ((await onApply(patch(), button)) === false) return false;
    reset();
    return true;
  }
  function beforeLeave(action) {
    if (!dirty()) return true;
    pending = action;
    if (!unsaved.open) openDialog(unsaved);
    return false;
  }
  const guarded = (action) => {
    if (beforeLeave(action)) action();
  };
  listen(el('fields'), 'change', (event) => {
    el('feedback').textContent = '';
    event.target.removeAttribute('aria-invalid');
    constraints();
  });
  listen(el('form'), 'submit', (event) => {
    event.preventDefault();
    apply();
  });
  listen(el('cancel'), 'click', () => {
    reset();
    el('count').focus({ preventScroll: true });
    onNotify('Batch draft discarded.');
  });
  listen(el('undo'), 'click', () => guarded(() => onUndo(el('undo'))));
  listen(el('reset'), 'click', () => {
    const count = state?.cells.length ?? 0;
    if (!count) return;
    resetDialog.querySelector('[data-reset-count]').textContent =
      `Restore ${count === 1 ? 'this hex' : `these ${count} hexes`} to the seed’s generated defaults? This clears their edits, visited status and appearance locks.${dirty() ? ' Pending batch changes will also be discarded.' : ''} You can undo the saved changes.`;
    resetDialog.querySelector('[data-reset-selected="confirm"]').textContent =
      `Reset ${count} ${count === 1 ? 'hex' : 'hexes'}`;
    openDialog(resetDialog);
  });
  listen(resetDialog, 'click', async (event) => {
    const button = event.target.closest('[data-reset-selected]');
    if (!button) return;
    if (button.dataset.resetSelected === 'cancel') {
      resetDialog.close();
      return;
    }
    if ((await onResetSelected(button)) === false) {
      resetDialog.close();
      focusError();
      return;
    }
    reset();
    resetDialog.close();
  });
  listen(el('join'), 'click', () => guarded(() => onJoin(el('join'))));
  listen(el('all'), 'click', () => guarded(() => onSelectAll(el('all'))));
  listen(el('off'), 'click', onTurnOff);
  listen(el('clear'), 'click', () => guarded(() => onClear(el('clear'))));
  listen(unsaved, 'click', async (event) => {
    const action = event.target.closest('[data-unsaved]')?.dataset.unsaved;
    if (!action) return;
    const next = pending;
    pending = null;
    if (action === 'apply' && !(await apply(event.target.closest('button')))) {
      unsaved.close();
      focusError();
      return;
    }
    unsaved.close();
    if (action !== 'keep') {
      reset();
      next?.();
    } else el('count').focus({ preventScroll: true });
  });
  return {
    update(next) {
      state = next;
      el('count').textContent =
        `${next.cells.length} ${next.cells.length === 1 ? 'hex' : 'hexes'} selected`;
      el('fields').disabled = !next.cells.length;
      el('clear').disabled = !next.cells.length;
      explainDisabled(el('undo'), next.undoReason || '', `Undo ${next.undoLabel || 'last action'}`);
      el('undo').setAttribute('aria-label', `Undo ${next.undoLabel || 'last action'}`);
      el('reset').disabled = !next.cells.length;
      el('join').hidden = next.fogOfWar || !next.join;
      el('reset').hidden = Boolean(next.fogOfWar);
      for (const label of el('fields').querySelectorAll('label'))
        label.hidden = Boolean(next.fogOfWar) && !label.contains(el('visited'));
      el('join').disabled = next.join?.joined ?? false;
      el('join').textContent = next.join?.joined
        ? 'Already one settlement'
        : next.join?.type === 'city'
          ? 'Join city'
          : 'Join town';
      el('join').dataset.tooltip = next.join?.joined
        ? 'Already one settlement'
        : 'Combine into one settlement';
      const dressed = new Map((next.dressing ?? []).map((cell) => [cell.key, cell]));
      for (const field of fields) {
        const values = next.cells.map((cell) =>
          field === 'terrain'
            ? terrainValue(cell, dressed.get(cell.key)?.props, next.edits?.[cell.key]?.cropStyle)
            : field === 'settlement'
              ? (cell.pointOfLight?.type ?? '')
              : field === 'poi'
                ? poiValue(cell.pointsOfInterest[0])
                : field === 'crossing'
                  ? (cell.crossing?.kind ?? '')
                  : field === 'visited'
                    ? String(next.edits?.[cell.key]?.visited ?? false)
                    : String(cell[field]),
        );
        const unique = new Set(values);
        const current =
          field === 'visited'
            ? values[0] === 'true'
              ? 'Visited'
              : 'Not visited'
            : field === 'poi'
              ? poiLabel(next.cells[0]?.pointsOfInterest[0])
              : title(values[0] ?? '');
        el(field).options[0].textContent =
          unique.size > 1 ? 'Keep mixed values' : unique.size ? `Keep · ${current}` : 'Keep';
      }
      constraints();
    },
    beforeLeave,
    error(message) {
      el('feedback').textContent = message;
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
        el(field).setAttribute('aria-describedby', 'hp-batch-note hp-batch-feedback');
      }
      if (!unsaved.open && !resetDialog.open) focusError();
    },
    reset() {
      unsaved.close();
      resetDialog.close();
      pending = null;
      reset();
    },
    dispose() {
      listeners.abort();
      unsaved.remove();
      resetDialog.remove();
    },
  };
  function focusError() {
    (el('fields').querySelector('[aria-invalid="true"]:not(:disabled)') || el('feedback')).focus({
      preventScroll: true,
    });
  }
}
