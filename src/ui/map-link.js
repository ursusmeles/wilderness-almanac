const validColors = (colors) =>
  colors?.length === 3 && colors.every((c) => /^#[0-9a-f]{6}$/i.test(c));

export function readMapLink(href) {
  const params = new URL(href).searchParams;
  const seed = params.get('seed')?.trim();
  const variant =
    params.has('variant') && /^\d+$/.test(params.get('variant'))
      ? Number(params.get('variant'))
      : undefined;
  const colors = params
    .get('colors')
    ?.split('-')
    .map((color) => `#${color}`);
  return {
    seed: seed && seed.length <= 128 ? seed : undefined,
    variant: Number.isSafeInteger(variant) ? variant : undefined,
    colors: validColors(colors) ? colors : undefined,
  };
}

export function mapLink(href, { seed, variant, colors }) {
  const url = new URL(href);
  url.searchParams.set('seed', seed);
  url.searchParams.set('variant', String(variant));
  url.searchParams.set('colors', colors.map((color) => color.slice(1)).join('-'));
  return url.href;
}

export async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  const focused = document.activeElement;
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
  } finally {
    input.remove();
    focused?.focus();
  }
}

export function describeHex(cell) {
  const label =
    cell.pointOfLight?.type ??
    (cell.water === 'lake' ? 'lake' : (cell.forest?.name ?? cell.terrain));
  const articles = {
    ruins: 'ruins',
    encampment: 'an encampment',
    watchtower: 'a watchtower',
    stronghold: 'a stronghold',
    lair: 'a lair',
    mystic: 'a mystic site',
    abbey: 'an abbey',
    battlefield: 'a battlefield',
    dungeon: 'a dungeon',
  };
  const poi = cell.pointsOfInterest[0];
  const feature = poi
    ? poi.variant === 'lighthouse'
      ? 'a lighthouse'
      : articles[poi.kind]
    : cell.crossing
      ? cell.crossing.kind === 'ferry'
        ? 'a ferry'
        : `a ${cell.crossing.material === 'stone' ? 'stone' : 'wooden'} bridge`
      : '';
  return `Region #${cell.regionId} · ${cell.x}, ${cell.y} · ${label[0].toUpperCase() + label.slice(1)}${feature ? ` with ${feature}` : ''}`;
}
