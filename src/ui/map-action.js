// Match campaign entry: disable controls and paint feedback before synchronous work.
export function createMapAction(root, announce) {
  let busy = false;
  let disposed = false;
  let release = () => {};
  return {
    isBusy: () => busy,
    async run(button, action, label = 'Applying…') {
      if (busy || disposed) return false;
      busy = true;
      const controls = [...root.querySelectorAll('button, input, select')].map((control) => [
        control,
        control.disabled,
      ]);
      const content = [...button.childNodes];
      let restored = false;
      const restoreControls = () => {
        for (const [control, disabled] of controls) control.disabled = disabled;
        button.replaceChildren(...content);
        restored = true;
      };
      release = () => {
        if (!restored) restoreControls();
        button.removeAttribute('aria-busy');
        button.classList.remove('hp-working');
        root.removeAttribute('aria-busy');
      };
      for (const [control] of controls) control.disabled = true;
      button.textContent = label;
      button.classList.add('hp-working');
      button.setAttribute('aria-busy', 'true');
      root.setAttribute('aria-busy', 'true');
      announce(label);
      try {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (disposed) return false;
        // Restore before the synchronous action so its new disabled states win.
        restoreControls();
        return action();
      } finally {
        release();
        release = () => {};
        busy = false;
      }
    },
    dispose() {
      disposed = true;
      release();
    },
  };
}
