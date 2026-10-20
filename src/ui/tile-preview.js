import { createMapRenderer } from '../rendering/map-renderer.js';

let host;
let renderer;

// The menu and inspector share one offscreen, non-animated renderer.
export function tilePreview(tile, colors) {
  if (!tile) return '';
  if (!host) {
    host = document.createElement('div');
    host.className = 'campaign-preview';
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
    renderer = createMapRenderer(host, { motion: false });
  }
  if (!renderer) return '';
  renderer.setMap([{ ...tile, q: 0, r: 0 }], { resetView: true });
  renderer.setPalette(colors);
  renderer.zoom(4.1);
  return renderer.snapshot();
}

export function disposeTilePreview() {
  renderer?.dispose();
  host?.remove();
  renderer = host = undefined;
}
