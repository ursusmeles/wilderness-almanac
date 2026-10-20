import { generateWorld } from '../generation/world.js';
import { campaignWorld, campaignDressing } from '../generation/campaign-world.js';
import { prepareMap } from '../generation/presentation.js';
import { tilePreview } from './tile-preview.js';
import { copyText, mapLink } from './map-link.js';
import {
  readCampaigns,
  readDeletedCampaign,
  saveCampaigns,
  createCampaign,
  campaignStats,
  importCampaign,
  exportCampaign,
  campaignFilename,
  findCampaignReplay,
  campaignIconCandidates,
  chooseCampaignIcon,
  MAX_CAMPAIGN_BYTES,
} from './campaigns.js';

export function createCampaignMenu({ storage, previous, defaultPalette, onEnter }) {
  const menu = document.getElementById('campaign-menu');
  const list = document.getElementById('campaign-list');
  const status = document.getElementById('campaign-message');
  const fileInput = document.getElementById('campaign-file');
  const template = document.getElementById('campaign-template');
  const undoDelete = document.getElementById('undo-delete-campaign');
  const deleteDialog = document.getElementById('delete-campaign-dialog');
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  const cached = new Map();
  let campaigns = readCampaigns(storage);
  let deletedCampaign = readDeletedCampaign(storage);
  let storageAvailable = true;
  let pendingDeleteId;

  function hideIconControls(except) {
    list.querySelectorAll('.campaign-icon.is-revealed').forEach((icon) => {
      if (icon === except) return;
      icon.classList.remove('is-revealed');
      icon.querySelector('.campaign-icon-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  function save() {
    storageAvailable = saveCampaigns(storage, campaigns, deletedCampaign);
    undoDelete.hidden = !deletedCampaign;
    if (!storageAvailable)
      status.textContent = 'Browser storage is unavailable. Download your campaigns to keep them.';
    return storageAvailable;
  }

  function expireUndo() {
    if (!deletedCampaign) return;
    deletedCampaign = null;
    status.textContent = '';
    save();
  }

  if (!campaigns) {
    campaigns = [];
    if (previous.seed) {
      const world = generateWorld(previous.seed);
      campaigns.push(
        createCampaign(world, previous.colors, previous.paletteName, previous.variant),
      );
    }
    save();
  }

  function preview(tile, campaign) {
    return tilePreview(tile, campaign.colors);
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
        dressing: campaignDressing(campaign, world),
      };
      cached.set(campaign.id, data);
    }
    if (!campaignIconCandidates(data.world).some((cell) => cell.key === campaign.iconKey)) {
      campaign.iconKey = chooseCampaignIcon(data.world);
      save();
    }
    const iconSignature = JSON.stringify([campaign.iconKey, campaign.colors]);
    if (data.iconSignature !== iconSignature) {
      data.tile = prepareMap(data.world, data.dressing, { cellKeys: [campaign.iconKey] })[0];
      data.icon = preview(data.tile, campaign);
      data.iconSignature = iconSignature;
    }
    return data;
  }

  function paintIcon(card, campaign, data) {
    const img = card.querySelector('.campaign-icon img');
    img.hidden = !data.icon;
    if (data.icon) img.src = data.icon;
    img.alt = `${data.tile?.terrain ?? 'Terrain'} hex from ${campaign.name}`;
    img.dataset.hexKey = campaign.iconKey ?? '';
  }

  function labelActions(card, campaign) {
    card.querySelector('[data-action="share"]').title =
      'Copy seed link. Transfer hex edits with campaign JSON.';
    for (const [action, label] of [
      ['enter', 'Enter'],
      ['download', 'Download JSON for'],
      ['delete', 'Delete'],
      ['shuffle', 'Shuffle icon for'],
      ['icon-controls', 'Show icon controls for'],
    ])
      card
        .querySelector(`[data-action="${action}"]`)
        .setAttribute('aria-label', `${label} ${campaign.name}`);
  }

  function render() {
    list.replaceChildren();
    document.getElementById('campaign-count').textContent = campaigns.length;
    for (const campaign of campaigns) {
      const data = campaignData(campaign);
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.id = campaign.id;
      const name = card.querySelector('.campaign-name');
      name.value = campaign.name;
      name.setAttribute('aria-label', `Campaign name: ${campaign.name}`);
      name.title = 'Edit campaign name';
      paintIcon(card, campaign, data);
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
      list.append(card);
    }
  }

  function add(campaign) {
    expireUndo();
    campaigns.push(campaign);
    save();
  }

  function enter(campaign) {
    expireUndo();
    menu.hidden = true;
    onEnter(campaign);
  }

  function download(campaign) {
    const date = new Date();
    const blob = new Blob([exportCampaign(campaign, date)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = campaignFilename(campaign, date);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded “${campaign.name}”`;
  }

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
    if (!button) return;
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
    if (action === 'enter') return enter(campaign);
    if (action === 'download') return download(campaign);
    if (action === 'shuffle') {
      const data = campaignData(campaign);
      campaign.iconKey = chooseCampaignIcon(data.world, campaign.iconKey);
      const saved = save();
      paintIcon(button.closest('.campaign-card'), campaign, campaignData(campaign));
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
  listen(document.getElementById('new-campaign'), 'click', () => {
    const seed = crypto.randomUUID();
    const world = generateWorld(seed);
    const campaign = createCampaign(world, defaultPalette.colors, defaultPalette.paletteName);
    add(campaign);
    enter(campaign);
  });
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
      listeners.abort();
    },
  };
}
