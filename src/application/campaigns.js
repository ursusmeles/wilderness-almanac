import { GENERATOR_VERSION } from '../generation/world.js';
import { validateHexEdits } from '../generation/hex-edits.js';
import { campaignWorld, campaignDressing } from '../generation/campaign-world.js';

export const MAX_CAMPAIGN_BYTES = 4 * 1024 * 1024;
const text = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validDate = (value) =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

// Keep saves small: immutable worlds and dressing replay within a generator version.
// Only explicit fields survive import; imported data never becomes render geometry.
export function validateCampaign(value) {
  if (value?.generatorVersion !== GENERATOR_VERSION)
    throw new Error('This campaign uses an unsupported map generator version.');
  if (
    !text(value.id, 128) ||
    !text(value.name, 100) ||
    !text(value.seed, 128) ||
    !validDate(value.createdAt) ||
    !Number.isSafeInteger(value.variant) ||
    value.variant < 0 ||
    !Array.isArray(value.colors) ||
    value.colors.length !== 3 ||
    !value.colors.every((color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) ||
    !text(value.paletteName, 60) ||
    (value.nameEdited !== undefined && typeof value.nameEdited !== 'boolean') ||
    (value.iconKey !== undefined &&
      (typeof value.iconKey !== 'string' || !/^-?\d{1,2},-?\d{1,2}$/.test(value.iconKey)))
  )
    throw new Error('The campaign file has missing or invalid campaign data.');
  return {
    id: value.id,
    name: value.name.trim(),
    createdAt: new Date(value.createdAt).toISOString(),
    generatorVersion: value.generatorVersion,
    seed: value.seed.trim(),
    variant: value.variant,
    colors: value.colors.slice(),
    paletteName: value.paletteName.trim(),
    ...(value.nameEdited !== undefined ? { nameEdited: value.nameEdited } : {}),
    ...(value.iconKey !== undefined ? { iconKey: value.iconKey } : {}),
    ...(value.hexEdits !== undefined ? { hexEdits: validateHexEdits(value.hexEdits) } : {}),
  };
}

export function createCampaign(world, colors, paletteName, variant = 0) {
  return validateCampaign({
    id: crypto.randomUUID(),
    name: world.name,
    nameEdited: false,
    createdAt: new Date().toISOString(),
    generatorVersion: world.generatorVersion,
    seed: world.seed,
    variant,
    colors,
    paletteName,
    iconKey: chooseCampaignIcon(world),
  });
}

export function campaignIconCandidates(world) {
  return world.cells.filter(
    (cell) =>
      cell.water !== 'ocean' &&
      cell.water !== 'lake' &&
      (cell.terrain !== 'meadow' ||
        cell.pointOfLight ||
        cell.pointsOfInterest?.length ||
        cell.crossing),
  );
}

export function chooseCampaignIcon(world, previousKey, random = Math.random) {
  const eligible = campaignIconCandidates(world);
  const alternatives = eligible.filter((cell) => cell.key !== previousKey);
  const landmark = (cell) => cell.pointOfLight || cell.pointsOfInterest?.length;
  const landmarks = alternatives.filter(landmark);
  let candidates = landmarks;
  if (previousKey !== undefined) {
    const terrain = alternatives.filter((cell) => !landmark(cell));
    // Roll the pool first, so its size cannot bias the 50/50 split.
    const pools = random() < 0.5 ? [landmarks, terrain] : [terrain, landmarks];
    candidates = pools.find((pool) => pool.length) ?? eligible;
  }
  return candidates.length ? candidates[Math.floor(random() * candidates.length)].key : undefined;
}

export function replaceCampaignMap(campaign, world, previousWorldName) {
  const nameEdited = campaign.nameEdited ?? campaign.name !== previousWorldName;
  const { hexEdits: _previousEdits, ...record } = campaign;
  return validateCampaign({
    ...record,
    name: nameEdited ? campaign.name : world.name,
    nameEdited,
    seed: world.seed,
    generatorVersion: world.generatorVersion,
    variant: 0,
    iconKey: chooseCampaignIcon(world),
  });
}

export function exportCampaign(campaign, date = new Date()) {
  return JSON.stringify(
    {
      format: 'wilderness-almanac-campaign',
      version: 2,
      exportedAt: date.toISOString(),
      campaign: validateCampaign(campaign),
    },
    null,
    2,
  );
}

export function importCampaign(source) {
  if (new TextEncoder().encode(source).length > MAX_CAMPAIGN_BYTES)
    throw new Error('Choose a campaign JSON file smaller than 4 MB.');
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Wilderness Almanac campaign export.');
  }
  if (data?.format !== 'wilderness-almanac-campaign' || ![1, 2].includes(data.version))
    throw new Error('Choose a supported Wilderness Almanac campaign export.');
  const campaign = validateCampaign(data.campaign);
  if (campaign.hexEdits) campaignDressing(campaign, campaignWorld(campaign));
  return campaign;
}

export function campaignFilename(campaign, date = new Date()) {
  const name =
    campaign.name
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '') || 'campaign';
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
  return `wilderness-almanac-${name}-${day}.json`;
}

export function campaignStats(world) {
  const openWater = world.cells.filter((cell) => ['ocean', 'lake'].includes(cell.water)).length;
  const land = world.cells.filter((cell) => !cell.water).length;
  const waterPercent = Math.round((openWater / (openWater + land)) * 100);
  return {
    settlements: world.settlements.length,
    pois: world.pointsOfInterest.length,
    openWater,
    land,
    waterPercent,
    landPercent: 100 - waterPercent,
  };
}

export function findCampaignReplay(campaigns, state) {
  const matches = (campaign) =>
    campaign.seed === state.seed &&
    campaign.variant === state.variant &&
    campaign.colors.every(
      (color, index) => color.toLowerCase() === state.colors[index].toLowerCase(),
    );
  return (
    campaigns.find((campaign) => campaign.id === state.campaignId && matches(campaign)) ??
    campaigns.find(matches)
  );
}
