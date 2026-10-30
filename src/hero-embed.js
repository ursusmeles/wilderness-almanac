import scene from 'virtual:hero-scene';
import { TIMES_OF_DAY } from './application/time-of-day.js';

const host = document.getElementById('hero-scene');
const select = document.getElementById('hero-hex');
const output = document.getElementById('hero-selection');
const labels = new Map(scene.hexes.map((hex) => [hex.key, hex.label]));
const listeners = new AbortController();
let renderer;
let ready = false;
let lighting = 'dawn';
let selectedKey = null;
let parentOrigin = null;

try {
  if (window.parent !== window)
    parentOrigin = new URL(document.referrer || new URL(location.href).searchParams.get('parent'))
      .origin;
} catch {}

function notify(type, values = {}) {
  if (parentOrigin)
    window.parent.postMessage({ type: `twa-hero:${type}`, ...values }, parentOrigin);
}

function announceSelection(key) {
  const label = labels.get(key);
  if (!label) return;
  selectedKey = key;
  select.value = key;
  output.textContent = label;
  notify('selection', { key, label });
}

for (const hex of scene.hexes) {
  const option = document.createElement('option');
  option.value = hex.key;
  option.textContent = hex.label;
  select.append(option);
}
select.selectedIndex = -1;
select.addEventListener('change', () => renderer?.select(select.value), {
  signal: listeners.signal,
});

window.addEventListener(
  'message',
  (event) => {
    if (event.source !== window.parent || event.origin !== parentOrigin || !ready) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'twa-hero:time' && TIMES_OF_DAY.includes(message.value)) {
      lighting = renderer.setTimeOfDay(message.value);
      notify('time', { value: lighting });
    } else if (message.type === 'twa-hero:hello') {
      notify('ready', { timeOfDay: lighting, selectedKey, hexes: scene.hexes });
    }
  },
  { signal: listeners.signal },
);

async function initialize() {
  try {
    const { createMapRenderer } = await import('./ui/map-view.js');
    if (listeners.signal.aborted) return;
    renderer = createMapRenderer(host, {
      motion: false,
      navigation: false,
      artStyle: 'pixelart',
      onSelect: announceSelection,
    });
    if (!renderer) throw new Error('WebGL is unavailable.');
    const canvas = host.querySelector('canvas');
    canvas.tabIndex = -1;
    canvas.setAttribute('aria-label', 'Heliotest in Pixelart. Click a hex to read its name.');
    canvas.addEventListener('webglcontextlost', () => notify('error'), {
      signal: listeners.signal,
    });
    renderer.setPalette(scene.palette);
    renderer.setTimeOfDay('dawn');
    renderer.setMap(scene.layout, { resetView: true, fitContent: true, artStyle: 'pixelart' });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (listeners.signal.aborted) return;
        ready = true;
        document.body.dataset.ready = 'true';
        notify('ready', { timeOfDay: lighting, selectedKey, hexes: scene.hexes });
      }),
    );
  } catch (error) {
    renderer?.dispose();
    renderer = null;
    document.body.dataset.ready = 'error';
    output.textContent = 'Live map unavailable.';
    notify('error');
    console.warn('Hero map could not start.', error);
  }
}

window.addEventListener(
  'pagehide',
  (event) => {
    if (event.persisted) return;
    listeners.abort();
    renderer?.dispose();
    renderer = null;
  },
  { signal: listeners.signal },
);

void initialize();
