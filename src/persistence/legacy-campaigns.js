import { validateCampaign } from '../application/campaigns.js';

const KEY = 'wilderness-almanac:campaigns-v1';
const validateDeleted = (value) => {
  if (value == null) return null;
  if (!Number.isSafeInteger(value.index) || value.index < 0)
    throw new Error('Invalid deleted campaign');
  return { campaign: validateCampaign(value.campaign), index: value.index };
};

// Keep unreadable records in their original envelope. Unknown/broken envelopes
// are read-only; check for newer data from another tab before each write.
export function createCampaignStore(storage) {
  let source;
  let envelope;
  let reason = null;
  let readonly = false;
  const campaigns = [];
  const preserved = [];
  const extras = new Map();
  const retainExtras = (raw, campaign) => {
    extras.set(
      campaign.id,
      Object.fromEntries(Object.entries(raw).filter(([key]) => !Object.hasOwn(campaign, key))),
    );
  };
  const serializeCampaign = (campaign) => ({
    ...extras.get(campaign.id),
    ...validateCampaign(campaign),
  });
  let deletedCampaign = null;
  let missing = false;
  try {
    source = storage.getItem(KEY) ?? null;
    missing = source === null;
    if (!missing) {
      envelope = JSON.parse(source);
      if (envelope?.version !== 1 || !Array.isArray(envelope.campaigns))
        throw new Error('Unsupported campaign library');
      const ids = new Set();
      for (const raw of envelope.campaigns) {
        try {
          const campaign = validateCampaign(raw);
          if (ids.has(campaign.id)) throw new Error('Duplicate campaign');
          ids.add(campaign.id);
          retainExtras(raw, campaign);
          campaigns.push(campaign);
        } catch {
          preserved.push(raw);
        }
      }
      deletedCampaign = validateDeleted(envelope.deletedCampaign);
      if (deletedCampaign) {
        if (ids.has(deletedCampaign.campaign.id)) throw new Error('Ambiguous deleted campaign');
        retainExtras(envelope.deletedCampaign.campaign, deletedCampaign.campaign);
      }
    }
  } catch {
    deletedCampaign = null;
    readonly = true;
    reason = source === undefined ? 'unavailable' : 'unreadable';
  }

  return {
    campaigns,
    deletedCampaign,
    missing,
    status: () => ({
      reason,
      readOnly: readonly,
      preservedCount: preserved.length,
      hasRecovery: source != null,
    }),
    recovery: () => source,
    save(nextCampaigns, nextDeleted = null) {
      if (readonly) return false;
      try {
        if ((storage.getItem(KEY) ?? null) !== source) {
          reason = 'conflict';
          return false;
        }
        const deleted = validateDeleted(nextDeleted);
        const next = {
          ...envelope,
          version: 1,
          campaigns: [...nextCampaigns.map(serializeCampaign), ...preserved],
          deletedCampaign: deleted
            ? { ...deleted, campaign: serializeCampaign(deleted.campaign) }
            : null,
        };
        const serialized = JSON.stringify(next);
        storage.setItem(KEY, serialized);
        source = serialized;
        envelope = next;
        reason = null;
        return true;
      } catch {
        reason = 'unavailable';
        return false;
      }
    },
  };
}
