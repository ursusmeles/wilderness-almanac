import { generateWorld } from '../generation/world.js';
import {
  campaignWorld,
  campaignDressing,
  updateHex,
  updateHexes,
  lockHex,
} from '../generation/campaign-world.js';
import { validateHexEdits } from '../generation/hex-edits.js';
import { replaceCampaignMap } from './campaigns.js';
import { settlementJoin, joinSettlements } from '../generation/settlement-edits.js';
import { hexAddress } from '../generation/hex.js';
import { initialPartyToken, PARTY_STYLES } from './party-token.js';

// Own campaign transitions and history independently of DOM, rendering and storage.
// The persistence adapter reports failures; a failed write keeps the live edits.
export function createCampaignSession({ persist }) {
  let state;
  let history = [];
  let selected = '0,0';
  let multiEdit = false;
  let selectedKeys = new Set();
  const snapshot = () =>
    state && {
      ...state,
      selected,
      multiEdit,
      selectedKeys: [...selectedKeys],
      join: multiEdit ? settlementJoin(state.world, selectedKeys) : null,
      canUndo: history.length > 0,
    };
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
    history.push({
      variant: state.campaign.variant,
      hexEdits: state.campaign.hexEdits,
      partyKey: state.campaign.partyToken.key,
    });
    if (history.length > 20) history.shift();
  }
  function transition(
    next,
    { scope = 'world', notification, relock = [], rerollKey, validateKeys = [selected] } = {},
  ) {
    try {
      const world = scope === 'tracking' ? state.world : campaignWorld(next, state.baseWorld);
      if (scope !== 'tracking')
        for (const key of validateKeys) {
          const request = next.hexEdits?.cells[key]?.crossing;
          if (request && world.cells.find((cell) => cell.key === key)?.crossing?.kind !== request)
            throw new Error(
              `${hexAddress(world.cells.find((cell) => cell.key === key))}: A crossing needs two usable banks. Try another river hex.`,
            );
        }
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
          version: next.hexEdits.version,
          cells: { [rerollKey]: edit },
        }).cells[rerollKey];
      }
      for (const key of relock) next = lockHex(next, key, world, dressing);
      remember();
      state = { ...state, campaign: next, world, dressing };
      save();
      return result(scope, notification);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  function open(
    campaign,
    baseWorld = generateWorld(campaign.seed, {
      preferences: campaign.preferences,
      generatorVersion: campaign.generatorVersion,
    }),
  ) {
    const world = campaignWorld(campaign, baseWorld);
    const dressing = campaignDressing(campaign, world);
    let record = {
      ...campaign,
      colors: campaign.colors.slice(),
      nameEdited: campaign.nameEdited ?? campaign.name !== world.name,
      partyToken: campaign.partyToken ?? initialPartyToken(world),
    };
    if (!campaign.partyToken) record = updateHex(record, record.partyToken.key, { visited: true });
    state = { campaign: record, baseWorld, world, dressing };
    history = [];
    multiEdit = false;
    selectedKeys = new Set();
    if (!world.cells.some((cell) => cell.key === selected)) selected = world.cells[0].key;
    save();
    return result('open');
  }
  return {
    snapshot,
    save,
    open,
    moveParty(key) {
      if (!state.world.cells.some((cell) => cell.key === key)) return { ok: false };
      const next = updateHex(
        { ...state.campaign, partyToken: { ...state.campaign.partyToken, key } },
        key,
        { visited: true },
      );
      return transition(next, { scope: 'tracking' });
    },
    partyStyle(style) {
      if (!PARTY_STYLES.includes(style)) return { ok: false };
      state = {
        ...state,
        campaign: { ...state.campaign, partyToken: { ...state.campaign.partyToken, style } },
      };
      save();
      return result('tracking');
    },
    select(key) {
      if (!state?.world.cells.some((cell) => cell.key === key)) return false;
      selected = key;
      if (multiEdit) {
        if (selectedKeys.has(key)) selectedKeys.delete(key);
        else selectedKeys.add(key);
      }
      return true;
    },
    setMultiEdit(enabled) {
      multiEdit = Boolean(enabled);
      selectedKeys = new Set(multiEdit ? [selected] : []);
    },
    selectAll() {
      if (multiEdit) selectedKeys = new Set(state.world.cells.map((cell) => cell.key));
    },
    clearSelection() {
      selectedKeys = new Set();
    },
    replace(seed, { confirmed = false } = {}) {
      if (!confirmed && Object.keys(state.campaign.hexEdits?.cells ?? {}).length)
        return { ok: false, requiresConfirmation: true };
      const base = generateWorld(seed, { preferences: state.campaign.preferences });
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
        const relock = state.campaign.hexEdits?.cells[selected]?.lock ? [selected] : [];
        return transition(updateHex(state.campaign, selected, patch), {
          relock,
          notification: relock.length ? 'Hex updated and dressing relocked' : 'Hex updated',
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    applyBatch(patch) {
      try {
        if (!multiEdit || !selectedKeys.size) throw new Error('Select at least one hex to edit.');
        if (!Object.keys(patch).length) throw new Error('Choose at least one field to change.');
        const patches = {};
        // Topology order makes the result independent of click order.
        const cells = state.world.cells.filter((cell) => selectedKeys.has(cell.key));
        const relock = [];
        for (const cell of cells) {
          const edit = { ...patch };
          const terrain = edit.terrain ?? cell.terrain;
          const water = ['river', 'open water'].includes(terrain);
          if (edit.terrain !== undefined) {
            if (water) {
              edit.elevation = 0;
              edit.settlement = null;
            }
            if (terrain === 'open water') edit.poi = null;
            if (terrain !== 'river') edit.crossing = null;
            if (terrain === 'mountains') edit.elevation = 4;
          } else if (edit.elevation !== undefined && (water || terrain === 'mountains')) {
            throw new Error(
              `${hexAddress(cell)}: Water and mountains have fixed elevation. Choose another terrain first.`,
            );
          }
          if (patch.settlement && water)
            throw new Error(
              `${hexAddress(cell)}: Water cannot contain settlements. Choose land terrain first.`,
            );
          if (patch.poi && terrain === 'open water')
            throw new Error(
              `${hexAddress(cell)}: Open water cannot contain points of interest. Choose land terrain first.`,
            );
          if (patch.crossing && terrain !== 'river')
            throw new Error(
              `${hexAddress(cell)}: Crossings can only be placed on rivers. Select a river hex.`,
            );
          if (
            state.campaign.hexEdits?.cells[cell.key]?.lock &&
            ['terrain', 'elevation', 'settlement', 'poi', 'crossing'].some((field) =>
              Object.hasOwn(edit, field),
            )
          )
            relock.push(cell.key);
          patches[cell.key] = edit;
        }
        const trackingOnly = Object.keys(patch).every((field) => field === 'visited');
        return transition(updateHexes(state.campaign, patches, state.baseWorld), {
          scope: trackingOnly ? 'tracking' : 'world',
          relock,
          validateKeys: cells.map((cell) => cell.key),
          notification: `${cells.length} ${cells.length === 1 ? 'hex' : 'hexes'} updated`,
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    joinSelection() {
      try {
        if (!multiEdit) throw new Error('Turn on multi edit to join settlements.');
        const next = joinSettlements(state.campaign, state.world, selectedKeys, state.baseWorld);
        const relock = [...selectedKeys].filter((key) => state.campaign.hexEdits?.cells[key]?.lock);
        return transition(next, {
          relock,
          validateKeys: [...selectedKeys],
          notification: 'Settlement joined',
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
    resetSelected({ confirmed = false } = {}) {
      if (!multiEdit || !selectedKeys.size)
        return { ok: false, error: 'Select at least one hex to reset.' };
      if (!confirmed) return { ok: false, requiresConfirmation: true };
      try {
        let next = updateHexes(
          state.campaign,
          Object.fromEntries([...selectedKeys].map((key) => [key, null])),
          state.baseWorld,
        );
        if (!Object.keys(next.hexEdits.cells).length) {
          const { hexEdits: _edits, ...record } = next;
          next = record;
        }
        return transition(next, {
          validateKeys: [],
          notification: `${selectedKeys.size} ${selectedKeys.size === 1 ? 'hex' : 'hexes'} reset`,
        });
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    undo() {
      if (!history.length) return { ok: false };
      const { partyKey, ...previous } = history.at(-1);
      const campaign = {
        ...state.campaign,
        ...previous,
        partyToken: { ...state.campaign.partyToken, key: partyKey },
      };
      const world = campaignWorld(campaign, state.baseWorld);
      const dressing = campaignDressing(campaign, world);
      history.pop();
      state = { ...state, campaign, world, dressing };
      save();
      return result('world', 'Hex action undone');
    },
  };
}
