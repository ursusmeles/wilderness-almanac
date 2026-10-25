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

  const values = () => ({
    defaultPalette: el('palette').value,
    defaultTimeOfDay: el('time').value,
    motion: el('motion').getAttribute('aria-checked') === 'true',
  });
  const current = () => ({ defaultPalette: library.default().id, ...read() });
  function sync() {
    el('save').disabled =
      reading ||
      saving ||
      (!pendingImport && JSON.stringify(values()) === JSON.stringify(current()));
    for (const control of dialog.querySelectorAll('button, select, input'))
      if (control !== el('save')) control.disabled = saving;
    importButton.disabled = reading || saving;
    el('motion-state').textContent = values().motion ? 'ON' : 'OFF';
  }
  function palettes(selected = el('palette').value) {
    el('palette').replaceChildren(
      ...library.all().map((palette) => {
        const option = document.createElement('option');
        option.value = palette.id;
        option.textContent = palette.name;
        return option;
      }),
    );
    el('palette').value = library.get(selected) ? selected : library.default().id;
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
    el('time').value = saved.defaultTimeOfDay;
    el('motion').setAttribute('aria-checked', String(saved.motion));
    el('filename').textContent = 'No file selected';
    el('message').textContent = '';
    sync();
    openDialog(dialog, el('palette'));
  });
  listen(el('palette'), 'change', () => {
    paletteEdited = true;
    sync();
  });
  listen(el('time'), 'change', sync);
  listen(el('motion'), 'click', () => {
    el('motion').setAttribute('aria-checked', String(!values().motion));
    sync();
  });
  listen(document.getElementById('palette-manager-dialog'), 'close', () => {
    if (!dialog.open) return;
    palettes(paletteEdited ? el('palette').value : library.default().id);
    sync();
  });
  listen(el('cancel'), 'click', discard);
  listen(dialog, 'cancel', (event) => {
    event.preventDefault();
    discard();
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
        throw new Error('Choose a campaign JSON file smaller than 4 MB.');
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
