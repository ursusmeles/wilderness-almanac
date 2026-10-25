import { POI_TYPES, POI_VARIANTS } from '../generation/hex-edits.js';

const title = (value) => value[0].toUpperCase() + value.slice(1);

export const POI_OPTIONS = [
  { value: '', label: 'None' },
  ...POI_TYPES.flatMap((kind) =>
    POI_VARIANTS[kind]
      ? POI_VARIANTS[kind].map((variant) => ({
          value: `${kind}:${variant}`,
          label: variant === kind ? title(kind) : `${title(kind)} · ${title(variant)}`,
        }))
      : [{ value: kind, label: title(kind) }],
  ),
];

export const poiValue = (poi) =>
  !poi ? '' : POI_VARIANTS[poi.kind] ? `${poi.kind}:${poi.variant}` : poi.kind;

export const poiLabel = (poi) =>
  POI_OPTIONS.find(({ value }) => value === poiValue(poi))?.label ?? 'None';

export function poiFromValue(value, current) {
  if (!value) return null;
  const [kind, named] = value.split(':');
  return {
    kind,
    variant: POI_VARIANTS[kind]
      ? named
      : current?.kind === kind && typeof current.variant === 'number'
        ? current.variant
        : 0,
  };
}
