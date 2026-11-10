// @ts-check
import { DIRECTIONS } from '../generation/hex.js';

export const INITIAL_CHUNK_ID = 'initial';

/** @typedef {{key: string, q: number, r: number, fogState?: string}} ChunkTile */
/** @template T @typedef {{id: string, record: T}} ChunkEntry */
/** @template T @typedef {{signature: string, exposure: number[], record: T}} CachedChunk */
/**
 * @template {ChunkTile} Tile
 * @template Record
 * @typedef {object} IncrementalOptions
 * @property {(tiles: Tile[], style: string) => Record} build
 * @property {(entries: ChunkEntry<Record>[], layout: Tile[], pending: boolean) => void} show
 * @property {(record: Record) => void} release
 * @property {(tiles: Tile[]) => number} [priority]
 * @property {() => void} [preparePriority]
 * @property {(callback: FrameRequestCallback) => number} [schedule]
 * @property {(handle: number) => void} [cancel]
 * @property {() => number} [now]
 * @property {number} [budgetMs]
 */

/** @template {ChunkTile} T @param {T[]} layout @param {string} [initialKey] @returns {Map<string, T[]>} */
export function partitionChunks(layout, initialKey) {
  /** @type {Map<string, T[]>} */
  const chunks = new Map();
  const initial = layout.find((tile) => tile.key === initialKey);
  const first = new Set();
  if (initial) {
    const byKey = new Map(layout.map((tile) => [tile.key, tile]));
    const tiles = [initial];
    for (const [q, r] of DIRECTIONS) {
      const neighbour = byKey.get(`${initial.q + q},${initial.r + r}`);
      if (neighbour) tiles.push(neighbour);
    }
    for (const tile of tiles) first.add(tile.key);
    chunks.set(INITIAL_CHUNK_ID, tiles);
  }
  for (const tile of layout) {
    if (first.has(tile.key)) continue;
    const id = `${Math.floor(tile.q / 4)},${Math.floor(tile.r / 4)}`;
    const chunk = chunks.get(id) ?? [];
    chunk.push(tile);
    chunks.set(id, chunk);
  }
  return chunks;
}

/**
 * Fog geometry also depends on neighboring visibility at chunk boundaries.
 * @param {ChunkTile[]} tiles
 * @param {Map<string, string | undefined>} states
 * @returns {string}
 */
export function chunkSignature(tiles, states) {
  return tiles
    .map(
      (tile) =>
        `${states.get(tile.key)}:${DIRECTIONS.reduce(
          (mask, [q, r], i) =>
            mask | (states.get(`${tile.q + q},${tile.r + r}`) !== 'undiscovered' ? 1 << i : 0),
          0,
        )}`,
    )
    .join('|');
}

/**
 * Track the information in the mounted record, including shared-edge geometry.
 * The low two bits hold the tile's visibility; the rest hold visible neighbours.
 * @param {ChunkTile[]} tiles
 * @param {Map<string, string | undefined>} states
 * @returns {number[]}
 */
function chunkExposure(tiles, states) {
  return tiles.map((tile) => {
    const state = states.get(tile.key);
    const visibility = state === 'undiscovered' ? 0 : state === 'unvisited' ? 1 : 2;
    return DIRECTIONS.reduce(
      (mask, [q, r], i) =>
        mask | (states.get(`${tile.q + q},${tile.r + r}`) !== 'undiscovered' ? 1 << (i + 2) : 0),
      visibility,
    );
  });
}

/** @param {number[]} before @param {number[]} after @returns {boolean} */
function conceals(before, after) {
  return before.some(
    (exposure, i) => (after[i] & 3) < (exposure & 3) || Boolean((exposure >> 2) & ~(after[i] >> 2)),
  );
}

/**
 * Owns at most a source and latest fog record per chunk: a starting hex and its
 * neighbours, then axial 4×4 groups for the remaining map. Builders run
 * outside React; a bounded RAF slice publishes retained objects to scene owners.
 * @template {ChunkTile} Tile
 * @template Record
 * @param {IncrementalOptions<Tile, Record>} options
 */
