import { cloneTemplate } from './templates.js';
import { hexAddress } from '../generation/hex.js';
import { partyMetadata, PARTY_COLORS, PARTY_STYLES } from '../application/party-token.js';

export function createPartyInspector(
  host,
  { onChange, onNavigate, onSelectVisited, preview, colorFor, visible },
) {
  host.replaceChildren(cloneTemplate('party-inspector-template'));
  const el = (name) => host.querySelector(`#hp-party-${name}`);
  const listeners = new AbortController();
  const listen = (target, type, callback) =>
    target.addEventListener(type, callback, { signal: listeners.signal });
  let state,
    metadata,
    frame,
    signature = '';
  function refreshPreview() {
    cancelAnimationFrame(frame);
    if (!state || !visible()) return;
    const party = state.campaign.partyToken,
      color = party.color ?? colorFor(state.campaign.colors);
    const key = JSON.stringify([party.style, color, state.campaign.colors]);
    if (signature === key) return;
    frame = requestAnimationFrame(() => {
      if (!visible()) return;
      const src = preview(party, state.campaign.colors, color);
      if (src) {
        el('preview').src = src;
        signature = key;
      }
    });
  }
  listen(el('reveal'), 'click', () => {
    const shown = el('reveal').getAttribute('aria-expanded') !== 'true';
    el('reveal').setAttribute('aria-expanded', String(shown));
    host.querySelector('.hp-party-portrait').classList.toggle('is-revealed', shown);
  });
  function commitName() {
    const name = el('name').value.trim() || state.campaign.partyToken.name || 'Adventurers';
    el('name').value = name;
    if (name !== (state.campaign.partyToken.name ?? 'Adventurers')) onChange({ name });
  }
  listen(el('name'), 'change', commitName);
  listen(el('name'), 'blur', commitName);
  listen(el('name-form'), 'submit', (event) => {
    event.preventDefault();
    commitName();
    el('name').blur();
  });
  listen(el('name'), 'keydown', (event) => {
    if (event.key === 'Escape') {
      el('name').value = state.campaign.partyToken.name ?? 'Adventurers';
      el('name').blur();
    }
  });
  listen(el('color'), 'click', () => {
    const current = state.campaign.partyToken.color ?? colorFor(state.campaign.colors);
    onChange({ color: PARTY_COLORS[(PARTY_COLORS.indexOf(current) + 1) % PARTY_COLORS.length] });
  });
  listen(el('type'), 'click', () => {
    onChange({
      style:
        PARTY_STYLES[
          (PARTY_STYLES.indexOf(state.campaign.partyToken.style) + 1) % PARTY_STYLES.length
        ],
    });
  });
  listen(el('locate-position'), 'click', () => onNavigate(metadata.cell.key));
  listen(el('locate-settlement'), 'click', () => onNavigate(metadata.settlementKey));
  listen(el('locate-poi'), 'click', () => onNavigate(metadata.poi.key));
  listen(el('locate-visited'), 'click', (event) => onSelectVisited(event.currentTarget));
  return {
    update(next) {
      state = next;
      metadata = partyMetadata(next.world, next.campaign, { visibleWorld: next.visibleWorld });
      const none = next.campaign.fogOfWar ? 'None discovered' : 'None on map';
      const steps = (value) => `${value} ${value === 1 ? 'hex' : 'hexes'}`;
      if (document.activeElement !== el('name'))
        el('name').value = next.campaign.partyToken.name ?? 'Adventurers';
      el('address').textContent = hexAddress(metadata.cell);
      el('settlement').textContent =
        metadata.settlement === null ? none : steps(metadata.settlement);
      el('poi').textContent = metadata.poi
        ? `${metadata.poi.name}, ${steps(metadata.poi.distance)}`
        : none;
      el('visited').textContent = `${metadata.visited} (${metadata.percent}%)`;
      el('locate-settlement').disabled = metadata.settlementKey === null;
      el('locate-poi').disabled = metadata.poi === null;
      el('locate-visited').disabled = metadata.visited === 0;
      el('days').textContent = `${metadata.days} ${metadata.days === 1 ? 'day' : 'days'}`;
      el('sessions').textContent = String(metadata.sessions);
      el('preview').alt =
        `${next.campaign.partyToken.style[0].toUpperCase() + next.campaign.partyToken.style.slice(1)} party token`;
      refreshPreview();
    },
    refreshPreview,
    beforeLeave: () => true,
    error: () => {},
    reset() {
      el('reveal').setAttribute('aria-expanded', 'false');
      host.querySelector('.hp-party-portrait').classList.remove('is-revealed');
    },
    dispose() {
      listeners.abort();
      cancelAnimationFrame(frame);
    },
  };
}
