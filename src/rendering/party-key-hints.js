import { Vector3 } from 'three';
import { partyDestinations } from '../application/party-navigation.js';

// Only coordinates from the rendered fog projection are used; no feature names leak.
export function createPartyKeyHints(host) {
  const overlay = document.createElement('div');
  overlay.className = 'hp-party-key-hints';
  overlay.setAttribute('aria-hidden', 'true');
  host.append(overlay);
  let enabled = false,
    key,
    cells = [];
  let signature;
  const point = new Vector3();
  return {
    set(nextKey, nextCells, visible) {
      key = nextKey;
      cells = nextCells;
      enabled = visible;
      overlay.hidden = !visible;
      const destinations = key ? partyDestinations(key, cells) : [];
      const next = JSON.stringify(destinations);
      if (signature === next) return;
      signature = next;
      overlay.replaceChildren(
        ...destinations.map((entry) => {
          const label = document.createElement('kbd');
          label.textContent = entry.shortcut.toUpperCase();
          label.dataset.key = entry.key;
          return label;
        }),
      );
    },
    render(camera) {
      if (!enabled) return;
      for (const label of overlay.children) {
        const tile = cells.find((cell) => cell.key === label.dataset.key);
        point.set(tile.g.position.x, tile.top + 0.15, tile.g.position.z).project(camera);
        label.hidden =
          point.z < -1 || point.z > 1 || Math.abs(point.x) > 0.96 || Math.abs(point.y) > 0.94;
        label.style.left = `${(point.x + 1) * 50}%`;
        label.style.top = `${(1 - point.y) * 50}%`;
      }
    },
    dispose() {
      overlay.remove();
    },
  };
}
