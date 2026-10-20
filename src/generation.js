// Public world-generation and campaign-editing API.
export { generateWorld, generateDressing } from './generation/world.js';
export {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
  inspectDistances,
} from './generation/campaign-world.js';
