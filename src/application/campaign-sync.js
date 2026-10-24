import { validateCampaign } from './campaigns.js';

export async function campaignHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateCampaign(value)));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, '0')).join('');
}

// Explicit transfers keep IndexedDB authoritative for active/offline work.
// No timestamp-based merges, unconditional writes, or automatic deletions.
export function createCampaignSync({ client, store, library, accountId }) {
  async function remember(campaign, revision, expected) {
    return store.rememberRemote(
      accountId,
      campaign.id,
      {
        remoteRevision: revision,
        hash: await campaignHash(campaign),
      },
      expected,
    );
  }
  return {
    async upload(localId) {
      const value = library.snapshotCampaigns().find(({ id }) => id === localId);
      if (!value) throw new Error('The local campaign no longer exists.');
      const campaign = validateCampaign(value);
      const state = await store.remoteState(accountId, localId);
      const result = await client.put(campaign, state?.value.remoteRevision ?? 0);
      // Only acknowledge the exact snapshot sent, even if local work changes
      // during the request. A failed metadata commit never permits a force save.
      await remember(campaign, result.revision, state);
      return result;
    },
    async load(remoteId, { asCopy = false } = {}) {
      const result = await client.get(remoteId);
      const campaign = validateCampaign(result.campaign);
      if (campaign.id !== remoteId)
        throw new Error('The account server returned a different campaign.');
      if (asCopy) {
        const copy = { ...campaign, id: crypto.randomUUID() };
        await library.applyRemote(copy);
        return copy;
      }
      const current = library.snapshotCampaigns().find(({ id }) => id === remoteId) ?? null;
      const state = await store.remoteState(accountId, remoteId);
      const remoteHash = await campaignHash(campaign);
      if (current) {
        const localHash = await campaignHash(current);
        if (localHash !== remoteHash && localHash !== state?.value.hash)
          throw new Error(
            'This device has unsynced changes. Export them or import the account version as a separate copy.',
          );
      }
      await library.applyRemote(campaign, current);
      await remember(campaign, result.revision, state);
      return campaign;
    },
  };
}
