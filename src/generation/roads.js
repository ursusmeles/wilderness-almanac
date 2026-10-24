import { DIRECTIONS, directionTo, distance, neighbours } from './hex.js';
import { randomFor } from './seed.js';
import { preferenceWeights } from './world-preferences.js';
import { prepareRiverGeometry, riverFieldFor } from './presentation.js';
import { riverBankValue } from './river-surfaces.js';

export const roadKey = (a, b) => [a, b].sort().join('|');
export const roadCellKey = (id) => id.split(':')[0];
export const roadLand = (cell) => !!cell && !cell.water && cell.terrain !== 'mountains';
const counted = (cell) => roadLand(cell) && !cell.pointOfLight && !cell.pointsOfInterest.length;
const rank = {
  city: 0,
  town: 1,
  crossing: 2,
  stronghold: 2,
  village: 3,
  abbey: 3,
  watchtower: 3,
  ruins: 4,
};

// A crossing has two separate bank nodes. A river hex is never an ordinary
// traversable node: entering a bank cannot silently cross the wet channel.
export function roadGraph(world) {
  const cells = new Map(world.cells.map((cell) => [cell.key, cell]));
  const nodes = new Map(),
    edges = new Map(),
    ports = new Map();
  const addNode = (id, cell, bank) => nodes.set(id, { id, cell, bank, edges: [] });
  const addEdge = (a, b, side, crossing = false) => {
    const id = roadKey(a, b);
    if (edges.has(id)) return;
    const edge = { id, a, b, crossing };
    edges.set(id, edge);
    nodes.get(a).edges.push(edge);
    nodes.get(b).edges.push(edge);
    if (!crossing) {
      ports.set(`${nodes.get(a).cell.key}/${side}`, edge);
      ports.set(`${nodes.get(b).cell.key}/${(side + 3) % 6}`, edge);
    }
  };
  for (const cell of world.cells) {
    if (roadLand(cell)) addNode(cell.key, cell);
    else if (cell.water === 'river' && cell.crossing)
      for (const bank of ['a', 'b']) addNode(`${cell.key}:${bank}`, cell, bank);
  }
  for (const cell of world.cells.filter(roadLand))
    for (const next of neighbours(cell, cells))
      if (roadLand(next) && Math.abs(cell.elevation - next.elevation) <= 1)
        addEdge(cell.key, next.key, directionTo(cell, next));
  const crossings = world.cells.filter((cell) => cell.water === 'river' && cell.crossing);
  const fields = crossings.length ? prepareRiverGeometry(world) : null;
  for (const cell of crossings) {
    const river = riverFieldFor(cell, fields);
    for (let side = 0; side < 6; side++) {
      const [q, r] = DIRECTIONS[side];
      const next = cells.get(`${cell.q + q},${cell.r + r}`);
      if (!roadLand(next) || next.elevation > 1) continue;
      const angle = (side * Math.PI) / 3;
      const port = [(Math.cos(angle) * Math.sqrt(3)) / 2, (Math.sin(angle) * Math.sqrt(3)) / 2];
      // Only attach a port when its entire approach lies on the same dry bank.
      const choices = ['a', 'b']
        .filter((bank) => {
          const end = cell.crossing[bank];
          return Array.from({ length: 21 }, (_, i) => i / 20).every(
            (t) =>
              riverBankValue(
                river,
                cell.wx + port[0] * (1 - t) + end[0] * t,
                cell.wz + port[1] * (1 - t) + end[1] * t,
              ) > 0.004,
          );
        })
        .sort(
          (a, b) =>
            Math.hypot(port[0] - cell.crossing[a][0], port[1] - cell.crossing[a][1]) -
            Math.hypot(port[0] - cell.crossing[b][0], port[1] - cell.crossing[b][1]),
        );
      if (choices.length) addEdge(`${cell.key}:${choices[0]}`, next.key, side);
    }
    addEdge(`${cell.key}:a`, `${cell.key}:b`, -1, true);
  }
  return { cells, nodes, edges, ports };
}

