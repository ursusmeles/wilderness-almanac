import { openDialog } from './dialog-focus.js';
import { cloneTemplate } from './templates.js';

export function createPaletteManager({ library, onChange }) {
  const dialog = document.getElementById('palette-manager-dialog');
  const list = document.getElementById('palette-manager-list');
  const message = document.getElementById('palette-manager-message');
  const deleteButton = document.getElementById('delete-palette');
  const defaultButton = document.getElementById('default-palette');
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  const roles = ['Ground', 'Water', 'Elements'];
  let selectedId = library.default().id;
  let deleted;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.textContent = 'Undo deletion';
  undo.hidden = true;
  deleteButton.after(undo);

  function feedback(text = '') {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.kind = /aren’t saved|Enter a palette name/.test(text) ? 'error' : 'status';
    message.classList.toggle('sr-only', message.dataset.kind !== 'error');
  }

  function save(text = '', announce = true) {
    const saved = onChange();
    if (!saved || announce)
      feedback(saved ? text : 'Palette changes aren’t saved. Keep this page open and try again.');
  }

  function syncSelection() {
    for (const row of list.children) {
      const selected = row.dataset.id === selectedId;
      row.setAttribute('aria-selected', String(selected));
      row.tabIndex = selected ? 0 : -1;
      row.querySelectorAll('input').forEach((input) => {
        input.tabIndex = selected ? 0 : -1;
      });
      row.querySelector('.palette-default').hidden = row.dataset.id !== library.default().id;
      labelRow(row, library.get(row.dataset.id));
    }
    deleteButton.disabled = Boolean(library.get(selectedId)?.builtin);
    if (deleteButton.disabled) deleteButton.dataset.tooltip = 'You can delete custom palettes only';
    else delete deleteButton.dataset.tooltip;
    defaultButton.disabled = selectedId === library.default().id;
  }

  function labelRow(row, palette) {
    row.setAttribute(
      'aria-label',
      `${palette.name}${palette.id === library.default().id ? ', default palette' : ''}`,
    );
    row.querySelectorAll('input[type="color"]').forEach((input, index) => {
      input.setAttribute('aria-label', `${palette.name}: ${roles[index].toLowerCase()} colour`);
      input.dataset.tooltip = `${roles[index]} · ${palette.colors[index].toUpperCase()}`;
    });
    const name = row.querySelector('.palette-name');
    if (name) {
      name.setAttribute('aria-label', `Palette name: ${palette.name}`);
      name.style.width = `${palette.name.length + 1}ch`;
    }
  }

  function focusSelection() {
    const row = list.querySelector('[aria-selected="true"]');
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    list.replaceChildren();
    for (const palette of library.all()) {
      const row = cloneTemplate('palette-row-template').firstElementChild;
      row.dataset.id = palette.id;
      row.classList.toggle('is-custom', !palette.builtin);
      const swatches = row.querySelector('.palette-swatches');
      palette.colors.forEach((color, index) => {
        const swatch = document.createElement(palette.builtin ? 'span' : 'label');
        swatch.className = 'palette-swatch';
        swatch.style.setProperty('--swatch-color', color);
        if (palette.builtin) swatch.dataset.tooltip = `${roles[index]} · ${color.toUpperCase()}`;
        if (palette.builtin) {
          swatch.setAttribute('role', 'img');
          swatch.setAttribute('aria-label', swatch.dataset.tooltip);
        } else {
          const input = document.createElement('input');
          input.type = 'color';
          input.value = color;
          input.dataset.color = index;
          swatch.append(input);
        }
        swatches.append(swatch);
      });
      const name = document.createElement(palette.builtin ? 'span' : 'input');
      if (palette.builtin) name.textContent = palette.name;
      else {
        name.type = 'text';
        name.className = 'palette-name';
        name.value = palette.name;
        name.maxLength = 60;
        name.autocomplete = 'off';
        name.spellcheck = false;
      }
      row.querySelector('.palette-name-wrap').prepend(name);
      labelRow(row, palette);
      list.append(row);
    }
    syncSelection();
  }

  listen(document.getElementById('open-palette-manager'), 'click', () => {
    if (!library.get(selectedId)) selectedId = library.default().id;
    render();
    openDialog(dialog);
    focusSelection();
  });
  listen(document.getElementById('close-palette-manager'), 'click', () => dialog.close());
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
    if (backdropPress && isBackdrop(event)) dialog.close();
    backdropPress = false;
  });
  for (const type of ['click', 'focusin'])
    listen(list, type, (event) => {
      const row = event.target.closest('.palette-row');
      if (!row) return;
      selectedId = row.dataset.id;
      syncSelection();
      if (type === 'click' && !event.target.closest('input, label')) focusSelection();
    });
  listen(list, 'input', (event) => {
    const input = event.target;
    if (input.type !== 'color') return;
    const row = input.closest('.palette-row');
    if (!library.color(row.dataset.id, Number(input.dataset.color), input.value)) return;
    input.parentElement.style.setProperty('--swatch-color', input.value);
    labelRow(row, library.get(row.dataset.id));
    save('', false);
  });
  listen(list, 'change', (event) => {
    const input = event.target;
    if (input.type === 'color') {
      const palette = library.get(input.closest('.palette-row').dataset.id);
      save(`${palette.name}: ${roles[Number(input.dataset.color)]} colour saved.`);
    }
    if (input.classList.contains('palette-name')) {
      const row = input.closest('.palette-row');
      const palette = library.get(row.dataset.id);
      const previousName = palette.name;
      if (!library.rename(palette.id, input.value)) {
        input.value = palette.name;
        feedback('Enter a palette name.');
        return;
      }
      input.value = palette.name;
      labelRow(row, palette);
      if (palette.name !== previousName) save(`Palette renamed to “${palette.name}”.`);
    }
  });
  listen(list, 'keydown', (event) => {
    if (event.target.matches('input')) {
      if (event.key === 'Escape' && event.target.classList.contains('palette-name')) {
        event.preventDefault();
        event.stopPropagation();
        event.target.value = library.get(event.target.closest('.palette-row').dataset.id).name;
        event.target.blur();
        focusSelection();
      }
      if (event.key === 'Enter' && event.target.classList.contains('palette-name')) {
        event.preventDefault();
        event.target.blur();
        focusSelection();
      }
      return;
    }
    const palettes = library.all();
    const index = palettes.findIndex((palette) => palette.id === selectedId);
    const direction = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    if (direction || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? palettes.length - 1
            : (index + direction + palettes.length) % palettes.length;
      selectedId = palettes[next].id;
      syncSelection();
      focusSelection();
    } else if (event.key === 'Enter') {
      const input = event.target.closest('.palette-row')?.querySelector('.palette-name');
      if (input) {
        event.preventDefault();
        input.focus();
        input.select();
      }
    }
  });
  listen(document.getElementById('add-palette'), 'click', () => {
    selectedId = library.add(library.get(selectedId)?.colors).id;
    render();
    save('Palette added.');
    const input = list.lastElementChild.querySelector('.palette-name');
    input.focus();
    input.select();
  });
  listen(deleteButton, 'click', () => {
    const index = library.all().findIndex((palette) => palette.id === selectedId);
    const palette = library.get(selectedId);
    const wasDefault = selectedId === library.default().id;
    const customIndex = library.custom.indexOf(palette);
    if (!library.remove(selectedId)) return;
    deleted = { palette, index: customIndex, wasDefault };
    undo.setAttribute('aria-label', `Undo deletion of ${palette.name}`);
    undo.hidden = false;
    selectedId = library.all()[Math.max(0, index - 1)].id;
    render();
    save(`“${palette.name}” deleted.${wasDefault ? ' Default: Forbidden Lands.' : ''}`);
    focusSelection();
  });
  listen(defaultButton, 'click', () => {
    if (!library.setDefault(selectedId)) return;
    if (deleted) deleted.wasDefault = false;
    syncSelection();
    save(`Default palette: ${library.default().name}.`);
  });
  listen(undo, 'click', () => {
    if (!deleted || !library.restore(deleted.palette, deleted.index, deleted.wasDefault)) return;
    selectedId = deleted.palette.id;
    deleted = undefined;
    undo.hidden = true;
    render();
    save('Palette restored.');
    focusSelection();
  });

  return {
    dispose() {
      listeners.abort();
      dialog.close();
      undo.remove();
    },
  };
}
