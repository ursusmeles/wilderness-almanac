import { TERRAIN_TYPES } from '../generation/terrain-types.js';
import { POI_TYPES, SETTLEMENT_TYPES, variantsFor } from '../generation/hex-edits.js';
import { cloneTemplate } from './templates.js';

const KEEP = '__keep__';
const title = (value) => (value ? value[0].toUpperCase() + value.slice(1) : 'None');
const fields = ['terrain', 'settlement', 'poi', 'elevation', 'crossing', 'visited'];

export function createBatchInspector(
  host,
  { onApply, onJoin, onUndo, onResetSelected, onSelectAll, onClear, onTurnOff },
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
    terrain: TERRAIN_TYPES,
    settlement: ['', ...SETTLEMENT_TYPES],
    poi: ['', ...POI_TYPES],
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
  const unsaved = cloneTemplate('unsaved-batch-dialog-template').firstElementChild;
  const resetDialog = cloneTemplate('reset-selected-dialog-template').firstElementChild;
  host.closest('#campaign-workspace').append(unsaved, resetDialog);
  let state, pending;
  const dirty = () => fields.some((field) => el(field).value !== KEEP);

  function constraints() {
    const terrain = el('terrain').value;
    const water = ['river', 'open water'].includes(terrain);
    for (const [field, disabled] of Object.entries({
      elevation: water || terrain === 'mountains',
      settlement: water,
      poi: terrain === 'open water',
      crossing: terrain !== KEEP && terrain !== 'river',
    })) {
      el(field).disabled = disabled;
      if (disabled) el(field).value = KEEP;
    }
    el('subtype').disabled = el('poi').value === KEEP || !el('poi').value;
    el('note').textContent =
      terrain === 'open water'
        ? 'This removes settlements, points of interest and crossings.'
        : terrain === 'river'
          ? 'This removes settlements. Points of interest and crossings need usable banks.'
          : '';
    el('note').hidden = !el('note').textContent;
    el('apply').textContent =
      `Apply to ${state?.cells.length ?? 0} ${(state?.cells.length ?? 0) === 1 ? 'hex' : 'hexes'}`;
    el('apply').disabled = !state?.cells.length || !dirty();
    el('cancel').disabled = !dirty();
  }
  function reset() {
    for (const field of fields) el(field).value = KEEP;
    el('subtype').replaceChildren();
    el('feedback').textContent = '';
    constraints();
  }
  function patch() {
    const result = {};
    for (const field of fields) {
      const value = el(field).value;
      if (value === KEEP) continue;
      result[field] =
        field === 'poi'
          ? value
            ? {
                kind: value,
                variant: variantsFor(value).find(
                  (variant) => String(variant) === el('subtype').value,
                ),
              }
            : null
          : field === 'elevation'
            ? Number(value)
            : field === 'visited'
              ? value === 'true'
              : ['settlement', 'crossing'].includes(field)
                ? value || null
                : value;
    }
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
    if (!unsaved.open) unsaved.showModal();
    return false;
  }
  const guarded = (action) => {
    if (beforeLeave(action)) action();
  };
  listen(el('fields'), 'change', (event) => {
    el('feedback').textContent = '';
    if (event.target === el('poi')) {
      const kind = el('poi').value;
      el('subtype').replaceChildren(
        ...(kind && kind !== KEEP ? variantsFor(kind) : []).map((value) =>
          option(value, typeof value === 'number' ? `Variation ${value + 1}` : title(value)),
        ),
      );
    }
    constraints();
  });
  listen(el('form'), 'submit', (event) => {
    event.preventDefault();
    apply();
  });
  listen(el('cancel'), 'click', reset);
  listen(el('undo'), 'click', () => guarded(() => onUndo(el('undo'))));
  listen(el('reset'), 'click', () => {
    const count = state?.cells.length ?? 0;
    if (!count) return;
    resetDialog.querySelector('[data-reset-count]').textContent =
      `Restore ${count === 1 ? 'this hex' : `these ${count} hexes`} to the seed’s generated defaults? This clears their edits, visited status and dressing locks. You can undo this.`;
    resetDialog.showModal();
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
      return;
    }
    unsaved.close();
    if (action !== 'keep') {
      reset();
      next?.();
    }
  });
  return {
    update(next) {
      state = next;
      el('count').textContent =
        `${next.cells.length} ${next.cells.length === 1 ? 'hex' : 'hexes'} selected`;
      el('fields').disabled = !next.cells.length;
      el('clear').disabled = !next.cells.length;
      el('undo').disabled = !next.canUndo;
      el('reset').disabled = !next.cells.length;
      el('join').hidden = next.fogOfWar || !next.join;
      el('reset').hidden = Boolean(next.fogOfWar);
      for (const label of el('fields').querySelectorAll('label'))
        label.hidden = Boolean(next.fogOfWar) && !label.contains(el('visited'));
      el('join').disabled = next.join?.joined ?? false;
      el('join').textContent = next.join?.type === 'city' ? 'Join city' : 'Join town';
      for (const field of fields) {
        const values = next.cells.map((cell) =>
          field === 'settlement'
            ? (cell.pointOfLight?.type ?? '')
            : field === 'poi'
              ? (cell.pointsOfInterest[0]?.kind ?? '')
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
            : title(values[0] ?? '');
        el(field).options[0].textContent =
          unique.size > 1 ? 'Keep mixed values' : unique.size ? `Keep · ${current}` : 'Keep';
      }
      constraints();
    },
    beforeLeave,
    error(message) {
      el('feedback').textContent = message;
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
}
