import { generateWorld } from '../generation/world.js';
import { campaignWorld } from '../generation/campaign-world.js';
import { cloneTemplate } from './templates.js';
import { loadThumbnails } from './thumbnail-cache.js';
import { copyText, mapLink } from './map-link.js';
import { createCampaignStore } from './campaign-store.js';
import {
  createCampaign,
  campaignStats,
  importCampaign,
  exportCampaign,
  campaignFilename,
  findCampaignReplay,
  chooseCampaignIcon,
  MAX_CAMPAIGN_BYTES,
} from '../application/campaigns.js';

export function createCampaignMenu({ storage, previous, defaultPalette, onEnter, saveStatus }) {
  const menu = document.getElementById('campaign-menu');
  const list = document.getElementById('campaign-list');
  const newButton = document.getElementById('new-campaign');
  const status = document.getElementById('campaign-message');
  const fileInput = document.getElementById('campaign-file');
  const undoDelete = document.getElementById('undo-delete-campaign');
  const deleteDialog = document.getElementById('delete-campaign-dialog');
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  const cached = new Map();
  const store = createCampaignStore(storage);
  const campaigns = store.campaigns;
  let deletedCampaign = store.deletedCampaign;
  let storageAvailable = true;
  let pendingDeleteId;
  let opening = false;
  let releaseBusy = () => {};

  function hideIconControls(except) {
    list.querySelectorAll('.campaign-icon.is-revealed').forEach((icon) => {
      if (icon === except) return;
      icon.classList.remove('is-revealed');
      icon.querySelector('.campaign-icon-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  function recoveryNotice() {
    const { reason, readOnly, preservedCount, hasRecovery } = store.status();
    const message = document.getElementById('campaign-recovery-message');
    let text = '';
    if (reason === 'conflict')
      text =
        'Saved campaigns changed in another tab. Download your current campaigns before reloading this page.';
    else if (reason === 'unreadable')
      text =
        'Some saved data cannot be read by this version. It has been kept unchanged. New campaigns can only be kept in this session.';
    else if (readOnly)
      text =
        'Browser storage cannot be read. Download any campaigns you create before closing this page.';
    else if (preservedCount)
      text = `${preservedCount} saved ${preservedCount === 1 ? 'campaign cannot' : 'campaigns cannot'} be opened by this version. ${preservedCount === 1 ? 'Its' : 'Their'} data is preserved in your library.`;
    if (message.textContent !== text) message.textContent = text;
    document.getElementById('campaign-recovery').hidden = !message.textContent;
    document.getElementById('download-campaign-recovery').hidden = !hasRecovery;
  }

  function save() {
    storageAvailable = store.save(campaigns, deletedCampaign);
    saveStatus.update('campaigns', storageAvailable);
    recoveryNotice();
    undoDelete.hidden = !deletedCampaign;
    return storageAvailable;
  }

  function expireUndo() {
    if (!deletedCampaign) return;
    deletedCampaign = null;
    status.textContent = '';
    save();
  }

  recoveryNotice();
  if (store.missing) {
    if (previous.seed) {
      const world = generateWorld(previous.seed);
      campaigns.push(
        createCampaign(world, previous.colors, previous.paletteName, previous.variant),
      );
    }
    save();
  }

  function campaignData(campaign) {
    const signature = JSON.stringify([campaign.seed, campaign.variant, campaign.hexEdits]);
    let data = cached.get(campaign.id);
    if (data?.signature !== signature) {
      const world = campaignWorld(campaign);
      data = {
        signature,
        world,
        stats: campaignStats(world),
      };
      cached.set(campaign.id, data);
    }
    if (!data.world.cells.some((cell) => cell.key === campaign.iconKey)) {
      campaign.iconKey = chooseCampaignIcon(data.world);
      save();
    }
    return data;
  }

  async function paintIcon(card, campaign, ready) {
    const request = {};
    card.iconRequest = request;
    const shuffle = card.querySelector('[data-action="shuffle"]');
    if (!ready) shuffle.disabled = true;
    const images = ready ?? (await loadThumbnails(campaign, { allowStale: true }));
    if (!card.isConnected || card.iconRequest !== request) return;
    card.iconEntries = images;
    shuffle.disabled = opening || images.length < 2;
    shuffle.title =
      images.length === 0
        ? 'Open this campaign to prepare icon previews'
        : images.length === 1
          ? 'No other icon previews available'
          : 'Next cached world icon';
    const img = card.querySelector('.campaign-icon img');
    const placeholder = card.querySelector('.campaign-icon-placeholder');
    const previous =
      card.dataset.iconSeed === campaign.seed && img.dataset.hexKey === campaign.iconKey
        ? img.getAttribute('src')
        : '';
    const image = images.find((entry) => entry.key === campaign.iconKey)?.image || previous;
    img.alt = `Terrain hex from ${campaign.name}`;
    if (image) {
      img.src = image;
      img.dataset.hexKey = campaign.iconKey ?? '';
      card.dataset.iconSeed = campaign.seed;
    } else {
      img.removeAttribute('src');
      delete img.dataset.hexKey;
      delete card.dataset.iconSeed;
    }
    img.hidden = !image;
    placeholder.hidden = Boolean(image);
  }

  function labelActions(card, campaign) {
    card.querySelector('[data-action="share"]').title =
      'Copy seed link. Transfer hex edits with campaign JSON.';
    for (const [action, label] of [
      ['enter', 'Enter'],
      ['download', 'Download JSON for'],
      ['delete', 'Delete'],
      ['shuffle', 'Next icon for'],
      ['icon-controls', 'Show icon controls for'],
    ])
      card
        .querySelector(`[data-action="${action}"]`)
        .setAttribute('aria-label', `${label} ${campaign.name}`);
  }

  function render() {
    const existing = new Map([...list.children].map((card) => [card.dataset.id, card]));
    const cards = [];
    document.getElementById('campaign-count').textContent = campaigns.length;
    for (const campaign of campaigns) {
      const data = campaignData(campaign);
      const card =
        existing.get(campaign.id) ?? cloneTemplate('campaign-template').firstElementChild;
      card.dataset.id = campaign.id;
      const name = card.querySelector('.campaign-name');
      name.value = campaign.name;
      name.setAttribute('aria-label', `Campaign name: ${campaign.name}`);
      name.title = 'Edit campaign name';

      card.querySelector('.campaign-date').dateTime = campaign.createdAt;
      card.querySelector('.campaign-date').textContent = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(new Date(campaign.createdAt));
      card.querySelector('.campaign-palette').textContent = campaign.paletteName;
      card.querySelector('.campaign-settlements').textContent = data.stats.settlements;
      card.querySelector('.campaign-pois').textContent = data.stats.pois;
      const ratio = card.querySelector('.campaign-ratio');
      ratio.querySelector('dd').textContent =
        `${data.stats.waterPercent}% / ${data.stats.landPercent}%`;
      ratio.title = `${data.stats.openWater} ocean/lake hexes : ${data.stats.land} land hexes (river channels excluded)`;
      card.querySelector('.campaign-seed').textContent = campaign.seed;
      card.querySelector('.campaign-seed').title = campaign.seed;
      labelActions(card, campaign);
      cards.push(card);
      void paintIcon(card, campaign);
    }
    list.replaceChildren(...cards);
  }

  function add(campaign) {
    expireUndo();
    campaigns.push(campaign);
    save();
  }

  async function enter(campaign, button = newButton) {
    if (opening || menu.hidden || listeners.signal.aborted) return false;
    opening = true;
    const creating = !campaign;
    const controls = [...menu.querySelectorAll('button, input')].map((control) => [
      control,
      control.disabled,
    ]);
    const label = button.getAttribute('aria-label');
    const title = newButton.querySelector('strong');
    const originalTitle = title.textContent;
    releaseBusy = () => {
      for (const [control, disabled] of controls) control.disabled = disabled;
      button.removeAttribute('aria-busy');
      if (label === null) button.removeAttribute('aria-label');
      else button.setAttribute('aria-label', label);
      title.textContent = originalTitle;
      opening = false;
      releaseBusy = () => {};
    };
    for (const [control] of controls) control.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (button === newButton)
      title.textContent = creating ? 'Creating campaign…' : 'Opening campaign…';
    else button.setAttribute('aria-label', `Opening ${campaign.name}…`);
    expireUndo();
    status.textContent = creating ? 'Creating your campaign…' : 'Opening campaign…';
    try {
      // Two frames guarantee feedback paints before synchronous generation/WebGL work.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (listeners.signal.aborted) return false;
      if (creating) {
        const world = generateWorld(crypto.randomUUID());
        campaign = createCampaign(world, defaultPalette.colors, defaultPalette.paletteName);
        add(campaign);
      }
      return (await onEnter(campaign)) !== false;
    } catch (error) {
      if (!listeners.signal.aborted) {
        menu.hidden = false;
        render();
        status.textContent = `Could not ${creating ? 'create the campaign' : 'open the map'}. ${error.message}`;
      }
      return false;
    } finally {
      if (!listeners.signal.aborted) releaseBusy();
    }
  }

  function downloadFile(source, filename) {
    const blob = new Blob([source], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download(campaign) {
    const date = new Date();
    downloadFile(exportCampaign(campaign, date), campaignFilename(campaign, date));
    status.textContent = `Downloaded “${campaign.name}”`;
  }

  listen(document.getElementById('download-campaign-recovery'), 'click', () => {
    const source = store.recovery();
    if (source == null) return;
    downloadFile(source, campaignFilename({ name: 'recovery' }));
    status.textContent = 'Recovery file downloaded. Keep it with your campaign backups.';
  });

  function rename(input) {
    expireUndo();
    const campaign = campaigns.find(
      (item) => item.id === input.closest('.campaign-card').dataset.id,
    );
    const name = input.value.trim();
    if (!name) {
      input.value = campaign.name;
      return;
    }
    if (name !== campaign.name) campaign.nameEdited = true;
    campaign.name = name;
    input.value = name;
    input.setAttribute('aria-label', `Campaign name: ${name}`);
    const card = input.closest('.campaign-card');
    labelActions(card, campaign);
    card.querySelector('.campaign-icon img').alt =
      `${cached.get(campaign.id)?.tile?.terrain ?? 'Terrain'} hex from ${name}`;
    if (save()) status.textContent = 'Campaign name saved';
  }

  listen(list, 'change', (event) => {
    if (event.target.matches('.campaign-name')) rename(event.target);
  });
  listen(list, 'submit', (event) => {
    event.preventDefault();
    const input = event.target.querySelector('input');
    rename(input);
    input.blur();
  });
  listen(list, 'keydown', (event) => {
    if (event.key === 'Escape') hideIconControls();
    if (event.key === 'Escape' && event.target.matches('.campaign-name')) {
      const campaign = campaigns.find(
        (item) => item.id === event.target.closest('.campaign-card').dataset.id,
      );
      event.target.value = campaign.name;
      event.target.blur();
    }
  });
  listen(list, 'click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || opening || menu.hidden) return;
    const campaign = campaigns.find(
      (item) => item.id === button.closest('.campaign-card').dataset.id,
    );
    const action = button.dataset.action;
    expireUndo();
    if (action === 'icon-controls') {
      const icon = button.closest('.campaign-icon');
      hideIconControls(icon);
      const revealed = icon.classList.toggle('is-revealed');
      button.setAttribute('aria-expanded', String(revealed));
      return;
    }
    if (action === 'enter') return enter(campaign, button);
    if (action === 'download') return download(campaign);
    if (action === 'shuffle') {
      const card = button.closest('.campaign-card');
      const images = card.iconEntries ?? [];
      if (images.length < 2) return;
      const index = images.findIndex((entry) => entry.key === campaign.iconKey);
      campaign.iconKey = images[(index + 1) % images.length].key;
      const saved = save();
      void paintIcon(card, campaign, images);
      if (saved) status.textContent = 'Campaign icon updated';
      return;
    }
    if (action === 'delete') {
      pendingDeleteId = campaign.id;
      document.getElementById('delete-campaign-name').textContent = campaign.name;
      deleteDialog.returnValue = 'cancel';
      deleteDialog.showModal();
      return;
    }
    try {
      await copyText(action === 'copy' ? campaign.seed : mapLink(window.location.href, campaign));
      status.textContent = action === 'copy' ? 'Seed copied' : 'Map link copied';
    } catch {
      status.textContent =
        action === 'copy'
          ? 'Could not copy. Select the seed text to copy it.'
          : 'Could not copy a link. Enter the campaign and copy the URL from the address bar.';
    }
  });
  listen(document, 'click', (event) => {
    if (!event.target.closest('.campaign-icon')) hideIconControls();
  });
  listen(deleteDialog, 'close', () => {
    const index = campaigns.findIndex((item) => item.id === pendingDeleteId);
    pendingDeleteId = null;
    if (deleteDialog.returnValue !== 'delete' || index < 0) return;
    const [campaign] = campaigns.splice(index, 1);
    deletedCampaign = { campaign, index };
    cached.delete(campaign.id);
    const saved = save();
    render();
    if (saved) status.textContent = `Deleted “${campaign.name}”`;
    undoDelete.focus({ preventScroll: true });
  });
  listen(undoDelete, 'click', () => {
    if (!deletedCampaign) return;
    const { campaign, index } = deletedCampaign;
    campaigns.splice(Math.min(index, campaigns.length), 0, campaign);
    deletedCampaign = null;
    const saved = save();
    render();
    if (saved) status.textContent = `Restored “${campaign.name}”`;
    list
      .querySelectorAll('[data-action="delete"]')
      [Math.min(index, campaigns.length - 1)]?.focus({ preventScroll: true });
  });
  listen(newButton, 'click', () => enter());
  listen(document.getElementById('import-campaign'), 'click', () => {
    expireUndo();
    fileInput.click();
  });
  listen(fileInput, 'change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > MAX_CAMPAIGN_BYTES)
        throw new Error('Choose a campaign JSON file smaller than 4 MB.');
      const campaign = importCampaign(await file.text());
      // Import as a separate local save; an existing campaign is never overwritten.
      campaign.id = crypto.randomUUID();
      add(campaign);
      render();
      if (storageAvailable) status.textContent = `Imported “${campaign.name}”`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      fileInput.value = '';
    }
  });

  return {
    add,
    enter,
    download,
    refreshThumbnail(campaign) {
      const card = [...list.children].find((card) => card.dataset.id === campaign.id);
      const current = campaigns.find((item) => item.id === campaign.id);
      if (card && current) void paintIcon(card, current);
    },
    findReplay(state) {
      return findCampaignReplay(campaigns, state);
    },
    update(campaign) {
      const index = campaigns.findIndex((item) => item.id === campaign.id);
      if (index >= 0) campaigns[index] = { ...campaign, colors: campaign.colors.slice() };
      return save();
    },
    show() {
      menu.hidden = false;
      render();
      undoDelete.hidden = !deletedCampaign;
      if (storageAvailable)
        status.textContent = deletedCampaign ? `Deleted “${deletedCampaign.campaign.name}”` : '';
    },
    dispose() {
      releaseBusy();
      listeners.abort();
    },
  };
}
