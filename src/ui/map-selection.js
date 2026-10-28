import { openDialog } from './dialog-focus.js';

export const PARTY_SELECTION = '__party__';

// Coordinate map/dropdown selection and guarded party placement through session actions.
export function createMapSelection(
  root,
  {
    session,
    getRenderer,
    getInspectors,
    isBusy,
    isMobile,
    syncSelection,
    onPartySelected = () => {},
    updateInspector,
    onAction,
    onHover,
    notify,
  },
) {
  const element = (id) => root.querySelector(`#hp-${id}`);
  const selection = element('selection');
  const dialog = element('move-party-dialog');
  const listeners = new AbortController();
  const listen = (target, type, handler) =>
    target.addEventListener(type, handler, { signal: listeners.signal });
  let pending;
  let pressedButton = null;
  const focusMap = () => element('scene').querySelector('canvas')?.focus({ preventScroll: true });
  const activeInspector = () => {
    const { hex, batch, party } = getInspectors();
    const state = session.snapshot();
    return state?.partySelected ? party : state?.multiEdit ? batch : hex;
  };

  function selectParty(afterSelect = () => {}) {
    if (isBusy()) {
      syncSelection();
      return false;
    }
    if (session.snapshot().partySelected) {
      onPartySelected();
      focusMap();
      afterSelect();
      return true;
    }
    const change = () => {
      session.selectParty();
      const { hex, batch, party } = getInspectors();
      hex.reset();
      batch.reset();
      party.reset();
      syncSelection();
      updateInspector();
      onPartySelected();
      focusMap();
      afterSelect();
    };
    if (!activeInspector().beforeLeave(change)) {
      syncSelection();
      return false;
    }
    change();
    return true;
  }

  function selectHex(key, { additive = false, fromMap = false } = {}) {
    if (!key) return;
    const renderer = getRenderer();
    if (isBusy()) {
      renderer.select(session.snapshot().selected, { notify: false });
      syncSelection();
      return;
    }
    const { selected, multiEdit, partySelected } = session.snapshot();
    if (
      fromMap &&
      isMobile() &&
      partySelected &&
      key !== session.snapshot().campaign.partyToken.key
    ) {
      renderer.cancelInteraction();
      renderer.select(selected, { notify: false });
      syncSelection();
      pressedButton = null;
      pending = { key, campaignId: session.snapshot().campaign.id };
      const name = session.snapshot().campaign.partyToken.name ?? 'Adventurers';
      element('move-party-question').textContent =
        `Move ${name} token to ${selection.querySelector(`option[value="${key}"]`).textContent}?`;
      if (!dialog.open) openDialog(dialog);
      return;
    }
    const { hex, batch, party } = getInspectors();
    const enableMultiEdit = additive && !multiEdit;
    const proceed = () => renderer.select(key, { additive });
    const ready = enableMultiEdit
      ? activeInspector().beforeLeave(proceed)
      : multiEdit
        ? batch.beforeLeave(proceed)
        : partySelected
          ? party.beforeLeave(proceed)
          : hex.beforeSelection(key, proceed);
    if (!ready) {
      renderer.select(selected, { notify: false });
      selection.value = selected;
      syncSelection();
      return;
    }
    if (enableMultiEdit) {
      session.setMultiEdit(true);
      hex.reset();
      batch.reset();
    }
    if (!enableMultiEdit || key !== selected) session.select(key);
    selection.value = key;
    root.dataset.selected = key;
    onHover(key);
    // Reveal the destination panel before its visibility-gated preview refresh.
    syncSelection();
    updateInspector();
  }

  function takeDestination() {
    const target = pending;
    pending = undefined;
    pressedButton = null;
    getRenderer()?.cancelInteraction();
    return target;
  }
  function cancelMove() {
    const target = takeDestination();
    dialog.close();
    if (target && target.campaignId === session.snapshot()?.campaign.id)
      getRenderer().select(target.key);
    focusMap();
  }

  listen(element('find-party'), 'click', () => {
    selectParty(() => {
      const party = session.snapshot().campaign.partyToken;
      getRenderer().focus(party.key, { hexesWide: 9 / 1.2 ** 3 });
      notify(`Showing ${party.name ?? 'Adventurers'} token`);
    });
  });
  listen(selection, 'change', () => {
    if (selection.value === PARTY_SELECTION) selectParty();
    else getRenderer()?.select(selection.value, { additive: session.snapshot()?.multiEdit });
  });
  listen(dialog, 'pointerdown', (event) => {
    pressedButton = event.button === 0 ? event.target.closest('button') : null;
  });
  listen(dialog, 'pointercancel', () => {
    pressedButton = null;
  });
  dialog.addEventListener(
    'click',
    (event) => {
      const button = event.target.closest('button');
      const pressed = pressedButton;
      pressedButton = null;
      const pointerClick =
        event.detail > 0 ||
        Boolean(event.pointerType) ||
        event.sourceCapabilities?.firesTouchEvents;
      // A map tap can retarget its synthetic click to the newly opened dialog.
      // Pointer activation must begin on the button after the dialog opens.
      if (button && pointerClick && button !== pressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, signal: listeners.signal },
  );
  listen(element('move-party-cancel'), 'click', cancelMove);
  listen(dialog, 'cancel', (event) => {
    event.preventDefault();
    cancelMove();
  });
  listen(element('move-party-confirm'), 'click', () => {
    const target = takeDestination();
    if (target && target.campaignId === session.snapshot()?.campaign.id && !isBusy())
      onAction(session.moveParty(target.key));
    dialog.close();
    focusMap();
  });

  return {
    selectHex,
    selectParty,
    moveParty(key) {
      if (isBusy() || dialog.open || !session.snapshot()?.partySelected) return false;
      return onAction(session.moveParty(key));
    },
    dispose() {
      listeners.abort();
      pending = undefined;
      if (dialog.open) dialog.close();
    },
  };
}
