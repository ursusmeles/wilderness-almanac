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
    renderer = createMapRenderer(host, {
      motion: false,
      transparent: true,
      groundShadow: false,
    });
  }
  return renderer;
}

export function partyPreview(party, colors, color, artStyle = 'low-poly') {
  if (!prepareRenderer()) return '';
  renderer.setPartyPiece(party.style, color, artStyle);
  renderer.setPalette(colors);
  return renderer.snapshot();
}

export function tilePreview(tile, colors, { artStyle = 'low-poly' } = {}) {
  if (!tile) return '';
  prepareRenderer();
  if (!renderer) return '';
  renderer.setMap([{ ...tile, q: 0, r: 0 }], { resetView: true, fitContent: true, artStyle });
  renderer.setPalette(colors);
  return renderer.snapshot();
}

export function disposeTilePreview() {
  renderer?.dispose();
  host?.remove();
  renderer = host = undefined;
}
