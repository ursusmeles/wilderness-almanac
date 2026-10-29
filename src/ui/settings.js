import { openDialog } from './dialog-focus.js';
import { importCampaign, MAX_CAMPAIGN_BYTES } from '../application/campaigns.js';

export function createSettings({ library, read, onSave }) {
  const dialog = document.getElementById('settings-dialog');
  const el = (name) => dialog.querySelector(`#settings-${name}`);
  const fileInput = document.getElementById('campaign-file');
  const importButton = document.getElementById('import-campaign');
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  let pendingImport = null,
    paletteEdited = false,
    reading = false,
    saving = false,
    revision = 0;

  const selected = (name) => el(name).querySelector('input:checked').value;
  function select(name, value) {
    for (const input of el(name).querySelectorAll('input'))
      input.checked = input.value === String(value);
  }
  const values = () => ({
    defaultPalette: el('palette').value,
    defaultTimeOfDay: selected('time'),
    defaultMapArtStyle: selected('art-style'),
    motion: selected('motion') === 'true',
    journalFirst: selected('panel-order') === 'tracker',
    timeIncrement: selected('time-increment'),
  });
  const current = () => ({ defaultPalette: library.default().id, ...read() });
  function sync() {
    const unchanged = !pendingImport && JSON.stringify(values()) === JSON.stringify(current());
    const disabled = reading || saving || unchanged;
    if (el('save').disabled !== disabled) el('save').disabled = disabled;
    if (unchanged && !reading && !saving) {
      if (el('save-help').dataset.tooltip !== 'No changes made')
        el('save-help').dataset.tooltip = 'No changes made';
    } else delete el('save-help').dataset.tooltip;
    for (const control of dialog.querySelectorAll('button, select, input'))
      if (control !== el('save') && control.disabled !== saving) control.disabled = saving;
    if (importButton.disabled !== (reading || saving)) importButton.disabled = reading || saving;
  }
  function palettes(selected = el('palette').value) {
    const entries = library.all();
    const existing = [...el('palette').options];
    if (
      entries.length !== existing.length ||
      entries.some(
        (palette, index) =>
          palette.id !== existing[index].value || palette.name !== existing[index].textContent,
      )
    )
      el('palette').replaceChildren(
        ...entries.map((palette) => {
          const option = document.createElement('option');
          option.value = palette.id;
          option.textContent = palette.name;
          return option;
        }),
      );
    const value = library.get(selected) ? selected : library.default().id;
    if (el('palette').value !== value) el('palette').value = value;
  }
  function discard() {
    if (saving) return;
    revision++;
    pendingImport = null;
    paletteEdited = false;
    fileInput.value = '';
    dialog.close();
  }
  listen(document.getElementById('open-settings'), 'click', () => {
    const saved = current();
    revision++;
    reading = false;
    pendingImport = null;
    paletteEdited = false;
    fileInput.value = '';
    palettes(saved.defaultPalette);
    select('time', saved.defaultTimeOfDay);
    select('art-style', saved.defaultMapArtStyle);
    select('panel-order', saved.journalFirst ? 'tracker' : 'inspector');
    select('time-increment', saved.timeIncrement);
    select('motion', saved.motion);
    el('filename').textContent = 'No file selected';
    el('message').textContent = '';
    sync();
    openDialog(dialog, el('motion').querySelector('input:checked'));
  });
  listen(el('palette'), 'change', () => {
    paletteEdited = true;
    sync();
  });
  for (const name of ['motion', 'time', 'art-style', 'time-increment', 'panel-order'])
    listen(el(name), 'change', sync);
  listen(document.getElementById('palette-manager-dialog'), 'close', () => {
    if (!dialog.open) return;
    palettes(paletteEdited ? el('palette').value : library.default().id);
    sync();
  });
  listen(el('cancel'), 'click', discard);
  listen(el('close'), 'click', discard);
  listen(dialog, 'cancel', (event) => {
    event.preventDefault();
    discard();
  });
  const isBackdrop = (event) => {
    if (event.target !== dialog) return false;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return (
      event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom
    );
  };
  let backdropPress = false;
  listen(dialog, 'pointerdown', (event) => {
    backdropPress = isBackdrop(event);
  });
  listen(dialog, 'click', (event) => {
    if (backdropPress && isBackdrop(event)) discard();
    backdropPress = false;
  });
  listen(importButton, 'click', () => fileInput.click());
  listen(fileInput, 'change', async () => {
    const file = fileInput.files[0];
    if (!file || saving) return;
    const request = ++revision;
    pendingImport = null;
    reading = true;
    el('filename').textContent = file.name;
    el('message').textContent = 'Reading and validating campaign…';
    el('message').dataset.kind = 'status';
    sync();
    try {
      if (file.size > MAX_CAMPAIGN_BYTES)
        throw new Error('Choose a campaign JSON file smaller than 16 MB.');
      const campaign = importCampaign(await file.text());
      if (request !== revision || listeners.signal.aborted) return;
      campaign.id = crypto.randomUUID();
      pendingImport = campaign;
      el('message').textContent = `Ready to import “${campaign.name}”. Choose Save to import.`;
    } catch (error) {
      if (request !== revision || listeners.signal.aborted) return;
      el('message').textContent = error.message;
      el('message').dataset.kind = 'error';
    } finally {
      if (request === revision && !listeners.signal.aborted) {
        reading = false;
        fileInput.value = '';
        sync();
      }
    }
  });
  listen(el('form'), 'submit', async (event) => {
    event.preventDefault();
    if (el('save').disabled) return;
    saving = true;
    el('save').setAttribute('aria-busy', 'true');
    el('save').classList.add('hp-working');
    sync();
    try {
      await onSave(values(), pendingImport);
      pendingImport = null;
      dialog.close();
    } catch (error) {
      el('message').textContent = error.message;
      el('message').dataset.kind = 'error';
    } finally {
      saving = false;
      el('save').removeAttribute('aria-busy');
      el('save').classList.remove('hp-working');
      sync();
    }
  });
  return {
    dispose() {
      revision++;
      listeners.abort();
      dialog.close();
    },
  };
}
