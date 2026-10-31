export const UI_THEME_KEY = 'wilderness-theme';

export function readUITheme(storage, fallback = 'dark') {
  if (!storage) return fallback;
  try {
    const value = storage?.getItem(UI_THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'dark';
  } catch {
    return fallback;
  }
}

export function createUITheme({ storage, onChange }) {
  const root = document.documentElement;
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  let preference = readUITheme(storage, root.dataset.theme === 'light' ? 'light' : 'dark');

  function apply() {
    const scheme = preference;
    root.dataset.theme = scheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = meta.dataset[scheme];
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const label = `Switch to ${scheme === 'dark' ? 'light' : 'dark'} mode`;
      button.setAttribute('aria-label', label);
      button.dataset.tooltip = label;
      button
        .querySelector('use')
        .setAttribute(
          'href',
          `/icons/pixelarticons.svg#${scheme === 'dark' ? 'lightbulb' : 'moon'}`,
        );
    }
    onChange(scheme);
  }

  function choose(next) {
    preference = next;
    try {
      storage?.setItem(UI_THEME_KEY, next);
    } catch {
      // Keep the manual choice usable when browser storage is restricted.
    }
    apply();
  }

  listen(document, 'click', (event) => {
    if (event.target.closest('[data-theme-toggle]'))
      choose(preference === 'dark' ? 'light' : 'dark');
  });
  listen(window, 'storage', (event) => {
    if (event.key === UI_THEME_KEY || event.key === null) {
      preference = readUITheme(storage, preference);
      apply();
    }
  });
  listen(window, 'pageshow', () => {
    preference = readUITheme(storage, preference);
    apply();
  });
  apply();
  return {
    preference: () => preference,
    current: () => preference,
    choose,
    dispose: () => listeners.abort(),
  };
}
