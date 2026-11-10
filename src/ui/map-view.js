// @ts-check
import { createMapRenderer } from '../rendering/map-renderer.js';
import { createIncrementalMapBuilds } from '../rendering/incremental-map-builds.js';

export { createMapRenderer };

/**
 * Interactive maps share retained incremental chunks. Still images use the
 * synchronous renderer exported above.
 * @param {Parameters<typeof createMapRenderer>[0]} host
 * @param {Parameters<typeof createMapRenderer>[1]} [options]
 */
export function createIncrementalMapRenderer(host, options) {
  return createMapRenderer(host, {
    ...options,
    createBuilds: createIncrementalMapBuilds,
  });
}

/**
 * Campaigns composite opaque snapshots over their transparent live canvas.
 * @param {Parameters<typeof createMapRenderer>[0]} host
 * @param {Parameters<typeof createMapRenderer>[1]} [options]
 */
export function createCampaignMapRenderer(host, options) {
  const renderer = createIncrementalMapRenderer(host, { ...options, transparent: true });
  return renderer && { ...renderer, snapshot: () => renderer.snapshot({ opaque: true }) };
}
export { tilePreview, partyPreview, disposeTilePreview } from './tile-preview.js';
export { partyColor } from '../rendering/party-color.js';
