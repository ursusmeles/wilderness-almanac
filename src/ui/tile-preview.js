import { createMapRenderer } from '../rendering/map-renderer.js';

let host;
let renderer;

// The menu and inspector share one offscreen, non-animated renderer.
function prepareRenderer() {
  if (!host) {
    host = document.createElement('div');
    host.className = 'campaign-preview';
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
    renderer = createMapRenderer(host, { motion: false });
  }
  return renderer;
}

export function partyPreview(party, colors, color) {
  if (!prepareRenderer()) return '';
  renderer.setPartyPiece(party.style, color);
  renderer.setPalette(colors);
  return renderer.snapshot();
}

export function tilePreview(tile, colors, { fitContent = false } = {}) {
  if (!tile) return '';
  prepareRenderer();
  if (!renderer) return '';
  renderer.setMap([{ ...tile, q: 0, r: 0 }], { resetView: true, fitContent });
  renderer.setPalette(colors);
  if (!fitContent) renderer.zoom(4.1);
  return renderer.snapshot();
}

export function disposeTilePreview() {
  renderer?.dispose();
  host?.remove();
  renderer = host = undefined;
}