function destinations(world, graph) {
  const result = world.settlements.map((settlement) => ({
    id: settlement.id,
    kind: 'settlement',
    rank: rank[settlement.type],
    nodes: settlement.hexKeys.filter((key) => graph.nodes.has(key)),
  }));
  for (const cell of world.cells) {
    if (cell.crossing)
      result.push({
        id: `crossing:${cell.key}`,
        kind: 'crossing',
        rank: 2,
        nodes: ['a', 'b'].map((bank) => `${cell.key}:${bank}`),
      });
    if (!roadLand(cell)) continue;
    for (const poi of cell.pointsOfInterest) {
      if (
        rank[poi.kind] === undefined ||
        (poi.kind === 'ruins' && randomFor(world.seed, `road-ruins:${cell.key}`)() >= 0.1)
      )
        continue;
      result.push({
        id: poi.id,
        kind: 'poi',
        poiKind: poi.kind,
        rank: rank[poi.kind],
        nodes: [cell.key],
      });
    }
  }
  return result
    .filter((entry) => entry.nodes.length)
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

const terrainCost = {
  meadow: 1,
  farmlands: 0.85,
  'light forest': 1.5,
  'dense forest': 3.5,
  wetlands: 4,
};

function shortest(graph, starts, goals, existing, maxSteps = Infinity) {
  const costs = new Map(starts.map((key) => [key, 0]));
  const previous = new Map(),
    steps = new Map(starts.map((key) => [key, 0]));
  const queue = starts.map((key) => ({ key, cost: 0 }));
  while (queue.length) {
    // The fixed map has fewer than 500 nodes; a sorted frontier stays small.
    queue.sort((a, b) => b.cost - a.cost || b.key.localeCompare(a.key));
    const { key, cost } = queue.pop();
    if (cost !== costs.get(key)) continue;
    if (goals.has(key)) {
      const path = [key];
      while (previous.has(path[0])) path.unshift(previous.get(path[0]));
      return path;
    }
    if (steps.get(key) >= maxSteps) continue;
    for (const edge of graph.nodes.get(key).edges) {
      const next = edge.a === key ? edge.b : edge.a;
      const cell = graph.nodes.get(next).cell;
      const slope = Math.abs(cell.elevation - graph.nodes.get(key).cell.elevation);
      const weight = edge.crossing
        ? 0.35
        : (terrainCost[cell.terrain] ?? 1) * (existing.has(edge.id) ? 0.45 : 1) + slope * 0.35;
      const total = cost + weight;
      if (total >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, total);
      steps.set(next, steps.get(key) + 1);
      previous.set(next, key);
      queue.push({ key: next, cost: total });
    }
  }
  return null;
}

const pathEdges = (path) => path.slice(1).map((key, i) => roadKey(path[i], key));
const pathTiles = (path, graph) =>
  path
    .map((key) => graph.nodes.get(key).cell)
    .filter(counted)
    .map((cell) => cell.key);

export function generateRoads(world) {
  const graph = roadGraph(world);
  const dryLand = world.cells.filter((cell) => !cell.water).length;
  const budget = Math.floor(dryLand * Math.min(0.2, 0.1 * preferenceWeights(world).PL));
  const places = destinations(world, graph);
  const used = new Set(),
    existing = new Set(),
    links = [];
  const parents = new Map([...graph.nodes.keys()].map((key) => [key, key]));
  const root = (key) => {
    while (parents.get(key) !== key) key = parents.get(key);
    return key;
  };
  for (const place of places) {
    const proximity = (other) =>
      Math.min(
        ...place.nodes.flatMap((a) =>
          other.nodes.map((b) => distance(graph.nodes.get(a).cell, graph.nodes.get(b).cell)),
        ),
      );
    const targets = places
      .filter((other) => other !== place)
      .sort(
        (a, b) =>
          Number(a.rank > place.rank) - Number(b.rank > place.rank) ||
          (a.rank > place.rank && b.rank > place.rank ? a.rank - b.rank : 0) ||
          proximity(a) - proximity(b) ||
          a.id.localeCompare(b.id),
      );
    for (const target of targets) {
      // Existing connections satisfy the request; do not add a redundant loop.
      if (place.nodes.some((a) => target.nodes.some((b) => root(a) === root(b)))) break;
      const goals = new Set(target.nodes);
      const direct = shortest(graph, place.nodes, goals, new Set());
      if (!direct) continue;
      const path =
        shortest(graph, place.nodes, goals, existing, Math.ceil(direct.length * 1.4) + 1) ?? direct;
      const added = [...new Set(pathTiles(path, graph))].filter((key) => !used.has(key));
      if (used.size + added.length > budget) continue;
      links.push({ id: `road-${links.length + 1}`, from: place, to: target, path });
      added.forEach((key) => used.add(key));
      pathEdges(path).forEach((key) => existing.add(key));
      for (let i = 1; i < path.length; i++) parents.set(root(path[i]), root(path[i - 1]));
      // A settlement footprint is one destination even when several cells wide.
      for (const destination of [place, target])
        for (const key of destination.nodes) parents.set(root(key), root(path[0]));
      break;
    }
  }
  world.roads = { budget, dryLand, links, edges: [...existing].sort() };
  assignRoadCells(world, graph);
  return world;
}

export function validRoadLink(link, graph) {
  const destinationExists = (place, entry) => {
    const node = graph.nodes.get(entry);
    if (!node) return false;
    if (place.kind === 'settlement') return !!node.cell.pointOfLight;
    if (place.kind === 'crossing') return !!node.cell.crossing;
    return node.cell.pointsOfInterest.some((poi) => poi.kind === place.poiKind);
  };
  return (
    destinationExists(link.from, link.path[0]) &&
    destinationExists(link.to, link.path.at(-1)) &&
    pathEdges(link.path).every((key) => graph.edges.has(key))
  );
}

export function applyRoadEdits(world, base, edits) {
  if (!base.roads) return world;
  const graph = roadGraph(world);
  const removed = new Set(Object.values(edits).flatMap((edit) => edit.removedRoadLinks ?? []));
  const links = base.roads.links.filter(
    (link) => !removed.has(link.id) && validRoadLink(link, graph),
  );
  const edges = new Set(links.flatMap((link) => pathEdges(link.path)));
  for (const [key, edit] of Object.entries(edits))
    edit.road?.forEach((value, side) => {
      const edge = graph.ports.get(`${key}/${side}`);
      if (!edge || value === null) return;
      if (value) edges.add(edge.id);
      else edges.delete(edge.id);
    });
  world.roads = { ...base.roads, links, edges: [...edges].sort() };
  assignRoadCells(world, graph);
  return world;
}

function assignRoadCells(world, graph) {
  for (const cell of world.cells) delete cell.road;
  for (const id of world.roads.edges) {
    const edge = graph.edges.get(id);
    if (!edge || edge.crossing) continue;
    const a = graph.nodes.get(edge.a),
      b = graph.nodes.get(edge.b);
    const side = directionTo(a.cell, b.cell);
    for (const [node, exit] of [
      [a, side],
      [b, (side + 3) % 6],
    ]) {
      node.cell.road ??= { exits: 0, banks: {} };
      node.cell.road.exits |= 1 << exit;
      if (node.bank) node.cell.road.banks[exit] = node.bank;
    }
  }
}
