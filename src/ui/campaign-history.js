import { mapLink } from './map-link.js';

const replayKeys = ['seed', 'variant', 'colors', 'generator', 'world'];

// Keep the library behind campaign entries, including a directly opened replay.
export function createCampaignHistory({ onNavigate, hasCampaign }) {
  const initial = new URL(window.location.href);
  const match = initial.pathname.match(/^(.*)\/campaign\/([^/]+)\/?$/);
  let initialCampaignId;
  try {
    initialCampaignId = match ? decodeURIComponent(match[2]) : undefined;
  } catch {
    /* Invalid route. */
  }
  const menuURL = new URL(initial);
  if (match) menuURL.pathname = `${match[1]}/`;
  for (const key of replayKeys) menuURL.searchParams.delete(key);
  menuURL.hash = '';
  let index = 0,
    campaignId = null,
    restoring = false,
    disposed = false,
    navigating = false;
  let queued = Promise.resolve();
  const state = (position, id) => ({
    ...history.state,
    almanac: { index: position, campaignId: id },
  });
  const write = (method, position, id, url) => {
    try {
      history[method](state(position, id), '', url);
      return true;
    } catch {
      return false; /* Some embedded browsers restrict history. */
    }
  };
  const previous = history.state?.almanac;
  if (
    match &&
    previous?.campaignId === initialCampaignId &&
    Number.isSafeInteger(previous.index) &&
    previous.index > 0 &&
    hasCampaign(initialCampaignId)
  ) {
    index = previous.index;
    campaignId = initialCampaignId;
  } else write('replaceState', 0, null, menuURL);
  const campaignURL = (campaign) => {
    const url = new URL(menuURL);
    url.pathname = `${menuURL.pathname.replace(/\/$/, '')}/campaign/${encodeURIComponent(campaign.id)}`;
    return mapLink(url, campaign);
  };
  function pop(event) {
    if (disposed) return;
    if (restoring) {
      restoring = false;
      return;
    }
    const target = event.state?.almanac;
    if (!target || !Number.isSafeInteger(target.index)) return;
    queued = queued
      .then(async () => {
        if (disposed) return;
        const delta = target.index - index;
        navigating = true;
        let accepted = false;
        try {
          accepted = await onNavigate(target.campaignId, () => history.go(delta));
        } finally {
          navigating = false;
          if (accepted) {
            index = target.index;
            campaignId = target.campaignId;
          } else if (delta) {
            restoring = true;
            history.go(-delta);
          }
        }
      })
      .catch(() => {});
  }
  window.addEventListener('popstate', pop);
  return {
    initialCampaignId,
    enter(campaign) {
      const next = campaignId === campaign.id ? index : index + 1;
      const method = next === index ? 'replaceState' : 'pushState';
      if (write(method, next, campaign.id, campaignURL(campaign))) {
        index = next;
        campaignId = campaign.id;
      }
    },
    update(campaign) {
      if (
        navigating ||
        campaignId !== campaign.id ||
        history.state?.almanac?.campaignId !== campaign.id
      )
        return;
      write('replaceState', index, campaignId, campaignURL(campaign));
    },
    back() {
      if (index > 0) history.back();
      else void onNavigate(null, () => {});
    },
    dispose() {
      disposed = true;
      window.removeEventListener('popstate', pop);
    },
  };
}
