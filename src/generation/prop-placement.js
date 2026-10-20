import { TOP_RADIUS } from './math.js';

const PROP_GAP = 0.025,
  APOTHEM = Math.sqrt(3) / 2;

function fitsHex(x, z, r) {
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3;
    if (x * Math.cos(a) + z * Math.sin(a) > APOTHEM * TOP_RADIUS - r - 0.018) return false;
  }
  return true;
}
function fitsTree(cell, x, z, r) {
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3,
      margin = cell.links[k] ? r * 0.17 : r;
    if (x * Math.cos(a) + z * Math.sin(a) > APOTHEM * TOP_RADIUS - margin - 0.018) return false;
  }
  return true;
}
function lowProp(kind) {
  return kind === 'rock' || kind === 'grass';
}
function minimumSpacing(a, b) {
  if (a.kind === 'tree' && b.kind === 'tree') return (a.footprint + b.footprint) * 0.59;
  if (a.kind === 'tree' && lowProp(b.kind)) return 0.035 + b.footprint * 0.8;
  if (b.kind === 'tree' && lowProp(a.kind)) return 0.035 + a.footprint * 0.8;
  if (lowProp(a.kind) && lowProp(b.kind)) return (a.footprint + b.footprint) * 0.85;
  return a.footprint + b.footprint + PROP_GAP;
}

export { fitsHex, fitsTree, lowProp, minimumSpacing };
