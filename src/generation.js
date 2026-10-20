// Public generation API. The legacy demo remains available for future terrain stages.
export { generateWorld, generateDressing } from './generation/world.js';
export {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
  inspectDistances,
} from './generation/campaign-world.js';
export * from './generation/legacy.js';
