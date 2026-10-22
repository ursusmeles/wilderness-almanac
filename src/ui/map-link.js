import { worldPreferences, PREFERENCE_NAMES } from '../generation/world-preferences.js';
import { GENERATOR_VERSION, SUPPORTED_GENERATOR_VERSIONS } from '../generation/world.js';
import { hexAddress } from '../generation/hex.js';

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
  const version = params.has('generator') ? Number(params.get('generator')) : 6;
  if (!SUPPORTED_GENERATOR_VERSIONS.includes(version)) return {};
  let preferences;
  if (params.has('world')) {
    const values = params.get('world').split(',');
    if (
      version < 7 ||
      values.length !== PREFERENCE_NAMES.length ||
      values.some((value) => !/^-?[0-2]$/.test(value))
    )
      return {};
    preferences = worldPreferences(
      Object.fromEntries(PREFERENCE_NAMES.map((name, index) => [name, Number(values[index])])),
    );
  }
  return {
    ...(params.has('generator') ? { generatorVersion: version } : {}),
    ...(preferences ? { preferences } : {}),
    seed: seed && seed.length <= 128 ? seed : undefined,
    variant: Number.isSafeInteger(variant) ? variant : undefined,
    colors: validColors(colors) ? colors : undefined,
  };
}

export function mapLink(href, { seed, variant, colors, generatorVersion, preferences }) {
  const url = new URL(href);
  url.searchParams.delete('generator');
  url.searchParams.delete('world');
  if (generatorVersion !== undefined || preferences !== undefined)
    url.searchParams.set('generator', String(generatorVersion ?? GENERATOR_VERSION));
  if (preferences !== undefined && (generatorVersion ?? GENERATOR_VERSION) >= 7) {
    const values = worldPreferences(preferences);
    url.searchParams.set('world', PREFERENCE_NAMES.map((name) => values[name]).join(','));
  }
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

export function shortCoordinates(cell) {
  return cell ? `${cell.regionId}/${cell.x},${cell.y}` : '';
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
  const subtypes = {
    lair: { cave: 'a cave lair', nest: 'a nest' },
    dungeon: { mine: 'a mine', dungeon: 'a dungeon entrance' },
    mystic: { portal: 'a portal', altar: 'an altar', 'standing stone': 'standing stones' },
  };
  const feature = poi
    ? poi.variant === 'lighthouse'
      ? 'a lighthouse'
      : (subtypes[poi.kind]?.[poi.variant] ?? articles[poi.kind])
    : cell.crossing
      ? cell.crossing.kind === 'ferry'
        ? 'a ferry'
        : `a ${cell.crossing.material === 'stone' ? 'stone' : 'wooden'} bridge`
      : '';
  return `${hexAddress(cell)} · ${label[0].toUpperCase() + label.slice(1)}${feature ? ` with ${feature}` : ''}`;
}
