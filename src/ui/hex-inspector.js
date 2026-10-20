import { TERRAIN_TYPES } from '../generation/terrain-types.js';
import { POI_TYPES, SETTLEMENT_TYPES, variantsFor } from '../generation/hex-edits.js';
import { inspectDistances } from '../generation/campaign-world.js';
import { describeHex } from './map-link.js';
import { icon } from './panels.js';
import { tilePreview } from './tile-preview.js';

const title = (text) => (text ? text[0].toUpperCase() + text.slice(1) : 'None');
export function createHexInspector(
  host,
  { onApply, onVisit, onLock, onRegenerate, onReset, onUndo, visible },
) {
  const listeners = new AbortController();
  const listen = (target, event, handler) =>
    target.addEventListener(event, handler, { signal: listeners.signal });
  host.innerHTML = `<div class="hp-inspector-overview"><button type="button" id="hp-hex-visited" class="hp-motion hp-hex-visited" role="switch" aria-label="Visited"><span class="hp-motion-light" aria-hidden="true"></span><span id="hp-hex-visited-state">Not yet visited</span></button><div class="hp-hex-preview-frame"><img id="hp-hex-preview" width="240" height="240" alt="" /></div><div class="hp-inspector-heading"><span class="hp-eyebrow">Selected hex</span><h3 id="hp-hex-name"></h3><span id="hp-hex-address" class="hp-pixel"></span>
    <dl class="hp-hex-distances" aria-label="Distances in hex steps"><div><dt>Nearest settlement</dt><dd id="hp-hex-distance-settlement"></dd></div><div><dt>Nearest river</dt><dd id="hp-hex-distance-river"></dd></div><div><dt>Nearest open water</dt><dd id="hp-hex-distance-water"></dd></div></dl></div></div>
    <div class="hp-inspector-content"><form id="hp-hex-form"><fieldset id="hp-hex-fields" disabled><div class="hp-hex-fields">
    <label>Terrain<select id="hp-hex-terrain"></select></label><label>Settlement<select id="hp-hex-settlement"></select></label>
    <label>Point of interest<select id="hp-hex-poi"></select></label><label id="hp-hex-subtype-label">POI variant<select id="hp-hex-subtype"></select></label>
    <label>Elevation<select id="hp-hex-elevation"><option value="0">0 · Lowland</option><option value="1">1 · Low rise</option><option value="2">2 · Upland</option><option value="3">3 · Highland</option><option value="4">4 · Mountains</option></select></label><label>Crossing<select id="hp-hex-crossing"><option value="">None</option><option value="bridge">Bridge</option><option value="ferry">Ferry</option></select></label>
    </div><p id="hp-hex-constraint" class="hp-field-note" hidden></p></fieldset>
    <output id="hp-hex-feedback" class="hp-hex-feedback" role="alert"></output>
    <div class="hp-inspector-action-cluster"><div class="hp-inspector-edit-actions"><button type="button" id="hp-hex-edit">${icon('pencil')}Edit hex</button><button type="submit" id="hp-hex-apply" hidden>Apply changes</button><button type="button" id="hp-hex-cancel" hidden>Cancel</button><button type="button" id="hp-hex-undo">${icon('undo')}Undo</button><button type="button" id="hp-hex-reset">Reset hex</button></div>
    <div class="hp-inspector-actions"><button type="button" id="hp-hex-regenerate">${icon('refresh')}Regenerate hex</button><button type="button" id="hp-hex-lock" role="switch" aria-label="Lock hex dressing">${icon('lock')}<span id="hp-hex-lock-state"></span></button></div></div></form></div>`;
  const el = (name) => host.querySelector(`#hp-hex-${name}`);
  for (const [name, label] of Object.entries({
    terrain: 'Terrain',
    settlement: 'Settlement',
    poi: 'Point of interest',
    subtype: 'POI variant',
    elevation: 'Elevation',
    crossing: 'Crossing',
  }))
    el(name).setAttribute('aria-label', label);
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
  const unsaved = document.createElement('dialog');
  unsaved.className = 'hp-inspector-dialog';
  unsaved.setAttribute('aria-labelledby', 'hp-unsaved-title');
  unsaved.innerHTML = `<h2 id="hp-unsaved-title">Unapplied hex changes</h2><p>Apply or discard your changes before inspecting another hex.</p><div class="hp-tools"><button type="button" data-unsaved="keep">Keep editing</button><button type="button" data-unsaved="discard">Discard</button><button type="button" data-unsaved="apply">Apply changes</button></div>`;
  host.closest('#hex-smooth-riverlands').append(unsaved);

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
        ? 'Open water uses elevation 0 and cannot contain settlements or POIs. Applying removes existing features.'
        : terrain === 'river'
          ? 'River elevation is fixed at 0. POIs need a dry bank; crossings need two usable banks.'
          : mountain
            ? 'Mountain elevation is fixed at 4. Connected slopes and ridges update together.'
            : 'Land elevation can be 0–3. Changes may update connected forests and neighbouring surfaces.';
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
    for (const name of ['visited', 'lock', 'regenerate', 'reset', 'undo'])
      el(name).disabled =
        enabled || (name === 'undo' && !state?.canUndo) || (name === 'regenerate' && state?.locked);
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
  function apply() {
    if (onApply(patch()) === false) return false;
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
  listen(unsaved, 'click', (event) => {
    const action = event.target.closest('[data-unsaved]')?.dataset.unsaved;
    if (!action) return;
    if (action === 'apply' && !apply()) {
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
      const src = tilePreview(state.tile, state.colors);
      previewTile = state.tile;
      previewColors = state.colors.join(',');
      el('preview').hidden = !src;
      if (src) el('preview').src = src;
      el('preview').alt = `Isometric view of ${el('name').textContent}`;
    });
  }
  return {
    update(next) {
      const same = state?.cell.key === next.cell.key;
      state = next;
      el('name').textContent = describeHex({ ...next.cell, forest: next.dressed?.forest })
        .split(' · ')
        .slice(2)
        .join(' · ');
      el('address').textContent = `Region ${next.cell.regionId} · ${next.cell.x}, ${next.cell.y}`;
      host.dataset.hexKey = next.cell.key;
      const distances = inspectDistances(next.world, next.cell);
      for (const [name, value] of Object.entries(distances))
        el(`distance-${name}`).textContent =
          value === null ? 'None on map' : `${value} ${value === 1 ? 'hex' : 'hexes'}`;
      el('visited-state').textContent = next.visited ? 'Already visited' : 'Not yet visited';
      el('visited').setAttribute('aria-checked', String(next.visited));
      el('lock').innerHTML =
        `${icon('lock')}<span>${next.locked ? 'Unlock hex' : 'Lock hex'}</span>`;
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
    beforeSelection(key, select) {
      if (state?.cell.key !== key && dirty) {
        pending = select;
        if (!unsaved.open) unsaved.showModal();
        return false;
      }
      if (state?.cell.key !== key) setEditing(false);
      return true;
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
