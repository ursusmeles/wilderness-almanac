// Screen-relative neighbours for the map's fixed isometric camera.
// Arrow keys remain dedicated to panning; party movement is always one hex.
export const PARTY_KEYS = {
  q: [-1, 0],
  w: [0, -1],
  e: [1, -1],
  a: [-1, 1],
  s: [0, 1],
  d: [1, 0],
};

export function partyDestinations(key, cells) {
  const [q, r] = key.split(',').map(Number);
  const available = new Set(cells.map((cell) => cell.key));
  return Object.entries(PARTY_KEYS).flatMap(([shortcut, [dq, dr]]) => {
    const target = `${q + dq},${r + dr}`;
    return available.has(target) ? [{ shortcut, key: target }] : [];
  });
}