export function createIncrementalBuilds({
  build,
  show,
  release,
  priority = () => 0,
  preparePriority = () => {},
  schedule = requestAnimationFrame,
  cancel = cancelAnimationFrame,
  now = () => performance.now(),
  budgetMs = 8,
}) {
  /** @type {Map<string, {tiles: Tile[], source?: CachedChunk<Record>, fog?: CachedChunk<Record>}>} */
  const caches = new Map();
  /** @type {Map<string, CachedChunk<Record>>} */
  const displayed = new Map();
  /** @type {Tile[] | undefined} */
  let origin;
  /** @type {Tile[]} */
  let target = [];
  let style = '',
    frame = 0,
    epoch = 0;
  /** @type {Array<{id: string, tiles: Tile[], signature: string, exposure: number[], role: 'source' | 'fog'}>} */
  let jobs = [];

  /** Publish one atomic batch, including synchronous concealment. @returns {void} */
  function publish() {
    show(
      [...displayed].map(([id, { record }]) => ({ id, record })),
      target,
      jobs.length > 0,
    );
  }
  /** Cancel stale work before releasing any record it could reference. @returns {void} */
  function clear() {
    epoch++;
    cancel(frame);
    frame = 0;
    jobs = [];
    displayed.clear();
    target = [];
    publish();
    for (const cache of caches.values()) {
      if (cache.source) release(cache.source.record);
      if (cache.fog) release(cache.fog.record);
    }
    caches.clear();
    origin = undefined;
  }
  /** @param {number} revision @returns {void} */
  function slice(revision) {
    if (revision !== epoch) return;
    frame = 0;
    const start = now();
    preparePriority();
    jobs = jobs
      .map((job) => ({ job, initial: job.id === INITIAL_CHUNK_ID, score: priority(job.tiles) }))
      .sort(
        (a, b) =>
          Number(b.initial) - Number(a.initial) ||
          a.score - b.score ||
          (a.job.id < b.job.id ? -1 : a.job.id > b.job.id ? 1 : 0),
      )
      .map(({ job }) => job);
    /** @type {Record[]} */
    const retired = [];
    let builtInitial = false;
    do {
      const job = jobs.shift();
      if (!job) break;
      const cache = caches.get(job.id);
      if (!cache) throw new Error('Missing incremental chunk cache');
      const record = build(job.tiles, style);
      const previous = cache[job.role];
      const cached = { signature: job.signature, exposure: job.exposure, record };
      cache[job.role] = cached;
      displayed.set(job.id, cached);
      if (previous) retired.push(previous.record);
      if (job.id === INITIAL_CHUNK_ID) {
        builtInitial = true;
        break;
      }
    } while (jobs.length && now() - start < budgetMs);
    publish();
    for (const record of retired) release(record);
    if (jobs.length)
      frame = schedule(() => {
        if (revision !== epoch) return;
        // The renderer's queued draw runs in this frame. Let that frame paint
        // before another geometry build can occupy the main thread.
        if (builtInitial) frame = schedule(() => slice(revision));
        else slice(revision);
      });
  }
  return {
    clear,
    /** Finish pending work for explicit snapshots, never for ordinary input. @returns {void} */
    flush() {
      cancel(frame);
      frame = 0;
      while (jobs.length) {
        slice(epoch);
        cancel(frame);
        frame = 0;
      }
    },
    /** @param {Tile[]} layout @param {Tile[]} source @param {string} nextStyle @param {string} [initialKey] @returns {void} */
    show(layout, source, nextStyle, initialKey) {
      if (source !== origin || nextStyle !== style) {
        clear();
        origin = source;
        style = nextStyle;
        for (const [id, tiles] of partitionChunks(source, initialKey)) caches.set(id, { tiles });
      }
      cancel(frame);
      frame = 0;
      const revision = ++epoch;
      target = layout;
      jobs = [];
      const projected = layout !== source;
      const role = projected ? 'fog' : 'source';
      const byKey = new Map(layout.map((tile) => [tile.key, tile]));
      const states = new Map(layout.map((tile) => [tile.key, tile.fogState]));
      for (const [id, cache] of caches) {
        const signature = projected ? chunkSignature(cache.tiles, states) : 'source';
        const cached = cache[role];
        if (cached?.signature === signature) displayed.set(id, cached);
        else {
          const exposure = chunkExposure(cache.tiles, states);
          const tiles = cache.tiles.map((tile) => {
            const projectedTile = byKey.get(tile.key);
            if (!projectedTile) throw new Error(`Missing projected tile ${tile.key}`);
            return projectedTile;
          });
          jobs.push({ id, tiles, signature, exposure, role });
          const mounted = displayed.get(id);
          // Exploration only adds information: retain known terrain until its
          // replacement is ready. Concealment must detach it before yielding.
          if (mounted && conceals(mounted.exposure, exposure)) displayed.delete(id);
        }
      }
      publish();
      if (jobs.length) frame = schedule(() => slice(revision));
    },
  };
}
