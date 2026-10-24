// Legacy-format compatibility for migration fixtures. Runtime saves use
// persistence/browser-store.js; never write this retired format from the UI.
export { createCampaignStore } from '../persistence/legacy-campaigns.js';
