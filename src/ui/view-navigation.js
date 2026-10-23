// Prepare the incoming view while hidden, then slide between ready views.
export function createViewNavigation(menu, workspace) {
  let running = false,
    disposed = false,
    transition,
    menuScroll = 0;
  const clear = () => {
    menu.inert = workspace.inert = false;
    menu.style.removeProperty('visibility');
    workspace.style.removeProperty('visibility');
    delete document.documentElement.dataset.viewDirection;
  };
  return {
    async show(direction, prepare) {
      if (running || disposed) return false;
      running = true;
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
          await transition?.finished;
        } else commit();
        return !disposed;
      } finally {
        running = false;
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
    },
    dispose() {
      disposed = true;
      transition?.skipTransition();
      clear();
    },
  };
}
