// Public world-generation and campaign-editing API.
export { generateWorld, generateDressing } from './generation/world.js';
export { settlementJoin, joinSettlements } from './generation/settlement-edits.js';
export {
  campaignWorld,
  campaignDressing,
  updateHex,
  updateHexes,
  lockHex,
  inspectDistances,
} from './generation/campaign-world.js';

export { worldPreferences, DEFAULT_WORLD_PREFERENCES } from './generation/world-preferences.js';
