import { generateWorld } from '../generation/world.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  lockHex,
} from '../generation/campaign-world.js';
import { validateHexEdits } from '../generation/hex-edits.js';
import { replaceCampaignMap } from './campaigns.js';

// Own campaign transitions and history independently of DOM, rendering and storage.
// The persistence adapter reports failures; a failed write keeps the live edits.
export function createCampaignSession({ persist }) {
  let state;
  let history = [];
  let selected = '0,0';
  const snapshot = () => state && { ...state, selected, canUndo: history.length > 0 };
  function save() {
    if (!state) return { campaignSaved: true, preferencesSaved: true, saved: true };
    let result;
    try {
      result = persist(state.campaign);
    } catch (error) {
      result = { campaignSaved: false, preferencesSaved: false, error: error.message };
    }
    const persistence = { ...result, saved: result.campaignSaved && result.preferencesSaved };
    state = { ...state, persistence };
    return persistence;
  }
  const result = (scope, notification) => ({ ok: true, scope, notification, state: snapshot() });
  function remember() {
    history.push({ variant: state.campaign.variant, hexEdits: state.campaign.hexEdits });
    if (history.length > 20) history.shift();
  }
  function transition(next, { scope = 'world', notification, relock = false, rerollKey } = {}) {
    try {
      const world = scope === 'tracking' ? state.world : campaignWorld(next, state.baseWorld);
      const request = next.hexEdits?.cells[selected]?.crossing;
      if (
        scope !== 'tracking' &&
        request &&
        world.cells.find((cell) => cell.key === selected)?.crossing?.kind !== request
      )
        throw new Error(
          'This river hex has no two usable banks for a crossing. Try a neighbouring river hex.',
        );
      const dressing =
        scope === 'tracking'
          ? state.dressing
          : campaignDressing(next, world, {
              fixedCells: rerollKey
                ? Object.fromEntries(
                    state.dressing.cells
                      .filter((cell) => cell.key !== rerollKey)
                      .map((cell) => [cell.key, cell]),
                  )
                : undefined,
              rerollKey,
              mountainBase: rerollKey ? state.dressing.mountains : [],
            });
      if (rerollKey) {
        const edit = next.hexEdits.cells[rerollKey];
        edit.dressing = structuredClone(dressing.cells.find((cell) => cell.key === rerollKey));
        const range = world.cells.find((cell) => cell.key === rerollKey)?.mountainRangeId;
        if (range)
          edit.dressing.mountain = dressing.mountains.find((shape) => shape.rangeId === range);
        edit.dressingVariant = next.variant;
        next.hexEdits.cells[rerollKey] = validateHexEdits({
          version: 1,
          cells: { [rerollKey]: edit },
        }).cells[rerollKey];
      }
      if (relock) next = lockHex(next, selected, world, dressing);
      remember();
      state = { ...state, campaign: next, world, dressing };
      save();
      return result(scope, notification);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  function open(campaign, baseWorld = generateWorld(campaign.seed)) {
    const world = campaignWorld(campaign, baseWorld);
    const dressing = campaignDressing(campaign, world);
    const record = {
      ...campaign,
      colors: campaign.colors.slice(),
      nameEdited: campaign.nameEdited ?? campaign.name !== world.name,
    };
    state = { campaign: record, baseWorld, world, dressing };
    history = [];
    if (!world.cells.some((cell) => cell.key === selected)) selected = world.cells[0].key;
    save();
    return result('open');
  }
  return {
    snapshot,
    save,
    open,
    select(key) {
      if (!state?.world.cells.some((cell) => cell.key === key)) return false;
      selected = key;
      return true;
    },
    replace(seed, { confirmed = false } = {}) {
      if (!confirmed && Object.keys(state.campaign.hexEdits?.cells ?? {}).length)
        return { ok: false, requiresConfirmation: true };
      const base = generateWorld(seed);
      const next = replaceCampaignMap(state.campaign, base, state.world.name);
      open(next, base);
      return result('open', 'New map created');
    },
    palette(colors, paletteName) {
      state = { ...state, campaign: { ...state.campaign, colors: colors.slice(), paletteName } };
      save();
      return result('palette', 'Palette changed');
    },
    icon() {
      state = { ...state, campaign: { ...state.campaign, iconKey: selected } };
      save();
      return result('icon', 'World icon updated');
    },
    apply(patch) {
      try {
        const relock = Boolean(state.campaign.hexEdits?.cells[selected]?.lock);
        return transition(updateHex(state.campaign, selected, patch), {
          relock,
          notification: relock ? 'Hex updated and dressing relocked' : 'Hex updated',
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    visit() {
      const visited = !state.campaign.hexEdits?.cells[selected]?.visited;
      return transition(updateHex(state.campaign, selected, { visited }), {
        scope: 'tracking',
        notification: visited ? 'Hex marked visited' : 'Hex marked not visited',
      });
    },
    lock() {
      const locked = Boolean(state.campaign.hexEdits?.cells[selected]?.lock);
      const next = locked
        ? updateHex(state.campaign, selected, {})
        : lockHex(state.campaign, selected, state.world, state.dressing);
      if (locked) {
        const edit = next.hexEdits.cells[selected];
        edit.dressing = structuredClone(edit.lock);
        edit.dressingVariant = next.variant;
        delete edit.lock;
      }
      return transition(next, {
        scope: 'tracking',
        notification: locked ? 'Dressing unlocked' : 'Dressing locked',
      });
    },
    regenerateHex() {
      if (state.campaign.hexEdits?.cells[selected]?.lock)
        return { ok: false, error: 'Unlock dressing to regenerate this hex.' };
      const revision = (state.campaign.hexEdits?.cells[selected]?.revision ?? 0) + 1;
      return transition(updateHex(state.campaign, selected, { revision }), {
        rerollKey: selected,
        notification: 'Hex dressing regenerated',
      });
    },
    regenerate() {
      return transition(
        { ...state.campaign, variant: state.campaign.variant + 1 },
        { notification: 'Dressing regenerated' },
      );
    },
    reset() {
      const next = updateHex(state.campaign, selected, {});
      const visited = next.hexEdits.cells[selected].visited;
      if (visited !== undefined) next.hexEdits.cells[selected] = { visited };
      else delete next.hexEdits.cells[selected];
      return transition(next, { notification: 'Hex reset to generated' });
    },
    undo() {
      if (!history.length) return { ok: false };
      const previous = history.at(-1);
      const campaign = { ...state.campaign, ...previous };
      const world = campaignWorld(campaign, state.baseWorld);
      const dressing = campaignDressing(campaign, world);
      history.pop();
      state = { ...state, campaign, world, dressing };
      save();
      return result('world', 'Hex action undone');
    },
  };
}
