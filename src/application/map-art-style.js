export const MAP_ART_STYLES = ['low-poly', 'pixelart'];
export const DEFAULT_MAP_ART_STYLE = 'low-poly';

export function mapArtStyle(value) {
  return MAP_ART_STYLES.includes(value) ? value : DEFAULT_MAP_ART_STYLE;
}
