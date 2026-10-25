// Cosmetic relief belongs to each reserved crop footprint, leaving roads,
// neighbouring tiles and gameplay elevation unchanged. Old plots remain flat.
export function isVineyard(cell, props = cell.props) {
  return (
    cell.terrain === 'farmlands' && Boolean(props?.some((prop) => prop.cropStyle === 'vineyard'))
  );
}

export function cropHeight(prop, x, z) {
  if (!prop.cropStyle || prop.cropStyle === 'plots') return 0;
  const edge = Math.max(0, 1 - (x / 0.18) ** 2) * Math.max(0, 1 - (z / 0.2) ** 2);
  return edge * (0.035 + (prop.detailSeed % 7) * 0.003) * (1 + x * 0.8);
}
