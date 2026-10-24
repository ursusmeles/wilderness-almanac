// Legacy preference codec retained for migration fixtures and older saves.
// Runtime UI preferences use the explicit allowlist in ui-preferences.js.
export { readPreferences, savePreferences } from '../persistence/legacy-preferences.js';
