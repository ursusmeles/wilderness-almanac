// Browser fixtures write current IndexedDB records directly; no historical
// localStorage writer or application migration is involved.
export async function seedCampaigns(page, campaigns, preferences = {}) {
  await page.evaluate(
    async ({ campaigns, preferences }) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('wilderness-almanac:campaigns', 1);
        request.onupgradeneeded = () => {
          for (const name of ['campaigns', 'palettes', 'settings', 'recovery', 'journal']) {
            const store = request.result.createObjectStore(name, {
              keyPath: name === 'journal' ? ['campaignId', 'id'] : 'id',
            });
            if (name === 'journal') store.createIndex('campaign', 'campaignId');
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      try {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(['campaigns', 'settings', 'palettes', 'journal'], 'readwrite');
          for (const name of ['campaigns', 'settings', 'palettes', 'journal'])
            tx.objectStore(name).clear();
          for (const campaign of campaigns)
            tx.objectStore('campaigns').put({ id: campaign.id, revision: 1, value: campaign });
          const palettes = preferences.palettes ?? [];
          for (const palette of palettes)
            tx.objectStore('palettes').put({ id: palette.id, revision: 1, value: palette });
          const settings = tx.objectStore('settings');
          settings.put({ id: 'library', revision: 1, value: campaigns.map(({ id }) => id) });
          settings.put({
            id: 'palettes',
            revision: 1,
            value: {
              ids: palettes.map(({ id }) => id),
              defaultPalette: preferences.defaultPalette ?? 'classic',
            },
          });
          settings.put({ id: 'clock', value: 1 });
          if (preferences.campaignId)
            settings.put({ id: 'activeCampaign', value: preferences.campaignId });
          tx.oncomplete = resolve;
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { campaigns, preferences },
  );
}
