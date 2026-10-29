import { SUPPORTED_GENERATOR_VERSIONS } from '../generation/world.js';
import { worldPreferences } from '../generation/world-preferences.js';
import { validateHexEdits } from '../generation/hex-edits.js';
import { campaignWorld, campaignDressing } from '../generation/campaign-world.js';
import { validatePartyToken } from './party-token.js';
import { TIMES_OF_DAY } from './time-of-day.js';
import { validateJournal } from './party-journal.js';
import { MAP_ART_STYLES, mapArtStyle } from './map-art-style.js';

export const MAX_CAMPAIGN_BYTES = 16 * 1024 * 1024;
const text = (value, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validDate = (value) =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

// Keep saves small: immutable worlds and dressing replay within a generator version.
// Only explicit fields survive import; imported data never becomes render geometry.
export function validateCampaign(value) {
  if (!SUPPORTED_GENERATOR_VERSIONS.includes(value?.generatorVersion))
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
    (value.fogOfWar !== undefined && typeof value.fogOfWar !== 'boolean') ||
    (value.timeOfDay !== undefined && !TIMES_OF_DAY.includes(value.timeOfDay)) ||
    (value.artStyle !== undefined && !MAP_ART_STYLES.includes(value.artStyle)) ||
    (value.nameEdited !== undefined && typeof value.nameEdited !== 'boolean') ||
    (value.journalSequence !== undefined &&
      (!Number.isSafeInteger(value.journalSequence) || value.journalSequence < 1)) ||
    (value.iconKey !== undefined &&
      (typeof value.iconKey !== 'string' || !/^-?\d{1,2},-?\d{1,2}$/.test(value.iconKey)))
  )
    throw new Error('The campaign file has missing or invalid campaign data.');
  const preferences = worldPreferences(value.preferences);
  if (value.generatorVersion === 6 && Object.values(preferences).some(Boolean))
    throw new Error('Version 6 maps do not support world preferences.');
  const journal = value.journal !== undefined ? validateJournal(value.journal) : undefined;
  if (value.journalSequence !== undefined && value.journalSequence < (journal?.at(-1)?.id ?? 0))
    throw new Error('The party journal has an invalid sequence.');
  if (journal?.some((entry) => entry.week > (value.partyToken?.weeks ?? 1)))
    throw new Error('The party journal contains a future journal period.');
  const campaign = {
    ...(value.preferences !== undefined ? { preferences } : {}),
    ...(value.fogOfWar !== undefined ? { fogOfWar: value.fogOfWar } : {}),
    ...(value.timeOfDay !== undefined ? { timeOfDay: value.timeOfDay } : {}),
    ...(value.artStyle !== undefined ? { artStyle: value.artStyle } : {}),
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
    ...(value.partyToken !== undefined ? { partyToken: validatePartyToken(value.partyToken) } : {}),
    ...(journal?.length ? { journal } : {}),
    ...(value.journalSequence !== undefined ? { journalSequence: value.journalSequence } : {}),
  };
  if (campaign.generatorVersion >= 10 && campaign.seed === 'heliotest') {
    const keys = [
      campaign.partyToken?.key,
      campaign.iconKey,
      ...Object.keys(campaign.hexEdits?.cells ?? {}),
    ].filter(Boolean);
    if (
      keys.some((key) => {
        const [q, r] = key.split(',').map(Number);
        return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 1;
      })
    )
      throw new Error('The campaign contains a hex outside the heliotest map.');
  }
  return campaign;
}

export function createCampaign(
  world,
  colors,
  paletteName,
  variant = 0,
  defaultTimeOfDay = 'dawn',
  artStyle = 'low-poly',
) {
  return validateCampaign({
    id: crypto.randomUUID(),
    name: world.name,
    nameEdited: false,
    createdAt: new Date().toISOString(),
    generatorVersion: world.generatorVersion,
    preferences: world.preferences,
    seed: world.seed,
    variant,
    colors,
    paletteName,
    timeOfDay: defaultTimeOfDay,
    artStyle,
    iconKey: chooseCampaignIcon(world),
  });
}

// Stable gallery: four settlements, four distinct POIs, then spare landmarks.
export function campaignIconCandidates(world) {
  const eligible = world.cells.filter(
    (cell) =>
      cell.water !== 'ocean' &&
      cell.water !== 'lake' &&
      (cell.terrain !== 'meadow' ||
        cell.pointOfLight ||
        cell.pointsOfInterest?.length ||
        cell.crossing),
  );
  const settlements = eligible.filter((cell) => cell.pointOfLight);
  const first = settlements.slice(0, 4);
  const pois = eligible.filter((cell) => cell.pointsOfInterest?.length);
  const selected = new Set(first.map((cell) => cell.key));
  const pool = [
    ...first,
    ...pois.filter((cell) => !selected.has(cell.key)).slice(0, 4),
    ...settlements,
    ...pois,
  ];
  const landmarks = [...new Map(pool.map((cell) => [cell.key, cell])).values()];
  return (landmarks.length ? landmarks : eligible).slice(0, 8);
}

export function chooseCampaignIcon(world) {
  return campaignIconCandidates(world)[0]?.key;
}

export function replaceCampaignMap(campaign, world, previousWorldName) {
  const nameEdited = campaign.nameEdited ?? campaign.name !== previousWorldName;
  const {
    hexEdits: _previousEdits,
    partyToken: _previousParty,
    journal: _previousJournal,
    journalSequence: _previousJournalSequence,
    ...record
  } = campaign;
  return validateCampaign({
    ...record,
    name: nameEdited ? campaign.name : world.name,
    nameEdited,
    seed: world.seed,
    generatorVersion: world.generatorVersion,
    preferences: world.preferences,
    variant: 0,
    iconKey: chooseCampaignIcon(world),
  });
}

export function exportCampaign(campaign, date = new Date()) {
  const source = JSON.stringify(
    {
      format: 'wilderness-almanac-campaign',
      version: campaign.journal?.length ? 3 : 2,
      exportedAt: date.toISOString(),
      campaign: validateCampaign(campaign),
    },
    null,
    2,
  );
  if (new TextEncoder().encode(source).length > MAX_CAMPAIGN_BYTES)
    throw new Error(
      'This campaign exceeds the 16 MB transfer limit. Download a recovery file to preserve all data.',
    );
  return source;
}

export function importCampaign(source) {
  if (new TextEncoder().encode(source).length > MAX_CAMPAIGN_BYTES)
    throw new Error('Choose a campaign JSON file smaller than 16 MB.');
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Wilderness Almanac campaign export.');
  }
  // Earlier product namespaces used the same versioned campaign envelope.
  // The full replay record and dressing remain subject to validation below.
  if (
    typeof data?.format !== 'string' ||
    !/^[a-z][a-z0-9-]{0,63}-campaign$/.test(data.format) ||
    ![1, 2, 3].includes(data.version)
  )
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
    campaign.generatorVersion === (state.generatorVersion ?? campaign.generatorVersion) &&
    JSON.stringify(worldPreferences(campaign.preferences)) ===
      JSON.stringify(worldPreferences(state.preferences)) &&
    campaign.seed === state.seed &&
    mapArtStyle(campaign.artStyle) === mapArtStyle(state.artStyle) &&
    campaign.variant === state.variant &&
    campaign.colors.every(
      (color, index) => color.toLowerCase() === state.colors[index].toLowerCase(),
    );
  return (
    campaigns.find((campaign) => campaign.id === state.campaignId && matches(campaign)) ??
    campaigns.find(matches)
  );
}
