// Prepare the incoming view while hidden, then slide between ready views.
export function createViewNavigation(menu, workspace) {
  let queued = Promise.resolve(),
    disposed = false,
    transition,
    menuScroll = 0;
  const clear = () => {
    menu.inert = workspace.inert = false;
    menu.style.removeProperty('visibility');
    workspace.style.removeProperty('visibility');
    delete document.documentElement.dataset.viewDirection;
  };
  async function show(direction, prepare) {
    if (disposed) return false;
    const forward = direction === 'forward';
    const outgoing = forward ? menu : workspace;
    const incoming = forward ? workspace : menu;
    if (forward) menuScroll = window.scrollY;
    incoming.style.visibility = 'hidden';
    let committed = false;
    try {
      if ((await prepare()) === false || disposed) return false;
      incoming.hidden = true;
      incoming.style.removeProperty('visibility');
      outgoing.inert = incoming.inert = true;
      const commit = () => {
        if (disposed) return;
        outgoing.hidden = true;
        incoming.hidden = false;
        window.scrollTo({ top: forward ? 0 : menuScroll, behavior: 'instant' });
        committed = true;
      };
      if (
        document.startViewTransition &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        document.documentElement.dataset.viewDirection = direction;
        try {
          transition = document.startViewTransition(commit);
        } catch {
          commit();
        }
        try {
          await transition?.finished;
        } catch {
          // A browser can skip/abort an animation before running its update.
          // Navigation still has to commit and release both views.
          if (!committed) commit();
        }
      } else commit();
      return !disposed;
    } finally {
      transition = undefined;
      if (!disposed) {
        if (!committed) incoming.hidden = true;
        clear();
        if (committed) {
          const target =
            incoming.querySelector(forward ? '#hp-scene canvas' : '#new-campaign') ||
            incoming.querySelector('#hp-back-menu');
          target?.focus({ preventScroll: true });
        }
      }
    }
  }
  return {
    show(direction, prepare) {
      const next = queued.then(() => show(direction, prepare));
      queued = next.catch(() => {});
      return next;
    },
    dispose() {
      disposed = true;
      transition?.skipTransition();
      clear();
    },
  };
}
